import { CALIBRATION_BEATS, TapCalibrator, visualOffset, type CalibrationResult } from '../game/calibration.ts';
import { bestDelta, starCount, type Suggestion } from '../game/results.ts';
import type { PracticeSectionInfo } from '../game/practice.ts';
import type { PlayResult, PracticeResult } from '../game/session.ts';
import type { TrialRate, TrialSound } from '../game/studentTrial.ts';
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

/** A deliberately small, fixed musical task; regular song settings remain separate. */
export function showStudentTrial(o: {
  sound: TrialSound; rate: TrialRate;
  onEnableSound: () => void;
  onChange: (sound: TrialSound, rate: TrialRate) => void;
  onPlay: () => void; onBack: () => void;
}): HTMLElement {
  const el = screen(`<div class="panel">
    <h1>First Lights · student trial</h1>
    <p>Four bars, eight notes: C4–G4 · C4–E4 · C4–G4 · E4–C4. Hold each for two beats.</p>
    <p>You play the melody. The backing keeps going through mistakes. Every key sounds the pitch you play.</p>
    <label class="field">Your instrument sound <select id="trial-sound">
      <option value="press"${o.sound === 'press' ? ' selected' : ''}>Computer sound</option>
      <option value="off"${o.sound === 'off' ? ' selected' : ''}>My keyboard's own sound</option>
    </select></label>
    <p>Use one sound source for your keys. With computer sound, turn off the keyboard's own sound. With keyboard sound, enable its speakers or headphones and Local Control.</p>
    <label class="field">Tempo <select id="trial-rate">
      <option value="1"${o.rate === 1 ? ' selected' : ''}>100 BPM</option>
      <option value="0.75"${o.rate === 0.75 ? ' selected' : ''}>75 BPM</option>
      <option value="0.5"${o.rate === 0.5 ? ' selected' : ''}>50 BPM</option>
    </select></label>
    <h2>Try your keys first</h2>
    <p><button id="trial-enable">Enable audio</button></p>
    <p>Press C4, E4 and G4. Use your keyboard's octave buttons until these pitches appear below. Computer keys: Q = C4, E = E4, T = G4.</p>
    <p id="trial-key" aria-live="polite">Waiting for a key…</p>
    <p>Keep the same tempo and sound for comparison attempts. This is an early trial of audibility and recovery.</p>
    <div class="row"><button class="primary big" id="trial-play">Start with count-in</button><button id="trial-back">Song select</button></div>
  </div>`);
  const sound = el.querySelector<HTMLSelectElement>('#trial-sound')!;
  const rate = el.querySelector<HTMLSelectElement>('#trial-rate')!;
  const change = () => o.onChange(sound.value as TrialSound, Number(rate.value) as TrialRate);
  el.querySelector('#trial-enable')!.addEventListener('click', o.onEnableSound);
  sound.addEventListener('change', change);
  rate.addEventListener('change', change);
  el.querySelector('#trial-play')!.addEventListener('click', o.onPlay);
  el.querySelector('#trial-back')!.addEventListener('click', o.onBack);
  return el;
}

export function showStudentTrialResults(o: {
  result: PlayResult; sound: TrialSound; rate: TrialRate; autoplay: boolean;
  onRetry: () => void; onSetup: () => void; onQuit: () => void;
}): void {
  const c = o.result.counts;
  const el = screen(`<div class="panel" style="text-align:center">
    <h1>First Lights · attempt complete</h1>
    <p>${o.rate * 100} BPM · ${o.sound === 'press' ? 'computer sound' : 'keyboard sound'}${o.autoplay ? ' · autoplay demonstration' : ''}</p>
    <p>${c.perfect + c.great + c.good} of ${o.result.total} notes on time · ${c.late} early/late · ${c.miss} missed · ${c.wrong} extra or wrong presses</p>
    <p>Could you hear your part? After a mistake, could you find the next entrance?</p>
    <div class="row" style="justify-content:center"><button class="primary big" id="trial-retry">Try again — same settings</button><button id="trial-setup">Change tempo or sound</button><button id="trial-quit">Song select</button></div>
  </div>`);
  el.querySelector('#trial-retry')!.addEventListener('click', o.onRetry);
  el.querySelector('#trial-setup')!.addEventListener('click', o.onSetup);
  el.querySelector('#trial-quit')!.addEventListener('click', o.onQuit);
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
  /** the pack it came in, and its place in the pack's setlist */
  pack?: string;
  packIndex?: number;
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
  // Songs from a pack are its setlist: under the pack's name, in pack order. Loose imports come first.
  const loose = cls.filter((s) => !s.pack);
  const packs = [...new Set(cls.filter((s) => s.pack).map((s) => s.pack!))];
  const setlist = (name: string) =>
    `<h2>${esc(name)}</h2><div class="list">${cls.filter((s) => s.pack === name).sort((a, b) => (a.packIndex ?? 0) - (b.packIndex ?? 0)).map(row).join('')}</div>`;
  const el = screen(`<div class="panel">
    <div class="row" style="justify-content:space-between"><h1>MIDI Hero</h1><div class="row"><button id="import">Import .mid / pack</button><button id="export">Export class pack</button><button id="settings">Settings</button></div></div>
    <p>${esc(o.midiStatus)} ${o.onRetryMidi ? '<button id="retry-midi">Retry</button>' : ''}</p>
    <p>Drop <b>.mid</b> files or a <b>.midihero.json</b> pack anywhere on this page to add songs. Computer keyboard: <span class="kbd">Z</span>–<span class="kbd">M</span> / <span class="kbd">Q</span>–<span class="kbd">U</span> play notes, <span class="kbd">-</span>/<span class="kbd">=</span> shift octave.</p>
    ${loose.length ? `<h2>Class songs</h2><div class="list">${loose.map(row).join('')}</div>` : ''}
    ${packs.map(setlist).join('')}
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
export function showExportDialog(o: { songs: { id: string; title: string }[]; defaultName: string; onExport: (name: string, ids: string[], unlocks: boolean) => void; onBack: () => void }): void {
  const el = screen(`<div class="panel">
    <h2>Export class pack</h2>
    <p>Choose the songs to include. Each song keeps the part, split and timing you picked for it. The pack also carries the current keyboard size, timing preset and display settings as class defaults.</p>
    <label class="field">Pack name <input id="name" value="${esc(o.defaultName)}" /></label>
    <div class="list">${o.songs.map((s) => `<label class="item"><span>${esc(s.title)}</span><input type="checkbox" data-id="${esc(s.id)}" checked /></label>`).join('')}</div>
    <label class="field"><input type="checkbox" id="unlocks" /> Unlock levels in order: a harder level opens once the one below has 4 stars</label>
    <div class="row"><button class="primary" id="go">Download pack</button><button id="back">Back</button></div>
  </div>`);
  el.querySelector('#go')!.addEventListener('click', () => {
    const ids = [...el.querySelectorAll<HTMLInputElement>('input[type=checkbox][data-id]')].filter((c) => c.checked).map((c) => c.dataset.id!);
    const name = (el.querySelector<HTMLInputElement>('#name')!.value || o.defaultName).trim();
    if (ids.length) o.onExport(name, ids, el.querySelector<HTMLInputElement>('#unlocks')!.checked);
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
  /** the levels the selection has, with note count and density; empty when nothing is selected */
  levels: LevelStats[];
  /** the level that will be played: the chosen one, or the nearest the selection has */
  level: Difficulty;
  /** levels shown but not offered yet (a pack that unlocks levels in order) */
  locked?: readonly Difficulty[];
  /** stars on the level below that unlock a level */
  unlockStars?: number;
  state: PartPickerState;
  kb: KeyboardSize;
  /** true when the single selected part spans more than two octaves */
  onChange: (state: PartPickerState) => void;
  onPlay: () => void;
  /** open practice mode on the selection */
  onPractise: () => void;
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
    ${o.levels.length ? `<div class="seg" id="difficulty" role="radiogroup" aria-label="Difficulty" style="grid-template-columns:repeat(${o.levels.length},1fr)">${o.levels.map((l, i) =>
      o.locked?.includes(l.level)
        ? `<button role="radio" aria-checked="false" disabled title="Locked" data-level="${l.level}">
        <b>${DIFFICULTY_LABEL[l.level]}</b><span>Locked: ${o.unlockStars ?? 4} stars on ${DIFFICULTY_LABEL[o.levels[i - 1]?.level ?? l.level]} opens it</span></button>`
        : `<button role="radio" aria-checked="${o.level === l.level}" class="${o.level === l.level ? 'primary' : ''}" data-level="${l.level}">
        <b>${DIFFICULTY_LABEL[l.level]}</b><span>${l.noteCount} notes · ${l.notesPerSec.toFixed(1)}/s</span></button>`).join('')}</div>
      ${o.levels.length < DIFFICULTIES.length ? `<p class="levels-note">${DIFFICULTY_LABEL[o.levels[o.levels.length - 1]!.level]} is the whole part: there is nothing harder to add.</p>` : ''}` : ''}
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
      <button class="big" id="practise" ${st.selected.size ? '' : 'disabled'} title="Loop a few bars, slower, until they are clean">Practise…</button>
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
  el.querySelector('#practise')!.addEventListener('click', o.onPractise);
}

// ---------------------------------------------------------------------------
// Practice: pick the bars to loop
// ---------------------------------------------------------------------------
export interface PracticeChoice {
  /** first and last section of the loop, indices into `sections` */
  from: number;
  to: number;
  wait: boolean;
  ladder: boolean;
  rate: number;
}

export interface PracticePickerOptions {
  title: string;
  /** the level being practised, e.g. "Medium" */
  level: string;
  sections: readonly PracticeSectionInfo[];
  choice: PracticeChoice;
  rates: readonly number[];
  onStart: (choice: PracticeChoice) => void;
  onBack: () => void;
}

export function showPracticePicker(o: PracticePickerOptions): void {
  const c = { ...o.choice };
  const el = screen(`<div class="panel" style="width:min(640px,100%)">
    <h2>Practise: ${esc(o.title)}</h2>
    <p>Pick the bars to loop (${esc(o.level)}). Click a section; shift-click another to loop a run of them. Each pass starts with a one-bar count-in. Practice never changes your best scores.</p>
    <div class="list" id="sections" role="listbox" aria-multiselectable="true">${o.sections.map((s, i) =>
      `<button class="item" role="option" data-i="${i}"><span>${esc(s.label)}</span><span class="meta">${s.notes} notes · ${s.notesPerSec.toFixed(1)}/s</span></button>`).join('')}</div>
    <div class="row" style="margin-top:12px">
      <label class="field">Start at <select id="rate">${o.rates.map((r) => `<option value="${r}" ${Math.abs(r - c.rate) < 1e-9 ? 'selected' : ''}>${Math.round(r * 100)}% speed</option>`).join('')}</select></label>
      <label class="field"><input type="checkbox" id="ladder" ${c.ladder ? 'checked' : ''} /> Speed ladder: faster after two clean passes, slower after two missed ones</label>
      <label class="field"><input type="checkbox" id="wait" ${c.wait ? 'checked' : ''} /> Wait for me: the song holds at each note until I play it</label>
    </div>
    <div class="row" style="margin-top:12px">
      <span style="flex:1"></span>
      <button id="back">Back</button>
      <button class="primary big" id="start">Start practice</button>
    </div>
  </div>`);
  const items = [...el.querySelectorAll<HTMLButtonElement>('#sections .item')];
  const mark = (): void => {
    const a = Math.min(c.from, c.to);
    const b = Math.max(c.from, c.to);
    items.forEach((it, i) => {
      const on = i >= a && i <= b;
      it.classList.toggle('selected', on);
      it.setAttribute('aria-selected', String(on));
    });
  };
  items.forEach((it, i) =>
    it.addEventListener('click', (e) => {
      if (e.shiftKey) c.to = i;
      else c.from = c.to = i;
      mark();
    }),
  );
  mark();
  el.querySelector<HTMLSelectElement>('#rate')!.addEventListener('change', (e) => (c.rate = Number((e.target as HTMLSelectElement).value)));
  el.querySelector<HTMLInputElement>('#ladder')!.addEventListener('change', (e) => (c.ladder = (e.target as HTMLInputElement).checked));
  el.querySelector<HTMLInputElement>('#wait')!.addEventListener('change', (e) => (c.wait = (e.target as HTMLInputElement).checked));
  el.querySelector('#back')!.addEventListener('click', o.onBack);
  el.querySelector('#start')!.addEventListener('click', () => o.onStart({ ...c, from: Math.min(c.from, c.to), to: Math.max(c.from, c.to) }));
}

export interface PracticeResultsOptions {
  title: string;
  detail: string;
  practice: PracticeResult;
  /** the pass that was under way when practice stopped, or the last one */
  result: PlayResult;
  onAgain: () => void;
  onPlaySong: () => void;
  onQuit: () => void;
}

export function showPracticeResults(o: PracticeResultsOptions): void {
  const p = o.practice;
  const c = o.result.counts;
  const el = screen(`<div class="panel results still" style="text-align:center">
    <h2>Practice: ${esc(o.title)}</h2>
    <p>${esc(o.detail)}</p>
    <div class="accuracy">${esc(p.label)}</div>
    <table style="max-width:420px;margin:12px auto">
      <tr><td>Passes</td><td><b>${p.passes}</b></td><td>Clean passes</td><td><b>${p.cleanPasses}</b></td></tr>
      <tr><td>Speed reached</td><td><b>${Math.round(p.rate * 100)}%</b></td><td>Wait for me</td><td>${p.wait ? 'on' : 'off'}</td></tr>
      <tr><td>This pass: hit</td><td>${c.perfect + c.great + c.good} of ${o.result.total}</td><td>Missed / wrong</td><td>${c.miss} / ${c.wrong}</td></tr>
    </table>
    <p class="next">${p.cleanPasses > 0 ? (p.rate >= 1 ? 'Clean at full speed: try it in the whole song.' : 'Clean passes! Keep going, or play the whole song.') : 'A clean pass has no missed or wrong notes. Slow down if it keeps slipping.'}</p>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="again">Practise again</button>
      <button id="song">Play the whole song</button>
      <button id="quit">Song select</button>
    </div>
  </div>`);
  el.querySelector('#again')!.addEventListener('click', o.onAgain);
  el.querySelector('#song')!.addEventListener('click', o.onPlaySong);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
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
export function showPlayHud(o: { onPause: () => void; onSkip: (() => void) | null; practice?: { rate: number; onStop: () => void } }): HTMLElement {
  const el = screen(`<div class="hud-hint">
      ${o.onSkip ? '<button id="skip">Skip to my part ⏩</button>' : ''}
      ${o.practice ? `<span class="badge" id="practice-rate" aria-live="polite">${Math.round(o.practice.rate * 100)}% speed</span><button id="stop">Stop practice</button>` : ''}
      <button id="pause">Pause</button>
    </div>`, true);
  el.querySelector('#pause')!.addEventListener('click', o.onPause);
  el.querySelector('#stop')?.addEventListener('click', () => o.practice?.onStop());
  el.querySelector('#skip')?.addEventListener('click', () => {
    o.onSkip?.();
    el.querySelector('#skip')?.remove();
  });
  return el;
}

/** The practice speed shown on the play screen, after the ladder moved it. */
export function setPracticeRate(el: HTMLElement, rate: number): void {
  const r = el.querySelector('#practice-rate');
  if (r) r.textContent = `${Math.round(rate * 100)}% speed`;
}

export function showPause(o: { onResume: () => void; onRestart: () => void; onSettings: () => void; onQuit: () => void; onStopPractice?: () => void }): void {
  const el = screen(`<div class="panel" style="text-align:center">
    <h2>Paused</h2>
    <div class="row" style="justify-content:center">
      <button class="primary big" id="resume">Resume</button>
      ${o.onStopPractice ? '<button id="stop">Stop practice</button>' : ''}
      <button id="restart">Restart</button>
      <button id="settings">Settings</button>
      <button id="quit">Song select</button>
    </div>
    <p>Esc or Space to resume</p>
  </div>`);
  el.querySelector('#resume')!.addEventListener('click', o.onResume);
  el.querySelector('#restart')!.addEventListener('click', o.onRestart);
  el.querySelector('#stop')?.addEventListener('click', () => o.onStopPractice?.());
  el.querySelector('#settings')!.addEventListener('click', o.onSettings);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
}

export function stars(accuracy: number): string {
  const n = starCount(accuracy);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

export interface ResultsOptions {
  title: string;
  detail: string;
  result: PlayResult;
  badges: string[];
  /** accuracy of the best play before this one, if there was one */
  previousBest?: number | null;
  /** the one next step to offer, with what happens when it is taken */
  suggestion?: Suggestion | null;
  onSuggestion?: (s: Suggestion) => void;
  /** open practice mode on the suggested section */
  onPractise?: (s: Suggestion) => void;
  onRetry: () => void;
  onQuit: () => void;
}

const sectionLabel = (s: { fromBar: number; toBar: number }): string => (s.fromBar === s.toBar ? `Bar ${s.fromBar}` : `Bars ${s.fromBar}–${s.toBar}`);

const COUNT_UP_MS = 1200;
const STAR_STAGGER_MS = 220;

export function showResults(o: ResultsOptions): void {
  const r = o.result;
  const c = r.counts;
  const n = starCount(r.accuracy);
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delta = bestDelta(r.accuracy, o.previousBest);
  const better = o.previousBest !== null && o.previousBest !== undefined && r.accuracy > o.previousBest;
  const sections = r.sections.length > 1 ? `<div class="sections">${r.sections.map((s, i) => `<div class="section">
      <span>${esc(s.label)}</span>
      <div class="bar"><div class="fill ${s.accuracy >= 0.9 ? 'good' : s.accuracy >= 0.7 ? 'ok' : 'weak'}" style="--w:${(s.accuracy * 100).toFixed(1)}%;--i:${i}"></div></div>
      <span>${Math.round(s.accuracy * 100)}%</span>
    </div>`).join('')}</div>` : '';
  const sug = o.suggestion;
  const el = screen(`<div class="panel results${still ? ' still' : ''}" style="text-align:center">
    <h2>${esc(o.title)}</h2>
    <p>${esc(o.detail)}</p>
    <div class="accuracy" id="accuracy">${still ? (r.accuracy * 100).toFixed(1) : '0.0'}%</div>
    ${delta ? `<div class="delta ${better ? 'up' : ''}">${esc(delta)} against your best (${(o.previousBest! * 100).toFixed(1)}%)</div>` : ''}
    <div class="stars">${[0, 1, 2, 3, 4].map((i) => `<span class="star ${i < n ? 'on' : ''}" style="--d:${COUNT_UP_MS + i * STAR_STAGGER_MS}ms">${i < n ? '★' : '☆'}</span>`).join('')}</div>
    <p>${o.badges.map((b) => `<span class="badge warn">${esc(b)}</span>`).join(' ')}</p>
    <p class="streak-line">Longest streak <b>${r.maxCombo}</b> of ${r.total} notes</p>
    ${sections}
    <table style="max-width:420px;margin:12px auto">
      <tr><td>Score</td><td><b>${r.score}</b></td><td>Notes hit</td><td><b>${c.perfect + c.great + c.good}</b> of ${r.total}</td></tr>
      <tr><td>Perfect</td><td>${c.perfect}</td><td>Great</td><td>${c.great}</td></tr>
      <tr><td>Good</td><td>${c.good}</td><td>Late/early</td><td>${c.late}</td></tr>
      <tr><td>Missed</td><td>${c.miss}</td><td>Wrong notes</td><td>${c.wrong}</td></tr>
      ${c.overheld ? `<tr><td>Held too long</td><td>${c.overheld}</td><td>That cost</td><td>${r.overholdLoss} points</td></tr>` : ''}
    </table>
    ${sug ? `<p class="next">Next step: <b>${esc(sug.text)}</b></p>` : ''}
    <div class="row" style="justify-content:center">
      ${sug && (sug.difficulty || sug.rate) ? `<button class="primary big" id="next">${esc(sug.text)}</button><button id="retry">Play again</button>` : '<button class="primary big" id="retry">Play again</button>'}
      ${sug?.section && o.onPractise ? `<button id="practise">Practise ${esc(sectionLabel(sug.section).toLowerCase())}</button>` : ''}
      <button id="quit">Song select</button>
    </div>
  </div>`);
  el.querySelector('#retry')!.addEventListener('click', o.onRetry);
  el.querySelector('#quit')!.addEventListener('click', o.onQuit);
  el.querySelector('#next')?.addEventListener('click', () => o.onSuggestion?.(sug!));
  el.querySelector('#practise')?.addEventListener('click', () => o.onPractise?.(sug!));
  if (still) return;
  // Count the percentage up, easing out; the stars follow one by one (CSS, delayed past the count).
  const acc = el.querySelector<HTMLElement>('#accuracy')!;
  const t0 = performance.now();
  const tick = (now: number): void => {
    if (!acc.isConnected) return;
    const t = Math.min(1, (now - t0) / COUNT_UP_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    acc.textContent = `${(r.accuracy * 100 * eased).toFixed(1)}%`;
    if (t < 1) requestAnimationFrame(tick);
    else acc.classList.add('landed');
  };
  requestAnimationFrame(tick);
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
  onCalibrate: () => void;
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
    <label class="field">Highway <select id="highway">${opt('flat', 'Flat', s.highway)}${opt('perspective', 'Perspective', s.highway)}</select></label>
    ${chk('names', 'Note names on keys')}
    ${chk('noteNames', 'Note names on falling notes')}
    <label class="field">Sound of my notes <select id="feedbackSound">${opt('chart', "the song's part when I play it right", fb)}${opt('press', 'every key I press (free play)', fb)}${opt('off', 'none: my keyboard has speakers (set Local Control ON)', fb)}</select></label>
    ${chk('easy', 'Easy mode: any octave counts')}
    ${chk('arcade', 'Arcade mode: the song ends when the performance meter runs out')}
    ${chk('effects', 'Hit effects (turn off on a slow computer)')}
    <label class="field">Timing words over hits <select id="tierText">${opt('perfect', 'Perfect only', s.tierText)}${opt('all', 'Perfect, Great, Good', s.tierText)}${opt('off', 'none (misses still show)', s.tierText)}</select></label>
    ${chk('letGo', 'Keys held after their note is over bonk and cost points (Medium and up)')}
    <label class="field">Wrong notes <select id="wrongNotePenalty">${opt('combo', 'reset combo', s.wrongNotePenalty)}${opt('none', 'ignore', s.wrongNotePenalty)}${opt('score', 'reset combo and lose points', s.wrongNotePenalty)}</select></label>
    <label class="field">Notes outside my keyboard <select id="foldMode">${opt('fold', 'fold into range', s.foldMode)}${opt('drop', 'drop', s.foldMode)}</select></label>
    ${num('audioOffsetMs', 'Visual offset (ms, + if notes look late)', -300, 300, 5)}
    ${num('inputOffsetMs', 'Input offset (ms, + if hits judge late)', -300, 300, 5)}
    <div class="row" style="justify-content:flex-end"><button id="calibrate">Measure these: calibrate timing…</button></div>
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
      highway: get<HTMLSelectElement>('highway').value as Settings['highway'],
      names: get<HTMLInputElement>('names').checked,
      noteNames: get<HTMLInputElement>('noteNames').checked,
      synth: get<HTMLSelectElement>('feedbackSound').value !== 'off',
      feedbackSound: get<HTMLSelectElement>('feedbackSound').value as Settings['feedbackSound'],
      easy: get<HTMLInputElement>('easy').checked,
      arcade: get<HTMLInputElement>('arcade').checked,
      effects: get<HTMLInputElement>('effects').checked,
      tierText: get<HTMLSelectElement>('tierText').value as Settings['tierText'],
      letGo: get<HTMLInputElement>('letGo').checked,
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
  el.querySelector('#calibrate')!.addEventListener('click', o.onCalibrate);
  el.querySelector('#close')!.addEventListener('click', o.onClose);
}

// ---------------------------------------------------------------------------
// Calibration: tap along to 8 clicks, then to 8 things you see
// ---------------------------------------------------------------------------
export type CalibrationKind = 'input' | 'visual';

export interface CalibrationOptions {
  inputOffsetMs: number;
  audioOffsetMs: number;
  /**
   * Start a run on a fresh clock; 'input' plays the clicks, 'visual' is silent. Returns the beat
   * times in seconds, or null when the sound is not running yet.
   */
  start: (kind: CalibrationKind) => { leadIn: number[]; scored: number[] } | null;
  /** seconds on the clock of the run: now, and at a performance timestamp */
  now: () => number;
  timeOf: (perfMs: number) => number;
  /** every key press (MIDI or computer keyboard) goes to the handler while the screen is open; null stops that */
  onTaps: (handler: ((perfMs: number) => void) | null) => void;
  onSave: (offsets: { inputOffsetMs?: number; audioOffsetMs?: number }) => void;
  onClose: () => void;
}

const CAL_TRAVEL = 1.2; // s a falling marker is on screen before it lands

export function showCalibration(o: CalibrationOptions): void {
  let inputOffset = o.inputOffsetMs;
  let running = false;
  const el = screen(`<div class="panel calib" style="text-align:center">
    <h2 id="cal-title"></h2>
    <p id="cal-text"></p>
    <div class="cal-stage" id="cal-stage" hidden><div class="cal-line"></div><div class="cal-ball" id="cal-ball"></div></div>
    <div class="cal-dots" id="cal-dots">${'<span class="dot"></span>'.repeat(CALIBRATION_BEATS)}</div>
    <p id="cal-result"></p>
    <div class="row" style="justify-content:center" id="cal-buttons"></div>
  </div>`);
  const $ = <T extends HTMLElement>(id: string) => el.querySelector<T>(`#${id}`)!;
  const dots = [...el.querySelectorAll<HTMLElement>('.dot')];
  const buttons = (list: [string, () => void, boolean?][]): void => {
    $('cal-buttons').replaceChildren(
      ...list.map(([label, fn, primary]) => {
        const b = document.createElement('button');
        b.textContent = label;
        if (primary) b.className = 'primary';
        b.addEventListener('click', fn);
        return b;
      }),
    );
  };
  let tap: ((perfMs: number) => void) | null = null;
  const onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' || e.repeat || !running) return;
    e.preventDefault();
    tap?.(e.timeStamp);
  };
  window.addEventListener('keydown', onKey, true);
  const close = (): void => {
    running = false;
    o.onTaps(null);
    window.removeEventListener('keydown', onKey, true);
    o.onClose();
  };

  const intro = (kind: CalibrationKind): void => {
    running = false;
    o.onTaps(null);
    dots.forEach((d) => (d.className = 'dot'));
    $('cal-stage').hidden = kind !== 'visual';
    $('cal-result').textContent = '';
    $('cal-title').textContent = kind === 'input' ? 'Calibrate: your keyboard' : 'Calibrate: your screen';
    $('cal-text').textContent = kind === 'input'
      ? `You will hear 4 soft clicks, then ${CALIBRATION_BEATS} loud ones. Tap any key on your keyboard (or the space bar) exactly on each loud click. Close your eyes if it helps.`
      : `No sound this time. A marker falls onto the line ${CALIBRATION_BEATS} times, after 4 to get the feel. Tap a key exactly when it lands.`;
    buttons([['Start', () => run(kind), true], ['Cancel', close]]);
  };

  const run = (kind: CalibrationKind): void => {
    const beats = o.start(kind);
    if (!beats) {
      $('cal-result').textContent = 'The sound is not running yet. Press Start again.';
      return;
    }
    $('cal-result').textContent = '';
    const all = [...beats.leadIn, ...beats.scored];
    const cal = new TapCalibrator(beats.scored);
    running = true;
    dots.forEach((d) => (d.className = 'dot'));
    $('cal-text').textContent = kind === 'input' ? 'Listen… then tap on every loud click.' : 'Watch… then tap when the marker lands.';
    buttons([['Cancel', close]]);
    tap = (perfMs) => {
      const i = cal.tap(o.timeOf(perfMs));
      if (i >= 0) dots[i]!.className = 'dot on';
    };
    o.onTaps(tap);
    const ball = $('cal-ball');
    const stage = $('cal-stage');
    const frame = (): void => {
      if (!running || !el.isConnected) return;
      const now = o.now();
      if (kind === 'visual') {
        const next = all.find((b) => b >= now - 0.08);
        const travel = stage.clientHeight - 24;
        if (next === undefined) ball.style.opacity = '0';
        else {
          const t = Math.max(0, Math.min(1, 1 - (next - now) / CAL_TRAVEL));
          ball.style.opacity = next - now > CAL_TRAVEL ? '0' : '1';
          ball.style.transform = `translate(-50%, ${t * travel}px)`;
          ball.classList.toggle('scored', beats.scored.includes(next));
        }
      }
      if (cal.done(now)) finish(kind, cal.result());
      else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  const finish = (kind: CalibrationKind, r: CalibrationResult): void => {
    running = false;
    o.onTaps(null);
    if (!r.ok) {
      $('cal-result').textContent = r.count < 5
        ? `Only ${r.count} of ${CALIBRATION_BEATS} taps landed on a beat. Tap once for every ${kind === 'input' ? 'loud click' : 'landing'}.`
        : `The taps were too uneven to measure (±${r.spreadMs} ms). Try again, as steadily as you can.`;
      buttons([['Try again', () => run(kind), true], ['Cancel', close]]);
      return;
    }
    if (kind === 'input') {
      $('cal-result').textContent = `Input offset: ${r.offsetMs} ms (steady within ±${r.spreadMs} ms). It was ${o.inputOffsetMs} ms.`;
      const save = (): void => {
        inputOffset = r.offsetMs;
        o.onSave({ inputOffsetMs: r.offsetMs });
      };
      buttons([
        ['Save, then check the screen', () => { save(); intro('visual'); }, true],
        ['Save', () => { save(); close(); }],
        ['Try again', () => run(kind)],
        ['Cancel', close],
      ]);
    } else {
      const v = visualOffset(r.offsetMs, inputOffset);
      $('cal-result').textContent = `Visual offset: ${v} ms (tapped ${r.offsetMs} ms after the landing, ${inputOffset} ms of that is the keyboard). It was ${o.audioOffsetMs} ms.`;
      buttons([['Save', () => { o.onSave({ audioOffsetMs: v }); close(); }, true], ['Try again', () => run(kind)], ['Cancel', close]]);
    }
  };

  intro('input');
}
