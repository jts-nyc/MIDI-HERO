import type { PlayResult } from '../game/session.ts';
import type { TimingPreset } from '../game/judge.ts';
import type { MidiPort } from '../input/midiInput.ts';
import { DIFFICULTIES, DIFFICULTY_LABEL, type Difficulty, type Hand, type LevelStats } from '../midi/chart.ts';
import type { Part } from '../types.ts';
import { noteName } from '../render/layout.ts';
import { effectiveFeedback, type KeyboardSize, type Settings } from './settings.ts';

const overlay = (): HTMLElement => document.getElementById('overlay')!;

export function hideScreens(): void {
  overlay().innerHTML = '';
}

function screen(html: string, transparent = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `screen${transparent ? ' transparent' : ''}`;
  el.innerHTML = html;
  overlay().replaceChildren(el);
  return el;
}

export function toast(message: string, kind: 'info' | 'error' = 'info', ms = 3500): void {
  const el = document.createElement('div');
  el.className = `toast ${kind === 'error' ? 'error' : ''}`;
  el.textContent = message;
  overlay().appendChild(el);
  setTimeout(() => el.remove(), ms);
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmtTime = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------
export function showFirstRun(o: { onDone: (kb: KeyboardSize, soundSelf: boolean) => void }): void {
  const el = screen(`<div class="panel">
    <h1>Welcome to MIDI Hero</h1>
    <h2>How many keys does your keyboard have?</h2>
    <div class="row" id="kb">
      <button data-kb="25" class="primary">25</button><button data-kb="49">49</button><button data-kb="61">61</button><button data-kb="88">88</button>
    </div>
    <h2>Does your keyboard make sound by itself?</h2>
    <div class="row" id="sound">
      <button data-sound="0" class="primary">No, play sound from the computer</button><button data-sound="1">Yes, it has speakers</button>
    </div>
    <p>You can change these later in Settings.</p>
    <div class="row"><button class="primary big" id="done">Continue</button></div>
  </div>`);
  let kb: KeyboardSize = 25;
  let soundSelf = false;
  const pick = (group: string, attr: string, cb: (v: string) => void) => {
    el.querySelectorAll<HTMLButtonElement>(`#${group} button`).forEach((b) =>
      b.addEventListener('click', () => {
        el.querySelectorAll(`#${group} button`).forEach((x) => x.classList.remove('primary'));
        b.classList.add('primary');
        cb(b.dataset[attr]!);
      }),
    );
  };
  pick('kb', 'kb', (v) => (kb = Number(v) as KeyboardSize));
  pick('sound', 'sound', (v) => (soundSelf = v === '1'));
  el.querySelector('#done')!.addEventListener('click', () => o.onDone(kb, soundSelf));
}

// ---------------------------------------------------------------------------
// Unsupported / embedded
// ---------------------------------------------------------------------------
export function showUnsupported(o: { reason: 'nomidi' | 'iframe'; onContinue: () => void }): void {
  const html =
    o.reason === 'iframe'
      ? `<h2>Open MIDI Hero in its own tab</h2>
         <p>Embedded pages cannot use MIDI keyboards. Open the app in a new tab to play.</p>
         <div class="row"><a href="${esc(location.href)}" target="_blank" rel="noopener"><button class="primary big">Open in new tab</button></a><button id="cont">Continue anyway</button></div>`
      : `<h2>This browser can't connect a MIDI keyboard</h2>
         <p>Safari and iPad browsers have no Web MIDI support. Use <b>Chrome, Edge or Firefox</b> on a Chromebook, Mac or Windows PC to play with a keyboard.</p>
         <p>You can still watch songs in autoplay or use the computer keyboard.</p>
         <div class="row"><button class="primary" id="cont">Continue without a MIDI keyboard</button></div>`;
  const el = screen(`<div class="panel">${html}</div>`);
  el.querySelector('#cont')?.addEventListener('click', o.onContinue);
}

// ---------------------------------------------------------------------------
// Song select
// ---------------------------------------------------------------------------
export interface SongRow {
  id: string;
  title: string;
  subtitle: string;
  group: 'class' | 'builtin';
  best?: string;
  deletable: boolean;
}

export interface SongSelectOptions {
  songs: SongRow[];
  midiStatus: string;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: (files: File[]) => void;
  onExport: () => void;
  onSettings: () => void;
  onRetryMidi: (() => void) | null;
}

export function showSongSelect(o: SongSelectOptions): void {
  const row = (s: SongRow) => `<div class="item" data-id="${esc(s.id)}">
      <div><div>${esc(s.title)}</div><div class="meta">${esc(s.subtitle)}${s.best ? ` · best ${esc(s.best)}` : ''}</div></div>
      <div class="row">${s.deletable ? '<button class="del" title="Remove">✕</button>' : ''}<button class="primary play">Play</button></div>
    </div>`;
  const cls = o.songs.filter((s) => s.group === 'class');
  const builtin = o.songs.filter((s) => s.group === 'builtin');
  const el = screen(`<div class="panel">
    <div class="row" style="justify-content:space-between"><h1>MIDI Hero</h1><div class="row"><button id="import">Import .mid / pack</button><button id="export">Export class pack</button><button id="settings">Settings</button></div></div>
    <p>${esc(o.midiStatus)} ${o.onRetryMidi ? '<button id="retry-midi">Retry</button>' : ''}</p>
    <p>Drop <b>.mid</b> files or a <b>.midihero.json</b> pack anywhere on this page to add songs. Computer keyboard: <span class="kbd">Z</span>–<span class="kbd">M</span> / <span class="kbd">Q</span>–<span class="kbd">U</span> play notes, <span class="kbd">-</span>/<span class="kbd">=</span> shift octave.</p>
    ${cls.length ? `<h2>Class songs</h2><div class="list">${cls.map(row).join('')}</div>` : ''}
    <h2>Built-in</h2><div class="list">${builtin.map(row).join('')}</div>
    <input type="file" id="file" accept=".mid,.midi,.json" multiple style="display:none" />
  </div>`);
  el.querySelectorAll<HTMLElement>('.item').forEach((item) => {
    item.querySelector('.play')!.addEventListener('click', () => o.onPick(item.dataset.id!));
    item.querySelector('.del')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm('Remove this song from this device?')) o.onDelete(item.dataset.id!);
    });
  });
  const file = el.querySelector<HTMLInputElement>('#file')!;
  el.querySelector('#import')!.addEventListener('click', () => file.click());
  file.addEventListener('change', () => {
    if (file.files?.length) o.onImport([...file.files]);
  });
  el.querySelector('#export')!.addEventListener('click', o.onExport);
  el.querySelector('#settings')!.addEventListener('click', o.onSettings);
  el.querySelector('#retry-midi')?.addEventListener('click', () => o.onRetryMidi?.());
}

/** Page-wide drag and drop. Call once. */
export function installDropZone(onFiles: (files: File[]) => void): void {
  let depth = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    document.body.classList.add('dropzone');
  });
  document.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) document.body.classList.remove('dropzone');
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove('dropzone');
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) onFiles(files);
  });
}

// ---------------------------------------------------------------------------
// Export pack dialog
// ---------------------------------------------------------------------------
export function showExportDialog(o: { songs: { id: string; title: string }[]; defaultName: string; onExport: (name: string, ids: string[]) => void; onBack: () => void }): void {
  const el = screen(`<div class="panel">
    <h2>Export class pack</h2>
    <p>Choose the songs to include. Each song keeps the part, split and timing you picked for it. The pack also carries the current keyboard size, timing preset and display settings as class defaults.</p>
    <label class="field">Pack name <input id="name" value="${esc(o.defaultName)}" /></label>
    <div class="list">${o.songs.map((s) => `<label class="item"><span>${esc(s.title)}</span><input type="checkbox" data-id="${esc(s.id)}" checked /></label>`).join('')}</div>
    <div class="row"><button class="primary" id="go">Download pack</button><button id="back">Back</button></div>
  </div>`);
  el.querySelector('#go')!.addEventListener('click', () => {
    const ids = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox]')].filter((c) => c.checked).map((c) => c.dataset.id!);
    const name = (el.querySelector<HTMLInputElement>('#name')!.value || o.defaultName).trim();
    if (ids.length) o.onExport(name, ids);
  });
  el.querySelector('#back')!.addEventListener('click', o.onBack);
}

// ---------------------------------------------------------------------------
// Part picker
// ---------------------------------------------------------------------------
export interface PartRow {
  part: Part;
  foldedRatio: number;
  duplicateOfName: string | null;
}

export interface PartPickerState {
  selected: Set<string>;
  split: number;
  hands: Hand[];
  timing: TimingPreset;
  /** keep a duplicate of the player's part audible in the backing */
  guideTrack: boolean;
  difficulty: Difficulty;
}

export interface PartPickerOptions {
  title: string;
  rows: PartRow[];
  /** note count and density of the selection at each difficulty; empty when nothing is selected */
  levels: LevelStats[];
  state: PartPickerState;
  kb: KeyboardSize;
  /** true when the single selected part spans more than two octaves */
  onChange: (state: PartPickerState) => void;
  onPlay: () => void;
  onBack: () => void;
}

export function showPartPicker(o: PartPickerOptions): void {
  const st = o.state;
  const rows = o.rows
    .map(({ part: p, foldedRatio, duplicateOfName }) => {
      const playable = p.kind === 'melodic' && !duplicateOfName;
      const badges = [
        p.kind === 'drums' ? '<span class="badge">Drums</span>' : '',
        p.kind === 'sfx' ? '<span class="badge">Sound effects</span>' : '',
        duplicateOfName ? `<span class="badge">same as ${esc(duplicateOfName)}</span>` : '',
        playable && foldedRatio > 0.15 ? `<span class="badge warn">hard on ${o.kb} keys</span>` : '',
      ].join('');
      return `<tr class="part ${st.selected.has(p.key) ? 'selected' : ''} ${playable ? '' : 'dim'}" data-key="${esc(p.key)}" data-playable="${playable ? 1 : 0}">
        <td>${st.selected.has(p.key) ? '✓' : ''}</td>
        <td>${esc(p.name)}${badges}</td>
        <td>${p.noteCount}</td>
        <td>${p.notesPerSec.toFixed(1)}</td>
        <td>${p.maxChord}</td>
        <td>${noteName(p.minPitch)}–${noteName(p.maxPitch)}</td>
        <td>${fmtTime(p.firstNoteTime)}</td>
        <td>${playable ? `${Math.round(foldedRatio * 100)}%` : ''}</td>
      </tr>`;
    })
    .join('');
  const single = [...st.selected].length === 1 ? o.rows.find((r) => r.part.key === [...st.selected][0]) : undefined;
  const hasGuide = o.rows.some((r) => r.part.duplicateOf && st.selected.has(r.part.duplicateOf));
  const wide = !!single && single.part.maxPitch - single.part.minPitch > 24;
  const splitOptions = [48, 53, 55, 57, 60, 62, 64, 65, 67, 72].map((p) => `<option value="${p}" ${st.split === p ? 'selected' : ''}>${noteName(p)}</option>`).join('');
  const el = screen(`<div class="panel" style="width:min(900px,100%)">
    <h2>${esc(o.title)}</h2>
    <p>Pick the part(s) you will play. Everything else becomes the backing band.</p>
    <table>
      <tr><th></th><th>Part</th><th>Notes</th><th>Notes/s</th><th>Chord</th><th>Range</th><th>Starts</th><th>Folded</th></tr>
      ${rows}
    </table>
    ${o.levels.length ? `<div class="seg" id="difficulty" role="radiogroup" aria-label="Difficulty">${DIFFICULTIES.map((d) => {
      const l = o.levels.find((x) => x.level === d)!;
      return `<button role="radio" aria-checked="${st.difficulty === d}" class="${st.difficulty === d ? 'primary' : ''}" data-level="${d}">
        <b>${DIFFICULTY_LABEL[d]}</b><span>${l.noteCount} notes · ${l.notesPerSec.toFixed(1)}/s</span></button>`;
    }).join('')}</div>` : ''}
    ${wide ? `<div class="row" style="margin-top:12px">
      <label class="field">Hand split at <select id="split">${splitOptions}</select></label>
      <label class="field">Play <select id="hands">
        <option value="both" ${st.hands.length === 2 ? 'selected' : ''}>both hands</option>
        <option value="R" ${st.hands.length === 1 && st.hands[0] === 'R' ? 'selected' : ''}>right hand only</option>
        <option value="L" ${st.hands.length === 1 && st.hands[0] === 'L' ? 'selected' : ''}>left hand only</option>
      </select></label></div>` : ''}
    <div class="row" style="margin-top:12px">
      ${hasGuide ? `<label class="field"><input type="checkbox" id="guide" ${st.guideTrack ? 'checked' : ''} /> Keep the guide track (a copy of my part) audible</label>` : ''}
      <label class="field">Timing <select id="timing">
        ${(['strict', 'normal', 'relaxed'] as TimingPreset[]).map((t) => `<option value="${t}" ${st.timing === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select></label>
      <span style="flex:1"></span>
      <button id="back">Back</button>
      <button class="primary big" id="play" ${st.selected.size ? '' : 'disabled'}>Play</button>
    </div>
  </div>`);
  el.querySelectorAll<HTMLElement>('tr.part').forEach((tr) =>
    tr.addEventListener('click', () => {
      if (tr.dataset.playable !== '1') return;
      const key = tr.dataset.key!;
      if (st.selected.has(key)) st.selected.delete(key);
      else st.selected.add(key);
      o.onChange(st);
    }),
  );
  el.querySelectorAll<HTMLButtonElement>('#difficulty button').forEach((b) =>
    b.addEventListener('click', () => {
      st.difficulty = b.dataset.level as Difficulty;
      o.onChange(st);
    }),
  );
  el.querySelector<HTMLSelectElement>('#split')?.addEventListener('change', (e) => {
    st.split = Number((e.target as HTMLSelectElement).value);
    o.onChange(st);
  });
  el.querySelector<HTMLSelectElement>('#hands')?.addEventListener('change', (e) => {
    const v = (e.target as HTMLSelectElement).value;
    st.hands = v === 'both' ? ['L', 'R'] : [v as Hand];
    o.onChange(st);
  });
  el.querySelector<HTMLInputElement>('#guide')?.addEventListener('change', (e) => {
    st.guideTrack = (e.target as HTMLInputElement).checked;
    o.onChange(st);
  });
  el.querySelector<HTMLSelectElement>('#timing')!.addEventListener('change', (e) => {
    st.timing = (e.target as HTMLSelectElement).value as TimingPreset;
    o.onChange(st);
  });
  el.querySelector('#back')!.addEventListener('click', o.onBack);
  el.querySelector('#play')!.addEventListener('click', o.onPlay);
}

// ---------------------------------------------------------------------------
// Gate: press your lowest C
// ---------------------------------------------------------------------------
export function showGate(o: { keysHint: string; onSkip: () => void }): HTMLElement {
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>Press the lowest C on your keyboard</h2>
    <p>${esc(o.keysHint)}. This tells the game where your keyboard's octave buttons are set.</p>
    <p id="gate-msg"></p>
    <div class="row" style="justify-content:center"><button id="skip">Skip (computer keyboard)</button></div>
  </div>`);
  el.querySelector('#skip')!.addEventListener('click', o.onSkip);
  return el;
}

export function gateMessage(el: HTMLElement, msg: string): void {
  const m = el.querySelector('#gate-msg');
  if (m) m.textContent = msg;
}

// ---------------------------------------------------------------------------
// Play HUD, pause, results
// ---------------------------------------------------------------------------
export function showPlayHud(o: { onPause: () => void; onSkip: (() => void) | null }): void {
  const el = screen(`<div class="hud-hint">
      ${o.onSkip ? '<button id="skip">Skip to my part ⏩</button>' : ''}
      <button id="pause">Pause</button>
    </div>`, true);
  el.querySelector('#pause')!.addEventListener('click', o.onPause);
  el.querySelector('#skip')?.addEventListener('click', () => {
    o.onSkip?.();
    el.querySelector('#skip')?.remove();
  });
}

export function showPause(o: { onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void }): void {
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>Paused</h2>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="resume">Resume</button>
      <button id="restart">Restart</button>
      <button id="settings">Settings</button>
      <button id="quit">Song select</button>
    </div>
    <p>Space or Esc to resume</p>
  </div>`);
  el.querySelector('#resume')!.addEventListener('click', o.onResume);
  el.querySelector('#restart')!.addEventListener('click', o.onRestart);
  el.querySelector('#settings')!.addEventListener('click', o.onSettings);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
}

export function stars(accuracy: number): string {
  const n = accuracy >= 0.95 ? 5 : accuracy >= 0.85 ? 4 : accuracy >= 0.7 ? 3 : accuracy >= 0.5 ? 2 : accuracy > 0 ? 1 : 0;
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export function showResults(o: { title: string; detail: string; result: PlayResult; badges: string[]; onRetry: () => void; onQuit: () => void }): void {
  const r = o.result;
  const c = r.counts;
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>${esc(o.title)}</h2>
    <p>${esc(o.detail)}</p>
    <div class="accuracy">${(r.accuracy * 100).toFixed(1)}%</div>
    <div class="stars">${stars(r.accuracy)}</div>
    <p>${o.badges.map((b) => `<span class="badge warn">${esc(b)}</span>`).join(' ')}</p>
    <table style="max-width:420px;margin:12px auto">
      <tr><td>Score</td><td><b>${r.score}</b></td><td>Max combo</td><td><b>${r.maxCombo}</b></td></tr>
      <tr><td>Perfect</td><td>${c.perfect}</td><td>Great</td><td>${c.great}</td></tr>
      <tr><td>Good</td><td>${c.good}</td><td>Late/early</td><td>${c.late}</td></tr>
      <tr><td>Missed</td><td>${c.miss}</td><td>Wrong notes</td><td>${c.wrong}</td></tr>
    </table>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="retry">Play again</button>
      <button id="quit">Song select</button>
    </div>
  </div>`);
  el.querySelector('#retry')!.addEventListener('click', o.onRetry);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
}

export function showError(title: string, message: string, onBack?: () => void): void {
  const el = screen(`<div class="panel"><h2>${esc(title)}</h2><p>${esc(message)}</p>${onBack ? '<button id="back">Back</button>' : ''}</div>`);
  el.querySelector('#back')?.addEventListener('click', () => onBack?.());
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export interface SettingsScreenOptions {
  settings: Settings;
  ports: MidiPort[];
  selectedPort: string | null;
  midiStatus: string;
  latencyMs: number | null;
  lockedChannel: number | null;
  onChange: (s: Settings) => void;
  onSelectPort: (id: string | null) => void;
  onResetChannel: () => void;
  onResetClassDefaults: () => void;
  onClose: () => void;
}

export function showSettings(o: SettingsScreenOptions): void {
  const s = o.settings;
  const fb = effectiveFeedback(s);
  const opt = (v: string | number, label: string, cur: string | number) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${label}</option>`;
  const chk = (id: keyof Settings, label: string) => `<label class="field">${label}<input type="checkbox" id="${id}" ${s[id] ? 'checked' : ''} /></label>`;
  const num = (id: keyof Settings, label: string, min: number, max: number, step: number) =>
    `<label class="field">${label}<input type="number" id="${id}" value="${s[id]}" min="${min}" max="${max}" step="${step}" style="width:90px" /></label>`;
  const el = screen(`<div class="panel">
    <div class="row" style="justify-content:space-between"><h2>Settings</h2><button id="close" class="primary">Done</button></div>
    <p>${esc(o.midiStatus)}</p>
    <label class="field">MIDI keyboard <select id="port">${opt('', o.ports.length ? '— choose —' : 'none connected', o.selectedPort ?? '')}${o.ports.map((p) => opt(p.id, p.name, o.selectedPort ?? '')).join('')}</select></label>
    <label class="field">Keyboard size <select id="kb">${[25, 49, 61, 88].map((k) => opt(k, `${k} keys`, s.kb)).join('')}</select></label>
    <label class="field">Timing <select id="timing">${['strict', 'normal', 'relaxed'].map((t) => opt(t, t, s.timing)).join('')}</select></label>
    <label class="field">Playback speed <select id="rate">${[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1].map((r) => opt(r, `${Math.round(r * 100)}%`, s.rate)).join('')}</select></label>
    ${num('speed', 'Scroll speed (px/s)', 100, 800, 25)}
    ${chk('names', 'Note names on keys')}
    ${chk('noteNames', 'Note names on falling notes')}
    <label class="field">Sound of my notes <select id="feedbackSound">${opt('chart', "the song's part when I play it right", fb)}${opt('press', 'every key I press (free play)', fb)}${opt('off', 'none: my keyboard has speakers (set Local Control ON)', fb)}</select></label>
    ${chk('easy', 'Easy mode: any octave counts')}
    <label class="field">Wrong notes <select id="wrongNotePenalty">${opt('combo', 'reset combo', s.wrongNotePenalty)}${opt('none', 'ignore', s.wrongNotePenalty)}${opt('score', 'reset combo and lose points', s.wrongNotePenalty)}</select></label>
    <label class="field">Notes outside my keyboard <select id="foldMode">${opt('fold', 'fold into range', s.foldMode)}${opt('drop', 'drop', s.foldMode)}</select></label>
    ${num('audioOffsetMs', 'Visual offset (ms, + if notes look late)', -300, 300, 5)}
    ${num('inputOffsetMs', 'Input offset (ms, + if hits judge late)', -300, 300, 5)}
    ${num('backingVolume', 'Backing volume (0–1)', 0, 1, 0.05)}
    <p>Audio latency: ${o.latencyMs === null ? 'audio not started yet' : `${o.latencyMs.toFixed(0)} ms${o.latencyMs > 60 ? ' — high; use wired headphones or speakers' : ''}`}.
       Input channel: ${o.lockedChannel === null ? 'any' : `${o.lockedChannel + 1}`} <button id="resetch">Reset</button></p>
    <div class="row"><button id="resetclass">Reset to class defaults</button></div>
  </div>`);
  const update = () => {
    const get = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
    const next: Settings = {
      ...s,
      kb: Number(get<HTMLSelectElement>('kb').value) as KeyboardSize,
      timing: get<HTMLSelectElement>('timing').value as TimingPreset,
      rate: Number(get<HTMLSelectElement>('rate').value),
      speed: Number(get<HTMLInputElement>('speed').value),
      names: get<HTMLInputElement>('names').checked,
      noteNames: get<HTMLInputElement>('noteNames').checked,
      synth: get<HTMLSelectElement>('feedbackSound').value !== 'off',
      feedbackSound: get<HTMLSelectElement>('feedbackSound').value as Settings['feedbackSound'],
      easy: get<HTMLInputElement>('easy').checked,
      wrongNotePenalty: get<HTMLSelectElement>('wrongNotePenalty').value as Settings['wrongNotePenalty'],
      foldMode: get<HTMLSelectElement>('foldMode').value as Settings['foldMode'],
      audioOffsetMs: Number(get<HTMLInputElement>('audioOffsetMs').value),
      inputOffsetMs: Number(get<HTMLInputElement>('inputOffsetMs').value),
      backingVolume: Number(get<HTMLInputElement>('backingVolume').value),
    };
    o.onChange(next);
  };
  el.querySelectorAll('select, input').forEach((i) => {
    if (i.id !== 'port') i.addEventListener('change', update);
  });
  el.querySelector<HTMLSelectElement>('#port')!.addEventListener('change', (e) => o.onSelectPort((e.target as HTMLSelectElement).value || null));
  el.querySelector('#resetch')!.addEventListener('click', o.onResetChannel);
  el.querySelector('#resetclass')!.addEventListener('click', o.onResetClassDefaults);
  el.querySelector('#close')!.addEventListener('click', o.onClose);
}
