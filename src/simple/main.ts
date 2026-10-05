/**
 * MIDI Hero, simple mode (/simple/): big song cards, an automatic keyboard check, play with a
 * count-in, results, and a one-tap feedback form kept on this device. The engine (parse, chart,
 * session, scheduler, renderers) is the full game's; only the screens and the defaults differ.
 * `?teacher=1` shows the feedback collected on this machine, with CSV/JSON export and clear.
 */
import { GameClock } from '../audio/clock.ts';
import { BackingScheduler } from '../audio/scheduler.ts';
import { WebAudioSynth, type Synth } from '../audio/synth.ts';
import { feedbackFor } from '../game/feedback.ts';
import { DEFAULT_JUDGE_CONFIG, OVERHOLD_COST, type JudgeConfig } from '../game/judge.ts';
import { starCount } from '../game/results.ts';
import { PlaySession } from '../game/session.ts';
import { KeyboardInput } from '../input/keyboardInput.ts';
import { MidiInput } from '../input/midiInput.ts';
import type { InputEvent } from '../input/normalize.ts';
import { buildChart, chooseWindow, offeredLevels, resolveLevel, splitNotes, type PitchWindow } from '../midi/chart.ts';
import { beatLines, parseSong, ticksToSeconds } from '../midi/parse.ts';
import { buildParts, defaultPart } from '../midi/parts.ts';
import { horizonSeconds, PerspectiveRenderer } from '../render/highway3d.ts';
import { displayRange, noteName } from '../render/layout.ts';
import { Renderer, type RenderState } from '../render/renderer.ts';
import { partKey, type PartId, type SongData } from '../types.ts';
import { effectiveFeedback, loadSettings, type Settings } from '../ui/settings.ts';
import { difficultyFor, LEVEL_LABEL, SIMPLE_SONGS, simpleSettings, type SimpleLevel, type SimpleSong } from './config.ts';
import { FeedbackStore, QUESTIONS, summarize, toCsv, toJson, COMMENT_MAX, type Answers, type StorageLike } from './feedback.ts';
import { cheer, initialFlow, step, summarizeRun, type FlowEvent, type FlowState } from './flow.ts';

interface ManifestEntry {
  id: string;
  file: string;
  defaultParts: PartId[];
}

const base = import.meta.env.BASE_URL;
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage') as HTMLCanvasElement;
const overlay = document.getElementById('overlay')!;

function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
const store = new FeedbackStore(localStore());

// ---------------------------------------------------------------------------
// Small DOM helpers
// ---------------------------------------------------------------------------
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function screen(html: string, cls = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen ${cls}`;
  el.innerHTML = html;
  overlay.replaceChildren(el);
  return el;
}

function toast(message: string, ms = 3500): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.textContent = message;
  overlay.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function on(el: HTMLElement, sel: string, fn: () => void): void {
  el.querySelector(sel)?.addEventListener('click', fn);
}

const titleOf = (id: string): string => SIMPLE_SONGS.find((s) => s.id === id)?.title ?? id;

// ---------------------------------------------------------------------------
// Teacher view
// ---------------------------------------------------------------------------
function download(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function teacherView(): void {
  canvas.style.display = 'none';
  const rows = store.all();
  const sum = summarize(rows);
  const browser = store.browserId();
  const day = new Date().toISOString().slice(0, 10);
  const fileBase = `midihero-feedback-${browser.slice(0, 8)}-${day}`;
  const qRows = QUESTIONS.map((q) => `<tr><th>${esc(q.text)}</th>${q.options.map((o) => `<td>${esc(o.label)}: <b>${sum.answers[q.key][o.value] ?? 0}</b></td>`).join('')}<td>no answer: ${sum.answers[q.key][''] ?? 0}</td></tr>`).join('');
  const songRows = Object.entries(sum.songs).map(([id, s]) => `<tr><td>${esc(titleOf(id))}</td><td>${s.runs}</td><td>${Math.round(s.meanAccuracy * 100)}%</td></tr>`).join('');
  const comments = rows.filter((r) => r.comment).slice(-50).reverse()
    .map((r) => `<tr><td>${esc(new Date(r.at).toLocaleString())}</td><td>${esc(titleOf(r.song))}</td><td>${esc(r.comment)}</td></tr>`).join('');
  const el = screen(`<div class="teacher" style="display:flex;flex-direction:column;gap:16px">
    <h1>Student feedback on this machine</h1>
    <p>Responses are stored only in this browser on this computer. Nothing is sent anywhere. Export on each machine, then combine the files.
      This browser's random id: <code>${esc(browser.slice(0, 8))}</code>.</p>
    <div class="grid">
      <div class="box"><b style="font-size:32px">${sum.responses}</b><br>responses</div>
      <div class="box"><b style="font-size:32px">${sum.finished}</b><br>played to the end</div>
      <div class="box"><b style="font-size:32px">${sum.comments}</b><br>with a comment</div>
      <div class="box"><b style="font-size:32px">${sum.browsers}</b><br>browser ids</div>
    </div>
    <div class="row">
      <button class="primary" id="csv" ${rows.length ? '' : 'disabled'}>Download CSV</button>
      <button id="json" ${rows.length ? '' : 'disabled'}>Download JSON</button>
      <button class="danger" id="clear" ${rows.length ? '' : 'disabled'}>Clear all responses…</button>
      <a href="./" style="color:var(--accent);margin-left:auto">Student view</a>
    </div>
    <div class="box"><table><tbody>${qRows}</tbody></table></div>
    <div class="box"><table><thead><tr><th>Song</th><th>Runs</th><th>Mean accuracy</th></tr></thead><tbody>${songRows || '<tr><td colspan="3">No runs yet.</td></tr>'}</tbody></table></div>
    <div class="box"><h2 style="font-size:22px;text-align:left;margin-bottom:8px">Comments (newest first, last 50)</h2>
      <table><tbody>${comments || '<tr><td>No comments yet.</td></tr>'}</tbody></table></div>
  </div>`);
  el.style.alignItems = 'stretch';
  on(el, '#csv', () => download(`${fileBase}.csv`, toCsv(rows), 'text/csv'));
  on(el, '#json', () => download(`${fileBase}.json`, toJson(rows), 'application/json'));
  on(el, '#clear', () => {
    if (!window.confirm(`Delete all ${rows.length} responses on this computer? Download them first: this cannot be undone.`)) return;
    store.clear();
    teacherView();
  });
}

// ---------------------------------------------------------------------------
// Engine: audio, input, one run
// ---------------------------------------------------------------------------
const saved: Settings = loadSettings();
const clock = new GameClock();
let audioCtx: AudioContext | null = null;
let synth: Synth | null = null;
let backingSynth: WebAudioSynth | null = null;
let scheduler: BackingScheduler | null = null;
let session: PlaySession | null = null;
let renderState: RenderState | null = null;
let runSettings: Settings | null = null;
let flatRenderer: Renderer | null = null;
let perspectiveRenderer: PerspectiveRenderer | null = null;
/** the keyboard check's handler; while set, input goes to it instead of a session */
let checkHandler: ((ev: InputEvent) => void) | null = null;
/** the C at or below the key pressed in the check (MIDI only), to line the octave up */
let checkC: number | null = null;
let manifest: ManifestEntry[] | null = null;
const songs = new Map<string, SongData>();

const midi = new MidiInput();
const keyboard = new KeyboardInput();
keyboard.onOctaveChange = (b) => toast(`Computer keys: bottom row now starts at ${noteName(b)}`);
const onInput = (ev: InputEvent): void => {
  if (checkHandler) checkHandler(ev);
  else session?.handleInput(ev);
};
keyboard.onEvent = onInput;
midi.onEvent = onInput;
midi.onChange = () => {
  const id = midi.autoSelect(saved.midiPortId);
  if (!id) dispatch({ type: 'disconnected' }, false);
  toast(id ? `Keyboard: ${midi.listPorts().find((p) => p.id === id)?.name ?? 'connected'}` : 'Music keyboard unplugged');
  if (flow.screen === 'songs') render();
};

function midiStatus(): string {
  if (!midi.supported) return 'This browser has no MIDI. Use Chrome. You can still play with the computer keys.';
  if (midi.status === 'denied') return 'MIDI is blocked. Click the icon left of the address bar and allow MIDI.';
  if (midi.status === 'pending') return 'Looking for your keyboard…';
  const port = midi.listPorts().find((p) => p.id === midi.selectedId);
  return port ? `Keyboard ready: ${port.name}` : 'No music keyboard found. Plug it in, or use the computer keys.';
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
    const attach = () => {
      if (ctx.state === 'running' && !clock.hasAudio) clock.attach(ctx);
    };
    ctx.onstatechange = attach;
    void ctx.resume().then(attach, attach);
    attach();
  } catch (e) {
    console.warn('AudioContext unavailable', e);
  }
}

async function loadSong(id: string): Promise<{ song: SongData; parts: PartId[] }> {
  manifest ??= (await (await fetch(`${base}songs/manifest.json`)).json()) as ManifestEntry[];
  const entry = manifest.find((m) => m.id === id);
  if (!entry) throw new Error(`Song not found: ${id}`);
  let song = songs.get(id);
  if (!song) {
    const res = await fetch(`${base}songs/${entry.file}`);
    if (!res.ok) throw new Error(`Could not load ${entry.file}`);
    song = parseSong(new Uint8Array(await res.arrayBuffer()));
    songs.set(id, song);
  }
  const all = buildParts(song);
  const keys = new Set(all.map((p) => p.key));
  let parts = entry.defaultParts.filter((p) => keys.has(partKey(p)));
  if (parts.length === 0) {
    const d = defaultPart(all);
    if (d) parts = [{ track: d.track, channel: d.channel }];
  }
  return { song, parts };
}

function stopBacking(): void {
  scheduler?.stop();
  scheduler = null;
}

function endEngine(): void {
  stopBacking();
  synth?.allNotesOff(0);
  session = null;
  renderState = null;
  runSettings = null;
}

async function startRun(entry: SimpleSong, level: SimpleLevel): Promise<void> {
  ensureAudio();
  const { song, parts } = await loadSong(entry.id);
  const settings = simpleSettings(saved, level, entry);
  const trial = !!entry.trial;
  const offered = offeredLevels(splitNotes(song, { parts }).player, song).map((l) => l.level);
  const difficulty = resolveLevel(trial ? 'easy' : difficultyFor(level), offered);
  const feedback = effectiveFeedback(settings);
  const unfolded = buildChart(song, { parts, difficulty });
  const window: PitchWindow = trial ? { low: 48, high: 72 } : chooseWindow(unfolded.notes.map((n) => n.origPitch), settings.kb - 1);
  const relative = !trial;
  const chart = buildChart(song, { parts, window, foldMode: settings.foldMode, difficulty, removed: feedback === 'chart' ? 'carry' : 'backing' });
  if (chart.notes.length === 0) throw new Error('This song has no notes to play.');
  const range = displayRange(chart.minPitch, chart.maxPitch, window);
  const lines = beatLines(song, chart.duration);
  const barTimes = lines.filter((l) => l.isBar).map((l) => l.time);
  const sig = song.timeSigs[0]!;
  const barSeconds = ticksToSeconds(song.tempoMap, song.ppq, (song.ppq * 4 * sig.numerator) / sig.denominator);
  const hitLineY = canvas.clientHeight * 0.82;
  const visibleSeconds = settings.highway === 'perspective' ? horizonSeconds(hitLineY, settings.speed) : hitLineY / settings.speed;
  const profile = feedbackFor(difficulty, settings.feedbackByLevel);
  const judgeConfig: JudgeConfig = {
    ...DEFAULT_JUDGE_CONFIG, preset: settings.timing, easy: settings.easy, wrongNotePenalty: settings.wrongNotePenalty,
    failAt: null, overhold: settings.letGo ? OVERHOLD_COST[difficulty] : null,
  };
  keyboard.base = trial ? 48 : window.low;
  const autoplay = import.meta.env.DEV && params.get('autoplay') ? { jitterMs: Number(params.get('jitter') ?? 0) } : null;

  endEngine();
  synth?.control(0, 64, 0, 0);
  if (backingSynth) {
    backingSynth.setMasterGain(settings.backingVolume);
    backingSynth.setDrumChannels(song.drumChannels);
    backingSynth.setChannelGroupGain('drums', 1);
    backingSynth.setChannelGroupGain('pads', 1);
    scheduler = new BackingScheduler(chart.backing, backingSynth, clock, { countIn: { beats: sig.numerator, beatSeconds: barSeconds / sig.numerator } });
  }
  const s = new PlaySession({
    chart, clock, judgeConfig, rate: settings.rate, inputOffsetMs: settings.inputOffsetMs,
    synth: settings.synth ? synth : null, feedbackSound: feedback,
    feedbackPrograms: Object.fromEntries(buildParts(song).map((p) => [p.key, p.program])),
    relative, visibleSeconds, barSeconds, autoplay, countInBeats: sig.numerator,
    steadyBacking: trial, finishAtSongEnd: trial, disableStarPower: trial,
    barTimes,
    effects: settings.effects && !matchMedia('(prefers-reduced-motion: reduce)').matches,
    tierText: settings.tierText,
    feedback: profile,
    hint: flow.input === 'keyboard'
      ? `Computer keys: bottom row Z X C V B N M starts at ${noteName(keyboard.base)}`
      : `${entry.title} · ${LEVEL_LABEL[level]}`,
  });
  if (relative && flow.input === 'midi' && checkC !== null) s.octaveOffset = window.low - checkC;
  s.onOctave = (ev) => {
    if (ev.type === 'reoffset') toast('Octave lined up. Keep playing!');
  };
  s.onFinished = (result) => {
    endEngine();
    dispatch({ type: 'finished', run: summarizeRun(result, entry.id, level, true) });
  };
  session = s;
  runSettings = settings;
  renderState = {
    chart, low: range.low, high: range.high, time: 0, pixelsPerSecond: settings.speed, beatLines: lines,
    noteVisuals: s.noteVisuals, keyVisuals: s.keyVisuals, popups: s.popups,
    hud: s.hud(), showNames: settings.names, showNoteNames: settings.noteNames,
    physical: relative ? window : null, fx: s.fx, feedback: profile,
  };
  document.title = `MIDI Hero — ${entry.title}`;
  playHud();
  scheduler?.start();
}

function stopRun(): void {
  const s = session;
  if (!s || !flow.song) return;
  s.pause();
  const result = s.result();
  endEngine();
  dispatch({ type: 'finished', run: summarizeRun(result, flow.song, flow.level, false) });
}

function pauseRun(): void {
  if (!session || session.status !== 'playing') return;
  session.pause();
  scheduler?.stop();
  const el = screen(`<h1>Paused</h1>
    <div class="row"><button class="primary huge" id="resume">Keep playing</button><button class="huge" id="stop">Stop</button></div>`, 'center');
  el.style.background = 'rgba(11, 13, 18, 0.85)';
  on(el, '#resume', resumeRun);
  on(el, '#stop', stopRun);
  el.querySelector<HTMLButtonElement>('#resume')?.focus();
}

function resumeRun(): void {
  if (!session || session.status !== 'paused') return;
  session.resume();
  playHud();
  scheduler?.start();
}

function playHud(): void {
  const el = screen('<div class="hud"><button id="stop">Stop</button></div>', 'transparent');
  on(el, '#stop', stopRun);
}

window.addEventListener('keydown', (e) => {
  if (!session || checkHandler) return;
  if (e.code !== 'Escape' && e.code !== 'Space') return;
  const target = e.target as HTMLElement | null;
  if (target && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(target.tagName)) return;
  e.preventDefault();
  if (e.repeat) return;
  if (session.status === 'paused') resumeRun();
  else if (e.code === 'Space') session.activateStar();
  else pauseRun();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseRun();
});

function frame(): void {
  requestAnimationFrame(frame);
  const s = session;
  const state = renderState;
  if (!s || !state || !runSettings) return;
  s.update();
  if (!session) return; // the song just finished
  state.time = s.now() + (runSettings.audioOffsetMs / 1000) * s.rate;
  state.hud = s.hud();
  if (runSettings.highway === 'perspective') (perspectiveRenderer ??= new PerspectiveRenderer(canvas)).draw(state);
  else (flatRenderer ??= new Renderer(canvas)).draw(state);
}

if (import.meta.env.DEV) {
  (window as unknown as { midihero: unknown }).midihero = { get session() { return session; }, get flow() { return flow; } };
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
let flow: FlowState = initialFlow();

function dispatch(e: FlowEvent, rerender = true): void {
  const before = flow.screen;
  flow = step(flow, e);
  if (rerender && (flow.screen !== before || e.type === 'level')) render();
}

function render(): void {
  checkHandler = null;
  switch (flow.screen) {
    case 'songs': return songsScreen();
    case 'check': return checkScreen();
    case 'play': return playScreen();
    case 'results': return resultsScreen();
    case 'feedback': return feedbackScreen();
  }
}

function songsScreen(): void {
  endEngine();
  document.title = 'MIDI Hero';
  const cards = SIMPLE_SONGS.map((s) => `<button class="card" data-id="${esc(s.id)}" style="--card:${s.color}">
      <span class="t">${esc(s.title)}</span><span class="b">${esc(s.blurb)}</span></button>`).join('');
  const level = (l: SimpleLevel) => `<button data-level="${l}" aria-pressed="${flow.level === l}">${LEVEL_LABEL[l]}</button>`;
  const el = screen(`
    ${flow.thanks ? '<div class="banner" role="status">Thanks! Pick a song to play again.</div>' : ''}
    <h1>MIDI Hero</h1>
    <p>Pick a song. The notes fall down; play each one when it reaches the keys.</p>
    <div class="toggle" role="group" aria-label="Level">${level('easy')}${level('normal')}</div>
    <div class="cards">${cards}</div>
    <p class="status">${esc(midiStatus())}</p>`);
  el.querySelectorAll<HTMLButtonElement>('[data-level]').forEach((b) =>
    b.addEventListener('click', () => dispatch({ type: 'level', level: b.dataset.level as SimpleLevel })));
  el.querySelectorAll<HTMLButtonElement>('.card').forEach((b) =>
    b.addEventListener('click', () => {
      ensureAudio(); // a click: the browser lets sound start now
      dispatch({ type: 'pick', song: b.dataset.id! });
    }));
}

function checkScreen(): void {
  const entry = SIMPLE_SONGS.find((s) => s.id === flow.song);
  const el = screen(`
    <h1>Keyboard check</h1>
    <p style="font-size:28px;color:var(--text)">Press the <b>first key on the left</b> of your keyboard.</p>
    <div class="big-key" id="key" aria-live="polite">?</div>
    <p id="msg"></p>
    <p>No music keyboard? Press <b>Z</b> on the computer keyboard.</p>
    <p class="status">${esc(midiStatus())}</p>
    <div class="row"><button id="back">Back</button><button id="anyway" hidden>Play anyway</button></div>`, 'center');
  const keyEl = el.querySelector<HTMLElement>('#key')!;
  const msg = el.querySelector<HTMLElement>('#msg')!;
  on(el, '#back', () => dispatch({ type: 'home' }));
  on(el, '#anyway', () => dispatch({ type: 'checked', input: 'midi' }));
  let done = false;
  checkHandler = (ev) => {
    ensureAudio();
    if (ev.type !== 'on' || done) return;
    const name = noteName(ev.pitch);
    keyEl.innerHTML = `<span class="ok">${esc(name.replace(/-?\d+$/, ''))} ✓</span>`;
    if (ev.source === 'midi') {
      checkC = ev.pitch - (((ev.pitch % 12) + 12) % 12);
      // First Lights uses exact pitches in the middle of the keyboard.
      if (entry?.trial && (ev.pitch < 48 || ev.pitch > 72)) {
        msg.innerHTML = `It works, but your keyboard is shifted (you played ${esc(name)}). Press the octave <b>${ev.pitch < 48 ? '+' : '−'}</b> button, then press a key again.`;
        el.querySelector<HTMLElement>('#anyway')!.hidden = false;
        return;
      }
    }
    done = true;
    msg.innerHTML = `<b class="ok" style="font-size:32px">It works!</b> Get ready…`;
    synth?.noteOn(0, ev.source === 'midi' ? ev.pitch : 60, 90, 0);
    setTimeout(() => synth?.noteOff(0, ev.source === 'midi' ? ev.pitch : 60, 0), 300);
    const input = ev.source === 'midi' ? 'midi' : 'keyboard';
    setTimeout(() => {
      if (flow.screen === 'check') dispatch({ type: 'checked', input });
    }, 1200);
  };
  keyboard.base = 48;
}

function playScreen(): void {
  const entry = SIMPLE_SONGS.find((s) => s.id === flow.song);
  if (!entry) return dispatch({ type: 'home' });
  screen('<h1>Get ready…</h1>', 'center');
  startRun(entry, flow.level).catch((e) => {
    endEngine();
    const el = screen(`<h1>That song would not load</h1><p>${esc(e instanceof Error ? e.message : String(e))}</p>
      <button class="primary huge" id="back">Back to songs</button>`, 'center');
    on(el, '#back', () => dispatch({ type: 'home' }));
  });
}

function resultsScreen(): void {
  const run = flow.run;
  if (!run) return dispatch({ type: 'home' });
  const n = run.finished || run.hit > 0 ? starCount(run.accuracy) : 0;
  const stars = Array.from({ length: 5 }, (_, i) => `<span class="${i < n ? '' : 'off'}">★</span>`).join('');
  const el = screen(`
    <h1>${esc(cheer(n, run.finished))}</h1>
    <div class="stars" aria-label="${n} of 5 stars">${stars}</div>
    <p style="font-size:30px;color:var(--text)">You played <b>${run.hit}</b> of <b>${run.total}</b> notes on time.</p>
    <p>${esc(titleOf(run.song))} · ${LEVEL_LABEL[run.level]}</p>
    <button class="primary huge" id="next">Next</button>`, 'center');
  on(el, '#next', () => dispatch({ type: 'next' }));
  el.querySelector<HTMLButtonElement>('#next')?.focus();
}

function feedbackScreen(): void {
  const run = flow.run;
  if (!run) return dispatch({ type: 'home' });
  const answers: Answers = {};
  const qs = QUESTIONS.map((q) => `<div class="q" role="group" aria-label="${esc(q.text)}"><div class="text">${esc(q.text)}</div>
      <div class="opts">${q.options.map((o) => `<button data-q="${q.key}" data-v="${o.value}" aria-pressed="false">${esc(o.label)}</button>`).join('')}</div></div>`).join('');
  const el = screen(`
    <h2>Tell us what you think</h2>
    ${qs}
    <label class="lbl" for="comment">Anything else? (optional)<br><span style="font-weight:500;color:var(--warn)">Please don't write your name or anyone else's.</span></label>
    <textarea id="comment" maxlength="${COMMENT_MAX}" placeholder="What was good? What was confusing?"></textarea>
    <button class="primary huge" id="done">Done</button>`);
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = b.dataset.q as keyof Answers;
      answers[key] = b.dataset.v!;
      el.querySelectorAll<HTMLButtonElement>(`[data-q="${key}"]`).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
  on(el, '#done', () => {
    const comment = el.querySelector<HTMLTextAreaElement>('#comment')!.value;
    if (!store.add(run, flow.input, answers, comment)) toast('This computer could not save the answers.');
    dispatch({ type: 'submitted' });
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
if (params.get('teacher') === '1') {
  teacherView();
} else {
  keyboard.attach();
  requestAnimationFrame(frame);
  void midi.request().then((status) => {
    if (status === 'granted') midi.autoSelect(saved.midiPortId);
    if (flow.screen === 'songs') render();
  });
  render();
}
