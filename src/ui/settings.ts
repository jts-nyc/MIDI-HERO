import type { TimingPreset, WrongNotePenalty } from '../game/judge.ts';
import type { FoldMode } from '../midi/chart.ts';

export type KeyboardSize = 25 | 49 | 61 | 88;

export interface Settings {
  kb: KeyboardSize;
  timing: TimingPreset;
  /** note names on all keys */
  names: boolean;
  /** note names on falling notes */
  noteNames: boolean;
  /** synthesize the player's own notes */
  synth: boolean;
  hitSound: boolean;
  /** scroll speed, px/s */
  speed: number;
  /** playback rate 0.5..1 */
  rate: number;
  audioOffsetMs: number;
  inputOffsetMs: number;
  wrongNotePenalty: WrongNotePenalty;
  easy: boolean;
  backingVolume: number;
  foldMode: FoldMode;
  midiPortId: string | null;
  /** computer-keyboard fallback base pitch */
  keyboardBase: number;
  firstRunDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  kb: 25,
  timing: 'normal',
  names: true,
  noteNames: false,
  synth: true,
  hitSound: false,
  speed: 300,
  rate: 1,
  audioOffsetMs: 0,
  inputOffsetMs: 0,
  wrongNotePenalty: 'combo',
  easy: false,
  backingVolume: 0.8,
  foldMode: 'fold',
  midiPortId: null,
  keyboardBase: 48,
  firstRunDone: false,
};

const KEY = 'midihero.settings.v1';
const CLASS_KEY = 'midihero.classDefaults.v1';

/** Session-only overrides from URL parameters (kb, timing, names, synth, rate, speed, easy, noteNames). */
export function urlOverrides(search: string): Partial<Settings> {
  const p = new URLSearchParams(search);
  const out: Partial<Settings> = {};
  const kb = Number(p.get('kb'));
  if ([25, 49, 61, 88].includes(kb)) out.kb = kb as KeyboardSize;
  const timing = p.get('timing');
  if (timing === 'strict' || timing === 'normal' || timing === 'relaxed') out.timing = timing;
  const bool = (k: keyof Settings & ('names' | 'synth' | 'easy' | 'noteNames' | 'hitSound')) => {
    const v = p.get(k);
    if (v === '1' || v === 'true') out[k] = true;
    else if (v === '0' || v === 'false') out[k] = false;
  };
  bool('names');
  bool('synth');
  bool('easy');
  bool('noteNames');
  bool('hitSound');
  const rate = Number(p.get('rate'));
  if (rate >= 0.25 && rate <= 1.5) out.rate = rate;
  const speed = Number(p.get('speed'));
  if (speed >= 100 && speed <= 800) out.speed = speed;
  return out;
}

/** Validate and clamp a loosely-typed object into Settings. */
export function sanitize(raw: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const s: Settings = { ...base };
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (k: keyof Settings, min: number, max: number) => {
    const v = Number(r[k]);
    if (Number.isFinite(v)) (s as unknown as Record<string, number>)[k] = Math.min(max, Math.max(min, v));
  };
  if ([25, 49, 61, 88].includes(Number(r.kb))) s.kb = Number(r.kb) as KeyboardSize;
  if (r.timing === 'strict' || r.timing === 'normal' || r.timing === 'relaxed') s.timing = r.timing;
  for (const k of ['names', 'noteNames', 'synth', 'hitSound', 'easy', 'firstRunDone'] as const) {
    if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  }
  num('speed', 100, 800);
  num('rate', 0.25, 1.5);
  num('audioOffsetMs', -500, 500);
  num('inputOffsetMs', -500, 500);
  num('backingVolume', 0, 1);
  num('keyboardBase', 0, 96);
  if (r.wrongNotePenalty === 'none' || r.wrongNotePenalty === 'combo' || r.wrongNotePenalty === 'score') s.wrongNotePenalty = r.wrongNotePenalty;
  if (r.foldMode === 'fold' || r.foldMode === 'drop') s.foldMode = r.foldMode;
  if (typeof r.midiPortId === 'string' || r.midiPortId === null) s.midiPortId = r.midiPortId as string | null;
  return s;
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function loadSettings(search = typeof location !== 'undefined' ? location.search : ''): Settings {
  const classDefaults = sanitize(readJson(CLASS_KEY));
  const stored = sanitize(readJson(KEY), classDefaults);
  return { ...stored, ...urlOverrides(search) };
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

/** Class defaults come from a song pack or the URL the teacher bookmarked. */
export function saveClassDefaults(partial: Partial<Settings>): void {
  try {
    const existing = (readJson(CLASS_KEY) as Record<string, unknown>) ?? {};
    localStorage.setItem(CLASS_KEY, JSON.stringify({ ...existing, ...partial }));
  } catch {
    /* storage unavailable */
  }
}

export function classDefaults(): Settings {
  return sanitize(readJson(CLASS_KEY));
}

export function resetToClassDefaults(): Settings {
  const s = { ...classDefaults(), firstRunDone: true };
  saveSettings(s);
  return s;
}
