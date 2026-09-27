import type { TimingPreset, WrongNotePenalty } from '../game/judge.ts';
import type { FeedbackSound, TierText } from '../game/session.ts';
import type { FoldMode } from '../midi/chart.ts';

export type KeyboardSize = 25 | 49 | 61 | 88;

export interface Settings {
  kb: KeyboardSize;
  highway: 'flat' | 'perspective';
  timing: TimingPreset;
  /** note names on all keys */
  names: boolean;
  /** note names on falling notes */
  noteNames: boolean;
  /** the computer makes the sound of the player's notes; false when the instrument has speakers */
  synth: boolean;
  /** what a press sounds like when `synth` is on */
  feedbackSound: FeedbackSound;
  hitSound: boolean;
  /** scroll speed, px/s */
  speed: number;
  /** playback rate 0.5..1 */
  rate: number;
  audioOffsetMs: number;
  inputOffsetMs: number;
  wrongNotePenalty: WrongNotePenalty;
  easy: boolean;
  /** arcade mode: the song ends when the performance meter runs out */
  arcade: boolean;
  /** particles and other moving effects */
  effects: boolean;
  /** timing words over hits: every tier, Perfect only (default), or none */
  tierText: TierText;
  /** from Medium up: a bonk when a key stays down after its note is over */
  letGo: boolean;
  backingVolume: number;
  /** practice mode: hold the song at an unplayed note until it is played */
  practiceWait: boolean;
  /** practice mode: step the speed up after two clean passes, down after two failed ones */
  practiceLadder: boolean;
  foldMode: FoldMode;
  midiPortId: string | null;
  /** computer-keyboard fallback base pitch */
  keyboardBase: number;
  firstRunDone: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  kb: 25,
  highway: 'flat',
  timing: 'normal',
  names: true,
  noteNames: false,
  synth: true,
  feedbackSound: 'chart',
  hitSound: false,
  speed: 300,
  rate: 1,
  audioOffsetMs: 0,
  inputOffsetMs: 0,
  wrongNotePenalty: 'combo',
  easy: false,
  arcade: false,
  effects: true,
  tierText: 'perfect',
  letGo: true,
  backingVolume: 0.8,
  practiceWait: false,
  practiceLadder: true,
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
  const bool = (k: keyof Settings & ('names' | 'synth' | 'easy' | 'noteNames' | 'hitSound' | 'arcade' | 'effects' | 'letGo')) => {
    const v = p.get(k);
    if (v === '1' || v === 'true') out[k] = true;
    else if (v === '0' || v === 'false') out[k] = false;
  };
  bool('names');
  bool('synth');
  bool('easy');
  bool('noteNames');
  bool('hitSound');
  bool('arcade');
  bool('effects');
  bool('letGo');
  const feedback = p.get('feedback');
  if (isFeedbackSound(feedback)) {
    out.feedbackSound = feedback;
    out.synth = feedback !== 'off';
  }
  const tiers = p.get('tiers');
  if (isTierText(tiers)) out.tierText = tiers;
  const rate = Number(p.get('rate'));
  if (rate >= 0.25 && rate <= 1.5) out.rate = rate;
  const speed = Number(p.get('speed'));
  if (speed >= 100 && speed <= 800) out.speed = speed;
  return out;
}

const isFeedbackSound = (v: unknown): v is FeedbackSound => v === 'chart' || v === 'press' || v === 'off';
const isTierText = (v: unknown): v is TierText => v === 'all' || v === 'perfect' || v === 'off';

/** The feedback mode in effect: `synth` off always means the instrument sounds itself. */
export function effectiveFeedback(s: Pick<Settings, 'synth' | 'feedbackSound'>): FeedbackSound {
  if (!s.synth) return 'off';
  return s.feedbackSound === 'off' ? 'chart' : s.feedbackSound;
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
  if (r.highway === 'flat' || r.highway === 'perspective') s.highway = r.highway;
  if (r.timing === 'strict' || r.timing === 'normal' || r.timing === 'relaxed') s.timing = r.timing;
  for (const k of ['names', 'noteNames', 'synth', 'hitSound', 'easy', 'arcade', 'effects', 'letGo', 'firstRunDone', 'practiceWait', 'practiceLadder'] as const) {
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
  if (isFeedbackSound(r.feedbackSound)) s.feedbackSound = r.feedbackSound;
  if (isTierText(r.tierText)) s.tierText = r.tierText;
  // `synth` on with feedback 'off' cannot be expressed in the UI; an old or pack value of `synth` wins.
  if (s.synth && s.feedbackSound === 'off') s.feedbackSound = 'chart';
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
