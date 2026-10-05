import { GameClock } from './audio/clock.ts';
import { BackingScheduler } from './audio/scheduler.ts';
import { WebAudioSynth, type Synth } from './audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG, OVERHOLD_COST, type JudgeConfig, type TimingPreset } from './game/judge.ts';
import { calibrationBeats } from './game/calibration.ts';
import { loopLabel, loopOf, practiceSections, trimChart, type PracticeSectionInfo } from './game/practice.ts';
import { keyLevelOf, listKeyLevel, RATES, songStars, starsByLevel, suggestNextStep, TOP_LEVEL, unlockedLevels, UNLOCK_STARS, type LevelBest, type Suggestion } from './game/results.ts';
import { PlaySession } from './game/session.ts';
import { STUDENT_TRIAL_ID, studentTrialSettings, type TrialRate, type TrialSound } from './game/studentTrial.ts';
import { KeyboardInput } from './input/keyboardInput.ts';
import { MidiInput } from './input/midiInput.ts';
import type { InputEvent } from './input/normalize.ts';
import {
  buildChart, chooseWindow, DIFFICULTY_LABEL, isDifficulty, offeredLevels, resolveLevel, splitNotes,
  type Chart, type ChartOptions, type Difficulty, type Hand, type PitchWindow,
} from './midi/chart.ts';
import { buildPack, parsePackJson, sha256Hex, type PackSettings, type PackValidation } from './midi/pack.ts';
import { beatLines, parseSong, ticksToSeconds } from './midi/parse.ts';
import { buildParts, defaultPart, notesOf } from './midi/parts.ts';
import type { FeedbackSound } from './game/session.ts';
import { noteName, displayRange } from './render/layout.ts';
import { Renderer, type RenderState } from './render/renderer.ts';
import { horizonSeconds, PerspectiveRenderer } from './render/highway3d.ts';
import { feedbackFor } from './game/feedback.ts';
import { bestKey, bestsForSong, deleteSong, getBest, listSongs, parseBestKey, putSong, recordBest, saveChoice, type BestScore } from './storage/db.ts';
import type { Part, PartId, SongData } from './types.ts';
import { partKey } from './types.ts';
import {
  gateMessage, installDropZone, setPracticeRate, showCalibration, showError, showExportDialog, showFirstRun, showGate, showPartPicker, showPause, showPlayHud,
  showPracticePicker, showPracticeResults, showResults, showSettings, showSongSelect, showStudentTrial, showStudentTrialResults, showUnsupported, toast,
  type PartPickerState, type PartRow, type PracticeChoice, type SongRow,
} from './ui/screens.ts';
import { effectiveFeedback, loadSettings, resetToClassDefaults, saveClassDefaults, saveSettings, type Settings } from './ui/settings.ts';

// ---------------------------------------------------------------------------
// Types and state
// ---------------------------------------------------------------------------
interface ManifestEntry {
  id: string;
  title: string;
  tag?: string;
  file: string;
  defaultParts: PartId[];
  split?: number;
}

interface LibrarySong {
  id: string;
  title: string;
  source: 'bundled' | 'imported';
  file?: string;
  /** difficulty and flavour from the manifest, shown in song select */
  tag?: string;
  /** full URL for a song outside public/songs (the dev server's local-songs folder) */
  url?: string;
  bytes?: Uint8Array;
  defaultParts: PartId[];
  parts: PartId[];
  split?: number;
  hands?: Hand[];
  timingPreset?: TimingPreset;
  difficulty?: Difficulty;
  /** level name in the best-score key (see bestKey) */
  keyLevel?: string;
  packName?: string;
  /** position in its pack */
  packIndex?: number;
  /** its pack unlocks levels in order */
  unlocks?: boolean;
}

interface PartChoice {
  parts: PartId[];
  split?: number;
  hands?: Hand[];
  timing?: TimingPreset;
  difficulty?: Difficulty;
  keyLevel?: string;
}

/** Students start on Easy; a teacher's pack or the player's own choice overrides it. */
const DEFAULT_DIFFICULTY: Difficulty = 'easy';

interface Current {
  lib: LibrarySong;
  song: SongData;
  parts: Part[];
  picker: PartPickerState;
  /** stars per level on this machine, when the song's pack unlocks levels in order */
  stars: Map<string, number> | null;
}

const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);
const perspectiveRenderer = new PerspectiveRenderer(canvas);
const PARTS_KEY = 'midihero.parts.v1';

let settings: Settings = loadSettings();
let sessionSettings: Settings | null = null;
let trialSound: TrialSound = effectiveFeedback(settings) === 'off' ? 'off' : 'press';
let trialRate: TrialRate = 1;
const clock = new GameClock();
let audioCtx: AudioContext | null = null;
let synth: Synth | null = null;
let backingSynth: WebAudioSynth | null = null;
let scheduler: BackingScheduler | null = null;
let session: PlaySession | null = null;
let renderState: RenderState | null = null;
let library: LibrarySong[] = [];
let current: Current | null = null;
let gateHandler: ((ev: InputEvent) => void) | null = null;
/** calibration: every key press is a tap */
let tapHandler: ((perfMs: number) => void) | null = null;
let calibrating = false;
/**
 * The MIDI pitch the keyboard sends for its lowest C, learned at the gate, per port, for this
 * page session. The octave shift of a play is the song's window against this: songs get
 * different windows, the keyboard stays the same.
 */
const lowCByPort = new Map<string, number>();
let lastPlay: { window: PitchWindow; relative: boolean; autoplay: { jitterMs: number } | null; practice: PracticeChoice | null } | null = null;
/** the play screen's overlay, for the practice speed shown on it */
let hudEl: HTMLElement | null = null;

const midi = new MidiInput();
const keyboard = new KeyboardInput();
keyboard.base = settings.keyboardBase;
keyboard.onOctaveChange = (b) => {
  if (current?.lib.id !== STUDENT_TRIAL_ID || (!gateHandler && !session)) {
    settings.keyboardBase = b;
    saveSettings(settings);
  }
  toast(`Computer keyboard: lower row now starts at ${b}`);
};

const onInput = (ev: InputEvent): void => {
  if (calibrating) {
    if (ev.type === 'on') tapHandler?.(ev.perfMs);
  } else if (gateHandler) gateHandler(ev);
  else session?.handleInput(ev);
};
keyboard.onEvent = onInput;
midi.onEvent = onInput;
midi.onChange = () => {
  lowCByPort.clear(); // a reconnect may have reset the keyboard's octave buttons
  const id = midi.autoSelect(settings.midiPortId);
  toast(id ? `MIDI: ${midi.listPorts().find((p) => p.id === id)?.name ?? id}` : 'MIDI keyboard disconnected');
};
keyboard.attach();

// ---------------------------------------------------------------------------
// MIDI and audio
// ---------------------------------------------------------------------------
function midiStatusText(): string {
  if (!midi.supported) return 'No Web MIDI in this browser (Safari/iPad). Use Chrome, Edge or Firefox on a Chromebook, Mac or Windows PC.';
  if (midi.status === 'denied') return 'MIDI access was blocked. Allow it in the site settings (the icon left of the address bar), then retry.';
  if (midi.status === 'pending') return 'Requesting MIDI access…';
  const ports = midi.listPorts();
  if (ports.length === 0) return 'MIDI is ready, but no keyboard is connected. Plug one in (Firefox needs it connected before allowing access).';
  const sel = ports.find((p) => p.id === midi.selectedId);
  return sel ? `MIDI keyboard: ${sel.name}` : 'MIDI ready — choose a keyboard in Settings.';
}

async function requestMidi(): Promise<void> {
  const status = await midi.request();
  if (status === 'granted') {
    const id = midi.autoSelect(settings.midiPortId);
    if (id && id !== settings.midiPortId) {
      settings.midiPortId = id;
      saveSettings(settings);
    }
  }
}

function ensureAudio(): void {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return;
  }
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    audioCtx = ctx;
    synth = new WebAudioSynth(ctx);
    backingSynth = new WebAudioSynth(ctx);
    // Only drive the game clock from the audio clock once it is actually running;
    // a context created without a user gesture may stay suspended.
    const attachWhenRunning = () => {
      if (ctx.state === 'running' && !clock.hasAudio) clock.attach(ctx);
      if (ctx.state === 'suspended') toast('Click anywhere to enable sound');
    };
    ctx.onstatechange = attachWhenRunning;
    void ctx.resume().then(attachWhenRunning, attachWhenRunning);
    attachWhenRunning();
    const unlock = () => void ctx.resume();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  } catch (e) {
    console.warn('AudioContext unavailable', e);
  }
}

function latencyMs(): number | null {
  if (!audioCtx) return null;
  return ((audioCtx.baseLatency ?? 0) + (audioCtx.outputLatency ?? 0)) * 1000;
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
function storedPartChoices(): Record<string, PartChoice> {
  try {
    return JSON.parse(localStorage.getItem(PARTS_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function rememberChoice(id: string, choice: PartChoice): void {
  try {
    const all = storedPartChoices();
    all[id] = choice;
    localStorage.setItem(PARTS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

async function loadLibrary(): Promise<void> {
  const manifest = (await (await fetch(`${base}songs/manifest.json`)).json()) as ManifestEntry[];
  const choices = storedPartChoices();
  const bundled: LibrarySong[] = manifest.map((m) => ({
    id: m.id, title: m.title, tag: m.tag, source: 'bundled', file: m.file, defaultParts: m.defaultParts,
    parts: choices[m.id]?.parts ?? m.defaultParts, split: choices[m.id]?.split ?? m.split, hands: choices[m.id]?.hands, timingPreset: choices[m.id]?.timing,
    difficulty: isDifficulty(choices[m.id]?.difficulty) ? choices[m.id]!.difficulty : undefined, keyLevel: choices[m.id]?.keyLevel,
  }));
  let local: LibrarySong[] = [];
  if (import.meta.env.DEV) {
    // Your own .mid files in the gitignored local-songs/ folder (served by the dev server only).
    try {
      const files = (await (await fetch('/local-songs/index.json')).json()) as { file: string; title: string }[];
      local = files.map((f) => {
        const id = `local:${f.file}`;
        return {
          id, title: f.title, source: 'bundled', url: `/local-songs/${encodeURIComponent(f.file)}`, defaultParts: [],
          parts: choices[id]?.parts ?? [], split: choices[id]?.split, hands: choices[id]?.hands, timingPreset: choices[id]?.timing,
          difficulty: isDifficulty(choices[id]?.difficulty) ? choices[id]!.difficulty : undefined, keyLevel: choices[id]?.keyLevel,
        };
      });
    } catch {
      /* no local songs */
    }
  }
  let imported: LibrarySong[] = [];
  try {
    const stored = await listSongs();
    imported = stored
      .sort((a, b) => a.addedAt - b.addedAt)
      .map((s) => ({
        id: s.id, title: s.name, source: 'imported', bytes: s.bytes, defaultParts: s.parts, parts: s.parts, split: s.split,
        timingPreset: s.timingPreset as TimingPreset | undefined, difficulty: isDifficulty(s.difficulty) ? s.difficulty : undefined, keyLevel: s.keyLevel, packName: s.packName,
        packIndex: s.packIndex, unlocks: s.unlocks,
      }));
  } catch (e) {
    console.warn('IndexedDB unavailable', e);
  }
  library = [...imported, ...local, ...bundled];
}

async function songBytes(lib: LibrarySong): Promise<Uint8Array> {
  if (lib.bytes) return lib.bytes;
  const res = await fetch(lib.url ?? `${base}songs/${lib.file}`);
  if (!res.ok) throw new Error(`Could not fetch ${lib.url ?? lib.file}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function importFiles(files: File[]): Promise<void> {
  let added = 0;
  for (const file of files) {
    try {
      if (/\.json$/i.test(file.name)) {
        const v = parsePackJson(await file.text());
        if (!v.ok) throw new Error(v.error);
        added += await storePack(v);
        toast(`Imported pack "${v.pack.name}" (${v.songs.length} songs)`);
      } else {
        const bytes = new Uint8Array(await file.arrayBuffer());
        parseSong(bytes); // validate
        const id = await sha256Hex(bytes);
        await putSong({ id, name: file.name.replace(/\.midi?$/i, ''), bytes, parts: [], addedAt: Date.now() });
        added++;
      }
    } catch (e) {
      toast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error', 6000);
    }
  }
  if (added) {
    await loadLibrary();
    songSelect();
  }
}

/** Store a validated pack's songs in pack order, then apply its class settings. Returns the song count. */
async function storePack(v: Extract<PackValidation, { ok: true }>): Promise<number> {
  const now = Date.now();
  for (const [i, { song, bytes }] of v.songs.entries()) {
    const id = song.id || (await sha256Hex(bytes));
    await putSong({
      id, name: song.title, bytes, parts: song.defaultParts, addedAt: now + i, packName: v.pack.name, packIndex: i, unlocks: v.pack.settings.unlocks === true,
      ...(song.split !== undefined ? { split: song.split } : {}), ...(song.timingPreset ? { timingPreset: song.timingPreset } : {}),
      ...(song.difficulty ? { difficulty: song.difficulty } : {}),
    });
  }
  applyPackSettings(v.pack.settings);
  return v.songs.length;
}

function applyPackSettings(ps: PackSettings): void {
  const partial: Partial<Settings> = {};
  if (ps.kb) partial.kb = ps.kb;
  if (ps.timing) partial.timing = ps.timing;
  if (ps.names !== undefined) partial.names = ps.names;
  if (ps.synth !== undefined) {
    partial.synth = ps.synth;
    if (ps.synth && settings.feedbackSound === 'off') partial.feedbackSound = 'chart';
  }
  saveClassDefaults(partial);
  settings = { ...settings, ...partial };
  saveSettings(settings);
}

async function loadPackFromUrl(path: string): Promise<void> {
  // Same-origin paths under the app base only.
  if (/^[a-z]+:|^\/\/|\.\./i.test(path)) throw new Error('Pack URL must be a path inside this site');
  const res = await fetch(`${base}${path.replace(/^\/+/, '')}`);
  if (!res.ok) throw new Error(`Pack not found: ${path}`);
  const v = parsePackJson(await res.text());
  if (!v.ok) throw new Error(v.error);
  await storePack(v);
  toast(`Loaded pack "${v.pack.name}"`);
}

async function exportPack(name: string, ids: string[], unlocks: boolean): Promise<void> {
  const songs = [];
  for (const id of ids) {
    const lib = library.find((l) => l.id === id);
    if (!lib) continue;
    songs.push({ title: lib.title, bytes: await songBytes(lib), defaultParts: lib.parts, split: lib.split, timingPreset: lib.timingPreset, difficulty: lib.difficulty });
  }
  const pack = await buildPack(name, { kb: settings.kb, timing: settings.timing, names: settings.names, synth: settings.synth, unlocks }, songs);
  const blob = new Blob([JSON.stringify(pack)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w-]+/g, '_') || 'class'}.midihero.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Pack "${name}" downloaded. Share it through Classroom or Drive.`);
  songSelect();
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function songSelect(): void {
  stopBacking();
  synth?.allNotesOff(0);
  session = null;
  sessionSettings = null;
  keyboard.base = settings.keyboardBase;
  renderState = null;
  gateHandler = null;
  const rows: SongRow[] = library.map((l) => ({
    id: l.id,
    title: l.title,
    subtitle: l.id === STUDENT_TRIAL_ID ? 'Student trial · eight melody notes with steady backing' : l.url ? 'your local song' : l.source === 'bundled' ? l.tag ?? 'built-in' : l.packName ? `pack: ${l.packName}` : 'imported',
    group: l.source === 'imported' ? 'class' : 'builtin',
    ...(l.packName ? { pack: l.packName, packIndex: l.packIndex ?? 0 } : {}),
    deletable: l.source === 'imported',
  }));
  showSongSelect({
    songs: rows,
    midiStatus: midiStatusText(),
    onPick: (id) => void openSong(id),
    onDelete: (id) => void deleteSong(id).then(loadLibrary).then(songSelect),
    onImport: (files) => void importFiles(files),
    onExport: () =>
      showExportDialog({
        songs: library.map((l) => ({ id: l.id, title: l.title })),
        defaultName: 'Class pack',
        onExport: (name, ids, unlocks) => void exportPack(name, ids, unlocks),
        onBack: songSelect,
      }),
    onSettings: () => settingsScreen(songSelect),
    onRetryMidi: midi.status === 'denied' || midi.status === 'unsupported' ? () => void requestMidi().then(songSelect) : null,
  });
  // Best scores load asynchronously and are added to the rows when known.
  for (const l of library) {
    if (!l.parts.length) continue;
    void listBestKey(l)
      .then((key) => getBest(key))
      .then((b) => {
        if (!b) return;
        const item = document.querySelector<HTMLElement>(`.item[data-id="${CSS.escape(l.id)}"] .meta`);
        if (item) item.textContent += ` · best ${(b.accuracy * 100).toFixed(0)}% (${b.score})`;
      })
      .catch(() => undefined);
  }
  // Every song shows the stars it has earned and on which level (a pack's setlist most of all).
  for (const l of library) {
    void levelBests(l.id)
      .then((bests) => {
        const got = songStars(bests);
        if (!got) return;
        const item = document.querySelector<HTMLElement>(`.item[data-id="${CSS.escape(l.id)}"] .meta`);
        const on = got.level === TOP_LEVEL ? 'the full part' : DIFFICULTY_LABEL[got.level as Difficulty] ?? got.level;
        if (item) item.textContent += ` · ${'★'.repeat(got.stars)}${'☆'.repeat(5 - got.stars)} on ${on}`;
      })
      .catch(() => undefined);
  }
}

/**
 * The best-score key the song list shows for a song: the one the play path records under, with
 * the level resolved the same way (the top level is the no-suffix key) and the hand split only
 * for a single wide part.
 */
async function listBestKey(l: LibrarySong): Promise<string> {
  const song = parseSong(await songBytes(l));
  const parts = buildParts(song);
  const p0 = l.parts.length === 1 ? parts.find((x) => x.key === partKey(l.parts[0]!)) : undefined;
  const wide = !!p0 && p0.maxPitch - p0.minPitch > 24;
  const split = wide ? l.split ?? 60 : undefined;
  const keyLevel = listKeyLevel(l, () =>
    offeredLevels(splitNotes(song, { parts: l.parts, split, hands: wide ? l.hands ?? ['L', 'R'] : undefined }).player, song).map((x) => x.level));
  return bestKey(l.id, l.parts, split, l.timingPreset ?? settings.timing, settings.rate, settings.easy, keyLevel);
}

/** A song's best scores as levels and rates, for its stars. */
async function levelBests(songId: string): Promise<LevelBest[]> {
  const bests: BestScore[] = await bestsForSong(songId);
  return bests.map((b) => {
    const k = parseBestKey(b.key);
    return { accuracy: b.accuracy, rate: k.rate, level: b.level ?? k.level ?? TOP_LEVEL };
  });
}

/** Stars per level of the current song, when its pack unlocks levels in order. */
async function loadStars(): Promise<void> {
  if (!current) return;
  const c = current;
  c.stars = c.lib.unlocks ? starsByLevel(await levelBests(c.lib.id).catch(() => [])) : null;
}

function settingsScreen(onClose: () => void): void {
  showSettings({
    settings,
    ports: midi.listPorts(),
    selectedPort: midi.selectedId,
    midiStatus: midiStatusText(),
    latencyMs: latencyMs(),
    lockedChannel: session?.filter.locked ?? null,
    onChange: (next) => {
      settings = next;
      saveSettings(settings);
      if (session) toast('Speed and keyboard changes apply on restart');
    },
    onSelectPort: (id) => {
      midi.select(id);
      settings.midiPortId = id;
      saveSettings(settings);
      lowCByPort.clear();
      settingsScreen(onClose);
    },
    onResetChannel: () => {
      session?.filter.reset();
      toast('Input channel reset');
    },
    onCalibrate: () => calibrate(() => settingsScreen(onClose)),
    onResetClassDefaults: () => {
      settings = resetToClassDefaults();
      toast('Settings reset to class defaults');
      settingsScreen(onClose);
    },
    onClose,
  });
}

/** Guided calibration: 8 clicks to tap along to (input offset), then 8 silent landings (visual offset). */
function calibrate(onClose: () => void): void {
  ensureAudio();
  calibrating = true;
  // A clock of its own, on the same audio timeline as the game's: the song's clock may be paused mid-song.
  let cal = new GameClock();
  showCalibration({
    inputOffsetMs: settings.inputOffsetMs,
    audioOffsetMs: settings.audioOffsetMs,
    start: (kind) => {
      // The audio clock counts once sound is coming out; until then there is nothing to tap along to.
      const audible = audioCtx?.state === 'running' && (audioCtx.getOutputTimestamp?.().contextTime ?? 0) > 0;
      if (!audible && kind === 'input') {
        ensureAudio();
        return null;
      }
      cal = new GameClock();
      if (audible) cal.attach(audioCtx!);
      cal.start(0);
      const beats = calibrationBeats(1);
      if (kind === 'input' && synth) {
        for (const t of beats.leadIn) synth.noteOn(9, 37, 60, cal.songTimeToContextTime(t));
        for (const t of beats.scored) synth.noteOn(9, 76, 115, cal.songTimeToContextTime(t));
      }
      return beats;
    },
    now: () => cal.now(),
    timeOf: (perfMs) => cal.audibleSongTime(perfMs),
    onTaps: (handler) => (tapHandler = handler),
    onSave: (offsets) => {
      settings = { ...settings, ...offsets };
      saveSettings(settings);
      toast('Timing saved');
    },
    onClose: () => {
      tapHandler = null;
      calibrating = false;
      synth?.allNotesOff(0);
      onClose();
    },
  });
}

async function openSong(id: string): Promise<void> {
  const lib = library.find((l) => l.id === id);
  if (!lib) return;
  try {
    const song = parseSong(await songBytes(lib));
    const parts = buildParts(song);
    const keys = new Set(parts.map((p) => p.key));
    let selected = lib.parts.filter((p) => keys.has(partKey(p))).map(partKey);
    if (selected.length === 0) selected = lib.defaultParts.filter((p) => keys.has(partKey(p))).map(partKey);
    if (selected.length === 0) {
      const d = defaultPart(parts);
      if (d) selected = [d.key];
    }
    // ?part=5:4 picks a part by track:channel (for checks on a specific part)
    const urlPart = params.get('part');
    if (urlPart && keys.has(urlPart)) selected = [urlPart];
    current = {
      lib, song, parts,
      picker: {
        selected: new Set(selected), split: lib.split ?? 60, hands: lib.hands ?? ['L', 'R'], timing: lib.timingPreset ?? settings.timing, guideTrack: false,
        difficulty: urlDifficulty ?? lib.difficulty ?? DEFAULT_DIFFICULTY,
      },
      stars: null,
    };
    if (lib.id === STUDENT_TRIAL_ID) {
      current.picker = { selected: new Set(['1:0']), split: 60, hands: ['L', 'R'], timing: 'normal', guideTrack: false, difficulty: 'easy' };
    }
    await loadStars();
    partPicker();
  } catch (e) {
    showError('Could not load song', e instanceof Error ? e.message : String(e), songSelect);
  }
}

/** ?practice=2 (with autoplay): loop section 2; &practiceTo=3 extends the loop, &wait=1 turns wait mode on, &ladder=0 off. */
function urlPractice(): PracticeChoice | null {
  const n = Number(params.get('practice'));
  if (!Number.isInteger(n) || n < 1) return null;
  const to = Number(params.get('practiceTo') ?? n);
  return { from: n - 1, to: Math.max(n, Number.isInteger(to) ? to : n) - 1, wait: params.get('wait') === '1', ladder: params.get('ladder') !== '0', rate: nearestRate(settings.rate) };
}

const urlDifficulty: Difficulty | null = isDifficulty(params.get('difficulty')) ? (params.get('difficulty') as Difficulty) : null;

function selectedPartIds(): PartId[] {
  if (!current) return [];
  return [...current.picker.selected].map((k) => {
    const [track, channel] = k.split(':').map(Number) as [number, number];
    return { track, channel };
  });
}

/** Parts, hand split and hands as the picker has them. The split only applies to a single wide part. */
function selectionOptions(): (Pick<ChartOptions, 'parts' | 'split' | 'hands'> & { wide: boolean }) | null {
  if (!current) return null;
  const parts = selectedPartIds();
  if (parts.length === 0) return null;
  const p0 = current.parts.find((x) => x.key === partKey(parts[0]!));
  const wide = parts.length === 1 && !!p0 && p0.maxPitch - p0.minPitch > 24;
  return { parts, split: wide ? current.picker.split : undefined, hands: wide ? current.picker.hands : undefined, wide };
}

/**
 * The levels the selection has, the one that will be played (the chosen level, or the nearest
 * one below it that this part has), and its name in the best-score key.
 */
function levelsOfSelection(): { offered: ReturnType<typeof offeredLevels>; level: Difficulty; keyLevel: Difficulty; locked: Difficulty[] } {
  const sel = selectionOptions();
  const offered = sel && current ? offeredLevels(splitNotes(current.song, sel).player, current.song) : [];
  const names = offered.map((l) => l.level);
  // A pack that unlocks levels in order offers the next one once the one below has its stars.
  const open = unlockedLevels(names, current?.stars ?? new Map(), !!current?.lib.unlocks);
  const level = resolveLevel(current?.picker.difficulty ?? DEFAULT_DIFFICULTY, open);
  return { offered, level, keyLevel: keyLevelOf(level, names).keyLevel, locked: names.filter((n) => !open.includes(n)) };
}

/** Chart notes removed by the difficulty level sound on a hit; without chart feedback the band plays them. */
const removedFor = (feedback: FeedbackSound): 'carry' | 'backing' => (feedback === 'chart' ? 'carry' : 'backing');

/** Physical range for absolute judging, or a virtual C-aligned window for relative judging. */
function windowFor(kb: Settings['kb'], pitches: number[]): { window: PitchWindow; relative: boolean } {
  if (kb === 61) return { window: { low: 36, high: 96 }, relative: false };
  if (kb === 88) return { window: { low: 21, high: 108 }, relative: false };
  return { window: chooseWindow(pitches, kb - 1), relative: true };
}

function partPicker(): void {
  if (!current) return;
  if (current.lib.id === STUDENT_TRIAL_ID) { trialSetup(); return; }
  const { lib, song, parts, picker } = current;
  const rows: PartRow[] = parts.map((p) => {
    const pitches = notesOf(song, p).map((n) => n.pitch);
    const { window } = windowFor(settings.kb, pitches);
    const outside = pitches.filter((x) => x < window.low || x > window.high).length;
    const dup = p.duplicateOf ? parts.find((q) => q.key === p.duplicateOf) : undefined;
    return { part: p, foldedRatio: pitches.length ? outside / pitches.length : 0, duplicateOfName: dup?.name ?? null };
  });
  const levels = levelsOfSelection();
  showPartPicker({
    title: lib.title,
    rows,
    levels: levels.offered,
    level: levels.level,
    locked: levels.locked,
    unlockStars: UNLOCK_STARS,
    state: picker,
    kb: settings.kb,
    onChange: () => partPicker(),
    onPlay: () => void startPlay(null),
    onPractise: () => practicePicker(),
    onBack: songSelect,
  });
}

/** Trial setup previews actual MIDI pitches; it does not adjust the hardware octave. */
function trialSetup(): void {
  stopBacking();
  session?.pause();
  session = null;
  renderState = null;
  synth?.allNotesOff(0);
  synth?.control(0, 64, 0, 0);
  keyboard.base = 48;
  const el = showStudentTrial({
    sound: trialSound, rate: trialRate,
    onEnableSound: ensureAudio,
    onChange: (sound, rate) => {
      synth?.allNotesOff(0);
      synth?.control(0, 64, 0, 0);
      trialSound = sound;
      trialRate = rate;
    },
    onPlay: () => void startPlay(null), onBack: songSelect,
  });
  gateHandler = (ev) => {
    ensureAudio();
    if (ev.type === 'on') {
      el.querySelector('#trial-key')!.textContent = `Received ${noteName(ev.pitch)} (MIDI ${ev.pitch})`;
      if (trialSound === 'press') synth?.noteOn(0, ev.pitch, ev.velocity, 0);
    } else if (ev.type === 'off') {
      if (trialSound === 'press') synth?.noteOff(0, ev.pitch, 0);
    } else if (trialSound === 'press') synth?.control(0, 64, ev.velocity, 0);
  };
}

/** Bar-line times of the current song, and its sections with the notes of the selected level. */
function sectionsOfSelection(): { sections: PracticeSectionInfo[]; barTimes: number[] } | null {
  if (!current) return null;
  const sel = selectionOptions();
  if (!sel) return null;
  const { level } = levelsOfSelection();
  const chart = buildChart(current.song, { parts: sel.parts, split: sel.split, hands: sel.hands, difficulty: level });
  const barTimes = beatLines(current.song, chart.duration).filter((l) => l.isBar).map((l) => l.time);
  return { sections: practiceSections(barTimes, chart.duration, chart.notes), barTimes };
}

/** Practice mode: pick the sections to loop, then play them. `section` preselects the one starting there. */
function practicePicker(sectionStart?: number): void {
  if (!current) return;
  const found = sectionsOfSelection();
  if (!found || found.sections.length === 0) return;
  const { sections } = found;
  const last = sections.length - 1;
  const prev = lastPlay?.practice;
  let from = 0;
  let to = 0;
  if (sectionStart !== undefined) from = to = Math.max(0, sections.findIndex((s) => Math.abs(s.start - sectionStart) < 1e-6));
  else if (prev) {
    from = Math.min(prev.from, last);
    to = Math.min(prev.to, last);
  }
  const { level } = levelsOfSelection();
  showPracticePicker({
    title: current.lib.title,
    level: DIFFICULTY_LABEL[level],
    sections,
    rates: RATES,
    choice: { from, to, wait: settings.practiceWait, ladder: settings.practiceLadder, rate: prev?.rate ?? nearestRate(settings.rate) },
    onStart: (choice) => {
      settings.practiceWait = choice.wait;
      settings.practiceLadder = choice.ladder;
      saveSettings(settings);
      void startPlay(null, choice);
    },
    onBack: partPicker,
  });
}

const nearestRate = (rate: number): number => RATES.reduce((a, b) => (Math.abs(b - rate) < Math.abs(a - rate) ? b : a));

async function startPlay(autoplay: { jitterMs: number } | null, practice: PracticeChoice | null = null): Promise<void> {
  if (!current) return;
  const { lib, song, picker } = current;
  const sel = selectionOptions();
  if (!sel) return;
  const partIds = sel.parts;
  const { level, keyLevel } = levelsOfSelection();
  picker.difficulty = level;
  const choice: PartChoice = { parts: partIds, split: picker.split, hands: picker.hands, timing: picker.timing, difficulty: level, keyLevel };
  lib.parts = partIds;
  lib.split = picker.split;
  lib.hands = picker.hands;
  lib.timingPreset = picker.timing;
  lib.difficulty = level;
  lib.keyLevel = keyLevel;
  if (lib.id !== STUDENT_TRIAL_ID) {
    if (lib.source === 'bundled') rememberChoice(lib.id, choice);
    else await saveChoice(lib.id, { parts: partIds, split: picker.split, timingPreset: picker.timing, difficulty: level, keyLevel }).catch(() => undefined);
  }

  ensureAudio();
  // The window is chosen for the notes this level actually asks for.
  const unfolded = buildChart(song, { parts: sel.parts, split: sel.split, hands: sel.hands, difficulty: level });
  const { window, relative } = lib.id === STUDENT_TRIAL_ID
    ? { window: { low: 48, high: 72 }, relative: false }
    : windowFor(settings.kb, unfolded.notes.map((n) => n.origPitch));
  lastPlay = { window, relative, autoplay, practice };
  play();
}

function play(): void {
  if (!current || !lastPlay) return;
  const { lib, song, picker } = current;
  const trial = lib.id === STUDENT_TRIAL_ID;
  const runSettings = trial ? studentTrialSettings(settings, trialSound, trialRate) : settings;
  sessionSettings = trial ? runSettings : null;
  const { window, relative, autoplay, practice: choice } = lastPlay;
  const sel = selectionOptions();
  if (!sel) return;
  const partIds = sel.parts;
  const wide = sel.wide;
  const { offered, level: difficulty, keyLevel } = levelsOfSelection();
  const feedback = effectiveFeedback(runSettings);
  const fullChart: Chart = buildChart(song, {
    parts: sel.parts, split: sel.split, hands: sel.hands, window, foldMode: runSettings.foldMode, difficulty, removed: removedFor(feedback),
  });
  if (fullChart.notes.length === 0) {
    showError('Nothing to play', 'The selected part has no notes in range.', partPicker);
    return;
  }
  const range = displayRange(fullChart.minPitch, fullChart.maxPitch, window);
  const lines = beatLines(song, fullChart.duration);
  const barTimes = lines.filter((l) => l.isBar).map((l) => l.time);
  // Practice mode: the chart is cut to the loop; the band, the beat lines and the display range stay the song's.
  const sections = choice ? practiceSections(barTimes, fullChart.duration, fullChart.notes) : [];
  const from = choice ? Math.min(choice.from, sections.length - 1) : 0;
  const to = choice ? Math.min(choice.to, sections.length - 1) : 0;
  const loop = choice && sections.length ? loopOf(sections, from, to) : null;
  const chart = loop ? trimChart(fullChart, loop) : fullChart;
  if (chart.notes.length === 0) {
    showError('Nothing to practise', 'These bars have no notes to play.', partPicker);
    return;
  }
  const rate = choice ? choice.rate : runSettings.rate;
  const timing = picker.timing;
  const judgeConfig: JudgeConfig = {
    ...DEFAULT_JUDGE_CONFIG, preset: timing, easy: runSettings.easy, wrongNotePenalty: runSettings.wrongNotePenalty,
    failAt: runSettings.arcade && !autoplay && !loop ? 0 : null,
    overhold: runSettings.letGo ? OVERHOLD_COST[difficulty] : null,
  };
  const sig = song.timeSigs[0]!;
  const barSeconds = ticksToSeconds(song.tempoMap, song.ppq, (song.ppq * 4 * sig.numerator) / sig.denominator);
  // The lead-in covers everything on screen: the perspective highway shows further ahead.
  const hitLineY = canvas.clientHeight * 0.82;
  const visibleSeconds = runSettings.highway === 'perspective' ? horizonSeconds(hitLineY, runSettings.speed) : hitLineY / runSettings.speed;
  const feedbackProfile = feedbackFor(difficulty, runSettings.feedbackByLevel);
  if (relative) keyboard.base = window.low;
  else if (trial) keyboard.base = 48;
  const partName = partIds.map((id) => current!.parts.find((x) => x.key === partKey(id))?.name ?? '').join(' + ');

  gateHandler = null;
  synth?.allNotesOff(0);
  synth?.control(0, 64, 0, 0);
  stopBacking();
  if (backingSynth) {
    backingSynth.setMasterGain(runSettings.backingVolume);
    backingSynth.setDrumChannels(song.drumChannels);
    setMix(1);
    // Duplicates of the player's part are muted unless the guide track is on.
    const muted = new Set<string>();
    if (!picker.guideTrack) {
      for (const p of current.parts) {
        if (p.duplicateOf && picker.selected.has(p.duplicateOf)) muted.add(p.key);
        if (picker.selected.has(p.key) && p.duplicateOf) muted.add(p.duplicateOf);
      }
    }
    // In practice the session counts in before every pass itself.
    scheduler = new BackingScheduler(chart.backing, backingSynth, clock, {
      mutedParts: muted,
      countIn: loop ? null : { beats: sig.numerator, beatSeconds: barSeconds / sig.numerator },
    });
  }
  session = new PlaySession({
    chart, clock, judgeConfig, rate, inputOffsetMs: runSettings.inputOffsetMs,
    synth: runSettings.synth ? synth : null, feedbackSound: feedback,
    feedbackPrograms: Object.fromEntries(current.parts.map((p) => [p.key, p.program])),
    relative, visibleSeconds, barSeconds, autoplay, countInBeats: sig.numerator,
    steadyBacking: trial, finishAtSongEnd: trial, disableStarPower: trial,
    barTimes,
    // The system's reduced-motion preference turns the particles off, unless the URL asks for them.
    effects: runSettings.effects && (params.has('effects') || !matchMedia('(prefers-reduced-motion: reduce)').matches),
    tierText: runSettings.tierText,
    feedback: feedbackProfile,
    hint: trial ? `First Lights · ${trialRate * 100} BPM · C4, E4, G4` : relative ? PlaySession.keysHint(window) : partName,
    ...(loop && choice ? {
      practice: { loop, sections, current: from, label: loopLabel(sections, from, to), wait: choice.wait, ladder: choice.ladder },
      // the count-in clicks of the scheduler's, on the band's drum channel
      click: (accent: boolean, when: number) => backingSynth?.noteOn(9, accent ? 76 : 37, accent ? 110 : 80, when),
    } : {}),
  });
  const s = session;
  s.onPass = () => {
    // The clock went back to the count-in: the band starts again from there.
    if (scheduler?.running) {
      scheduler.stop();
      scheduler.start();
    }
    if (hudEl) setPracticeRate(hudEl, s.rate);
  };
  s.onWait = (waiting) => {
    // Wait mode: the band is silent while the song is held, and picks up where it left off.
    if (!scheduler || s.status !== 'playing') return;
    if (waiting) scheduler.stop();
    else scheduler.start();
  };
  s.onOctave = (ev) => {
    if (ev.type === 'reoffset') {
      toast(`Octave adjusted (${ev.delta > 0 ? '+' : ''}${ev.delta / 12}). Keep playing.`);
      if (midi.selectedId) lowCByPort.set(midi.selectedId, window.low - s.octaveOffset);
    } else {
      toast('Your keyboard seems transposed. Check its transpose setting.', 'error');
      if (midi.selectedId) lowCByPort.delete(midi.selectedId);
      s.pause();
      runGate(window, s);
    }
  };
  s.onFinished = (result) => {
    stopBacking();
    if (trial) {
      showStudentTrialResults({ result, sound: trialSound, rate: trialRate, autoplay: !!autoplay, onRetry: play, onSetup: trialSetup, onQuit: songSelect });
      return;
    }
    if (result.practice) {
      // Practice never writes bests or stars.
      showPracticeResults({
        title: lib.title,
        detail: `${partName} · ${DIFFICULTY_LABEL[difficulty]} · ${timing} timing`,
        practice: result.practice,
        result,
        onAgain: () => practicePicker(),
        onPlaySong: () => void startPlay(null),
        onQuit: songSelect,
      });
      return;
    }
    const badges = [...(result.failed ? ['Song failed'] : []), ...(runSettings.easy ? ['Easy mode'] : []), ...(runSettings.rate < 1 ? [`${Math.round(runSettings.rate * 100)}% speed`] : []), ...(autoplay ? ['Autoplay'] : [])];
    const detail = `${partName} · ${DIFFICULTY_LABEL[difficulty]} · ${timing} timing · ${Math.round(runSettings.rate * 100)}% speed`;
    const suggestion = suggestNextStep({
      accuracy: result.accuracy, difficulty, rate: runSettings.rate, failed: result.failed, sections: result.sections, levels: offered.map((l) => l.level),
    });
    const show = (extra: string[], previousBest: number | null) =>
      showResults({
        title: lib.title, detail, result, badges: [...badges, ...extra], previousBest, suggestion,
        onSuggestion: takeSuggestion, onPractise: (sg) => practicePicker(sg.section?.start), onRetry: play, onQuit: songSelect,
      });
    if (autoplay || result.failed) show([], null);
    else {
      const key = bestKey(lib.id, partIds, wide ? picker.split : undefined, timing, runSettings.rate, runSettings.easy, keyLevel);
      getBest(key)
        .catch(() => undefined)
        .then((before) =>
          recordBest({ key, songId: lib.id, score: result.score, accuracy: result.accuracy, maxCombo: result.maxCombo, at: Date.now(), level: difficulty })
            .then(({ isNew }) => loadStars().then(() => show(isNew ? ['New best!'] : [], before?.accuracy ?? null))))
        .catch(() => show([], null));
    }
  };
  renderState = {
    chart, low: range.low, high: range.high, time: 0, pixelsPerSecond: runSettings.speed, beatLines: lines,
    noteVisuals: s.noteVisuals, keyVisuals: s.keyVisuals, popups: s.popups,
    hud: s.hud(), showNames: runSettings.names, showNoteNames: runSettings.noteNames,
    physical: relative ? window : null,
    fx: s.fx,
    feedback: feedbackProfile,
    ...(s.practice ? { practice: s.practice } : {}),
  };
  document.title = `MIDI Hero — ${lib.title}`;

  const portId = midi.selectedId;
  if (relative && !autoplay && portId && midi.status === 'granted') {
    const lowC = lowCByPort.get(portId);
    if (lowC !== undefined) {
      s.octaveOffset = window.low - lowC;
      playHud(s);
    } else {
      s.pause();
      runGate(window, s);
    }
  } else {
    playHud(s);
  }
}

/** Play the same song again the way the results screen suggested. */
function takeSuggestion(s: Suggestion): void {
  if (!current) return;
  if (s.difficulty) current.picker.difficulty = s.difficulty;
  if (s.rate) {
    settings.rate = s.rate;
    saveSettings(settings);
  }
  void startPlay(lastPlay?.autoplay ?? null);
}

function playHud(s: PlaySession): void {
  hudEl = showPlayHud({
    onPause: pause,
    onSkip: !s.practice && s.chart.firstNoteTime > 8 ? () => { s.skipToFirstNote(); scheduler?.stop(); scheduler?.start(); } : null,
    ...(s.practice ? { practice: { rate: s.rate, onStop: () => s.stopPractice() } } : {}),
  });
  // While wait mode holds the song the band stays quiet; the session starts it again.
  if (s.status === 'playing' && !s.practice?.waiting) scheduler?.start();
}

/** Thin the band's drums and pads to `level` (the session's mixLevel). */
let mix = 1;
function setMix(level: number): void {
  if (!backingSynth || Math.abs(level - mix) < 0.01) return;
  mix = level;
  backingSynth.setChannelGroupGain('drums', level);
  backingSynth.setChannelGroupGain('pads', level);
}

function stopBacking(): void {
  scheduler?.stop();
  scheduler = null;
}

/** "Press your lowest C": learns the octave shift and the input channel, then resumes. */
function runGate(window: PitchWindow, s: PlaySession): void {
  const el = showGate({
    keysHint: PlaySession.keysHint(window),
    onSkip: () => {
      gateHandler = null;
      s.resume();
      playHud(s);
    },
  });
  gateHandler = (ev) => {
    if (ev.type !== 'on' || ev.source !== 'midi') return;
    if (ev.pitch % 12 !== 0) {
      gateMessage(el, `That was ${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][ev.pitch % 12]} — press a C.`);
      return;
    }
    const offset = window.low - ev.pitch;
    s.octaveOffset = offset;
    s.filter.lock(ev.channel);
    if (midi.selectedId) lowCByPort.set(midi.selectedId, ev.pitch);
    gateHandler = null;
    toast(offset === 0 ? 'Keyboard lined up.' : `Keyboard lined up (octave ${offset > 0 ? '+' : ''}${offset / 12}).`);
    s.resume();
    playHud(s);
  };
}

function pause(): void {
  if (!session || session.status !== 'playing') return;
  const s = session;
  s.pause();
  scheduler?.stop();
  const stop = s.practice ? { onStopPractice: () => s.stopPractice() } : {};
  showPause({
    onResume: resume,
    onRestart: () => { session = null; play(); },
    onSettings: () => current?.lib.id === STUDENT_TRIAL_ID ? trialSetup() : settingsScreen(() => showPause({ onResume: resume, onRestart: () => { session = null; play(); }, onSettings: () => settingsScreen(resume), onQuit: songSelect, ...stop })),
    onQuit: songSelect,
    ...stop,
  });
}

function resume(): void {
  if (!session || session.status !== 'paused') return;
  session.resume();
  playHud(session);
}

// Esc pauses and resumes. Space switches star power on while playing, and resumes a paused song.
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' && e.code !== 'Space') return;
  if (!session || gateHandler || calibrating) return;
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
  e.preventDefault();
  if (e.repeat) return;
  if (session.status === 'paused') resume();
  else if (session.status !== 'playing') return;
  else if (e.code === 'Space') session.activateStar();
  else pause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && session?.status === 'playing' && !gateHandler) pause();
});

// ---------------------------------------------------------------------------
// Frame loop
// ---------------------------------------------------------------------------
let lastDebug = 0;
let frameCount = 0;
let fpsWindowStart = 0;
let fps = 0;
let workMs = 0; // accumulated update+draw time in the current window
let frameMs = 0; // average work per frame over the last window
const FRAME_STAMP_TRUST_MS = 50;
/**
 * One frame of work: update the session and draw it. Returns the time it took, in ms.
 * `frameMs` is the frame's own timestamp (requestAnimationFrame's): the highway is drawn at the
 * song time of that instant, not of whenever this code happens to run, so the notes move the
 * same distance every frame however long the work before the draw took (docs/FEEL.md).
 */
function step(s: PlaySession, state: RenderState, frameMs = performance.now()): number {
  const w0 = performance.now();
  s.update();
  setMix(s.mixLevel);
  const liveSettings = sessionSettings ?? settings;
  // A timestamp that is not from the last few frames (headless Chrome sends the odd stray one) is not trusted.
  const at = frameMs <= w0 && frameMs > w0 - FRAME_STAMP_TRUST_MS ? frameMs : w0;
  state.time = s.renderTimeAt(at) + (liveSettings.audioOffsetMs / 1000) * s.rate;
  state.hud = s.hud();
  (liveSettings.highway === 'perspective' ? perspectiveRenderer : renderer).draw(state);
  return performance.now() - w0;
}

if (import.meta.env.DEV) {
  // Console handle for manual and automated checks; not in production builds.
  // `bench(seconds)` runs frames back to back, without waiting for the display, and reports the work per frame.
  const bench = (seconds = 3): Promise<{ frames: number; meanMs: number; p95Ms: number; maxMs: number }> =>
    new Promise((resolve) => {
      const times: number[] = [];
      const until = performance.now() + seconds * 1000;
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        if (session && renderState && session.status === 'playing') times.push(step(session, renderState));
        if (performance.now() < until) channel.port2.postMessage(0);
        else {
          times.sort((a, b) => a - b);
          const mean = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
          resolve({ frames: times.length, meanMs: +mean.toFixed(3), p95Ms: +(times[Math.floor(times.length * 0.95)] ?? 0).toFixed(3), maxMs: +(times.at(-1) ?? 0).toFixed(3) });
        }
      };
      channel.port2.postMessage(0);
    });
  (window as unknown as { midihero: unknown }).midihero = { bench, get session() { return session; }, get renderState() { return renderState; } };
}

function frame(frameMs: number): void {
  // Ask for the next frame first: a frame that throws must not stop the game drawing for good.
  requestAnimationFrame(frame);
  frameCount++;
  const nowMs = performance.now();
  if (nowMs - fpsWindowStart >= 1000) {
    fps = (frameCount * 1000) / (nowMs - fpsWindowStart);
    frameMs = workMs / Math.max(1, frameCount);
    frameCount = 0;
    workMs = 0;
    fpsWindowStart = nowMs;
  }
  if (session && renderState) {
    workMs += step(session, renderState, frameMs);
    const t = performance.now();
    if (t - lastDebug > 250) {
      lastDebug = t;
      const j = session.judge;
      canvas.dataset.state = JSON.stringify({ status: session.status, now: +session.now().toFixed(2), score: j.score, combo: j.combo, multiplier: j.scoreMultiplier, star: +j.starGauge.toFixed(2), starOn: j.starActive, health: +j.meter.health.toFixed(2), mix: +mix.toFixed(2), counts: j.counts, ...(session.practice ? { practice: { passes: session.practice.passes, waiting: session.practice.waiting, waitingFor: session.practice.waitingFor, rate: session.rate } } : {}), offset: session.octaveOffset, locked: session.filter.locked, backing: scheduler?.running ?? false, audio: audioCtx?.state ?? 'none', notes: session.chart.notes.length, fps: +fps.toFixed(1), frameMs: +frameMs.toFixed(2) });
    }
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot(): Promise<void> {
  installDropZone((files) => void importFiles(files));
  requestAnimationFrame(frame);
  const midiReady = requestMidi();
  await loadLibrary();
  const packPath = params.get('pack');
  if (packPath) {
    try {
      await loadPackFromUrl(packPath);
      await loadLibrary();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error', 6000);
    }
  }
  const quick = params.get('song');
  const filePath = params.get('file');
  if (filePath && !/^[a-z]+:|^\/\/|\.\./i.test(filePath)) {
    library.unshift({ id: `file:${filePath}`, title: filePath.split('/').pop() ?? filePath, source: 'bundled', file: `../${filePath.replace(/^\/+/, '')}`, defaultParts: [], parts: [] });
  }
  const start = async () => {
    if (filePath) {
      await openSong(`file:${filePath}`);
      if (params.get('autoplay')) await startPlay({ jitterMs: Number(params.get('jitter') ?? 0) });
      return;
    }
    if (quick) {
      const lib = library.find((l) => l.id === quick);
      if (lib) {
        await openSong(quick);
        if (params.get('autoplay')) await startPlay({ jitterMs: Number(params.get('jitter') ?? 0) }, quick === STUDENT_TRIAL_ID ? null : urlPractice());
        return;
      }
    }
    songSelect();
    void midiReady.then(() => {
      if (!session && !current) songSelect();
    });
  };
  if (!settings.firstRunDone) {
    showFirstRun({
      onDone: (kb, soundSelf) => {
        settings = { ...settings, kb, synth: !soundSelf, feedbackSound: soundSelf ? 'off' : 'chart', firstRunDone: true };
        trialSound = soundSelf ? 'off' : 'press';
        saveSettings(settings);
        void start();
      },
    });
  } else if (!midi.supported) {
    showUnsupported({ reason: 'nomidi', onContinue: () => void start() });
  } else {
    await start();
  }
}

if (window.top !== window.self) {
  showUnsupported({ reason: 'iframe', onContinue: () => void boot() });
} else {
  boot().catch((e) => showError('Failed to start', e instanceof Error ? e.message : String(e)));
}
