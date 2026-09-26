import { GameClock } from './audio/clock.ts';
import { WebAudioSynth, type Synth } from './audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from './game/judge.ts';
import { PlaySession } from './game/session.ts';
import { KeyboardInput } from './input/keyboardInput.ts';
import { MidiInput } from './input/midiInput.ts';
import type { InputEvent } from './input/normalize.ts';
import { buildChart, chooseWindow, type Chart, type PitchWindow } from './midi/chart.ts';
import { beatLines, parseSong, ticksToSeconds } from './midi/parse.ts';
import { buildParts, defaultPart, notesOf } from './midi/parts.ts';
import type { Part, SongData } from './types.ts';
import { displayRange } from './render/layout.ts';
import { Renderer, type RenderState } from './render/renderer.ts';
import { hideScreens, showError, showPause, showPlayHud, showResults, showStart, toast } from './ui/screens.ts';
import { loadSettings, saveSettings, type Settings } from './ui/settings.ts';

interface ManifestEntry {
  id: string;
  title: string;
  file: string;
  defaultParts: { track: number; channel: number }[];
  split?: number;
}

const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

let settings: Settings = loadSettings();
const clock = new GameClock();
let audioCtx: AudioContext | null = null;
let synth: Synth | null = null;
let session: PlaySession | null = null;
let renderState: RenderState | null = null;
let manifest: ManifestEntry[] = [];
let current: { entry: ManifestEntry; song: SongData; part: Part } | null = null;

const midi = new MidiInput();
const keyboard = new KeyboardInput();
keyboard.base = settings.keyboardBase;
keyboard.onOctaveChange = (b) => {
  settings.keyboardBase = b;
  saveSettings(settings);
  toast(`Computer keyboard: lower row starts at MIDI ${b}`);
};

const onInput = (ev: InputEvent): void => {
  session?.handleInput(ev);
};
keyboard.onEvent = onInput;
midi.onEvent = onInput;
midi.onChange = () => {
  const id = midi.autoSelect(settings.midiPortId);
  toast(id ? `MIDI: ${midi.listPorts().find((p) => p.id === id)?.name ?? id}` : 'MIDI keyboard disconnected');
};
keyboard.attach();

function midiStatusText(): string {
  if (!midi.supported) return 'This browser has no Web MIDI (Safari/iPad). Use Chrome, Edge or Firefox on a Chromebook, Mac or Windows PC.';
  if (midi.status === 'denied') return 'MIDI access was blocked. Allow it in the site settings, then retry.';
  if (midi.status === 'pending') return 'Requesting MIDI access…';
  const ports = midi.listPorts();
  if (ports.length === 0) return 'MIDI ready, but no keyboard is connected.';
  const sel = ports.find((p) => p.id === midi.selectedId);
  return sel ? `MIDI keyboard: ${sel.name}` : 'MIDI ready.';
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
    audioCtx = new AudioContext({ latencyHint: 'interactive' });
    void audioCtx.resume();
    synth = new WebAudioSynth(audioCtx);
    clock.attach(audioCtx);
  } catch (e) {
    console.warn('AudioContext unavailable', e);
  }
}

/** Physical range for absolute judging, or a virtual C-aligned window for relative judging. */
function windowFor(kb: Settings['kb'], part: Part, song: SongData): { window: PitchWindow; relative: boolean } {
  if (kb === 61) return { window: { low: 36, high: 96 }, relative: false };
  if (kb === 88) return { window: { low: 21, high: 108 }, relative: false };
  const span = kb - 1;
  const pitches = notesOf(song, part).map((n) => n.pitch);
  return { window: chooseWindow(pitches, span), relative: true };
}

function songSelect(): void {
  session = null;
  renderState = null;
  showStart({
    songs: manifest.map((m) => ({ id: m.id, title: m.title, subtitle: m.file })),
    midiStatus: midiStatusText(),
    onPick: (id) => void startSong(id),
    onRetryMidi: midi.status === 'denied' || midi.status === 'unsupported' ? () => void requestMidi().then(songSelect) : undefined,
  });
}

async function startSong(id: string): Promise<void> {
  const entry = manifest.find((m) => m.id === id);
  if (!entry) return;
  ensureAudio();
  try {
    const bytes = new Uint8Array(await (await fetch(`${base}songs/${entry.file}`)).arrayBuffer());
    const song = parseSong(bytes);
    const parts = buildParts(song);
    const wanted = entry.defaultParts[0];
    const part = parts.find((p) => p.track === wanted?.track && p.channel === wanted?.channel) ?? defaultPart(parts);
    if (!part) throw new Error('No playable part in this file');
    current = { entry, song, part };
    play();
  } catch (e) {
    showError('Could not load song', e instanceof Error ? e.message : String(e), songSelect);
  }
}

function play(): void {
  if (!current) return;
  const { entry, song, part } = current;
  const { window, relative } = windowFor(settings.kb, part, song);
  const chart: Chart = buildChart(song, { parts: [part], split: entry.split, window, foldMode: settings.foldMode });
  const range = displayRange(chart.minPitch, chart.maxPitch, window);
  const lines = beatLines(song, chart.duration);
  const judgeConfig: JudgeConfig = { ...DEFAULT_JUDGE_CONFIG, preset: settings.timing, easy: settings.easy, wrongNotePenalty: settings.wrongNotePenalty };
  const sig = song.timeSigs[0]!;
  const barSeconds = ticksToSeconds(song.tempoMap, song.ppq, (song.ppq * 4 * sig.numerator) / sig.denominator);
  const visibleSeconds = (canvas.clientHeight * 0.82) / settings.speed;
  const autoplay = params.get('autoplay') ? { jitterMs: Number(params.get('jitter') ?? 0) } : null;

  // Line the computer-keyboard fallback up with the window so it is playable without a gate.
  if (relative) keyboard.base = window.low;

  session = new PlaySession({
    chart, clock, judgeConfig, rate: settings.rate, inputOffsetMs: settings.inputOffsetMs,
    synth: settings.synth ? synth : null, relative, visibleSeconds, barSeconds, autoplay,
    hint: relative ? PlaySession.keysHint(window) : part.name,
  });
  // Debug/inspection handle (used by the browser checks and handy in devtools).
  (window as unknown as { __midihero: unknown }).__midihero = { session, chart, settings };
  session.onOctave = (ev) => {
    if (ev.type === 'reoffset') toast(`Octave adjusted (${ev.delta > 0 ? '+' : ''}${ev.delta / 12}). Keep playing.`);
    else toast('Keyboard seems transposed. Check the transpose setting.', 'error');
  };
  session.onFinished = (result) => {
    showResults({
      title: entry.title,
      detail: `${part.name} · ${settings.timing} timing · ${Math.round(settings.rate * 100)}% speed`,
      result,
      badges: [...(settings.easy ? ['Easy mode'] : []), ...(settings.rate < 1 ? [`${Math.round(settings.rate * 100)}% speed`] : []), ...(autoplay ? ['Autoplay'] : [])],
      onRetry: play,
      onQuit: songSelect,
    });
  };
  renderState = {
    chart, low: range.low, high: range.high, time: 0, pixelsPerSecond: settings.speed, beatLines: lines,
    noteVisuals: session.noteVisuals, keyVisuals: session.keyVisuals, popups: session.popups,
    hud: session.hud(), showNames: settings.names, showNoteNames: settings.noteNames,
    physical: relative ? window : null,
  };
  document.title = `MIDI Hero — ${entry.title}`;
  showPlayHud({ onPause: pause, onSkip: chart.firstNoteTime > 8 ? () => session?.skipToFirstNote() : null });
}

function pause(): void {
  if (!session || session.status !== 'playing') return;
  session.pause();
  showPause({
    onResume: resume,
    onRestart: () => { session = null; play(); },
    onQuit: songSelect,
  });
}

function resume(): void {
  if (!session || session.status !== 'paused') return;
  session.resume();
  showPlayHud({ onPause: pause, onSkip: null });
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape' || e.code === 'Space') {
    if (!session) return;
    e.preventDefault();
    if (session.status === 'playing') pause();
    else if (session.status === 'paused') resume();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

let lastDebug = 0;
function frame(): void {
  if (session && renderState) {
    session.update();
    renderState.time = session.now() + (settings.audioOffsetMs / 1000) * settings.rate;
    renderState.hud = session.hud();
    renderer.draw(renderState);
    // Inspection: mirror a summary into the DOM a few times a second (readable by tests and devtools).
    const t = performance.now();
    if (t - lastDebug > 250) {
      lastDebug = t;
      const j = session.judge;
      canvas.dataset.state = JSON.stringify({ status: session.status, now: +session.now().toFixed(2), score: j.score, combo: j.combo, counts: j.counts, offset: session.octaveOffset, locked: session.filter.locked });
    }
  }
  requestAnimationFrame(frame);
}

async function main(): Promise<void> {
  void requestMidi().then(() => {
    if (!session) songSelect();
  });
  manifest = (await (await fetch(`${base}songs/manifest.json`)).json()) as ManifestEntry[];
  songSelect();
  requestAnimationFrame(frame);
  const auto = params.get('song');
  if (auto && params.get('autoplay')) void startSong(auto);
}

main().catch((e) => showError('Failed to start', e instanceof Error ? e.message : String(e)));
