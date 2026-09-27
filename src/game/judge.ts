import type { Chart } from '../midi/chart.ts';
import { isMilestone, PerformanceMeter } from './meter.ts';

export type Judgment = 'perfect' | 'great' | 'good' | 'late' | 'miss';
export type NoteState = 'pending' | 'hit' | 'missed';
export type WrongNotePenalty = 'none' | 'combo' | 'score';
export type TimingPreset = 'strict' | 'normal' | 'relaxed';

export const TIMING_SCALE: Record<TimingPreset, number> = { strict: 0.7, normal: 1, relaxed: 1.5 };

export interface JudgeConfig {
  /** window half-widths in seconds, before preset scaling */
  perfect: number;
  great: number;
  good: number;
  /** beyond `good` and within `miss` a hit consumes the note as an early/late miss */
  miss: number;
  preset: TimingPreset;
  /** octave-agnostic matching */
  easy: boolean;
  wrongNotePenalty: WrongNotePenalty;
  /** the song fails when the performance meter falls to this value; null or absent = never */
  failAt?: number | null;
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  perfect: 0.035,
  great: 0.07,
  good: 0.12,
  miss: 0.15,
  preset: 'normal',
  easy: false,
  wrongNotePenalty: 'combo',
};

export const POINTS: Record<Judgment, number> = { perfect: 100, great: 70, good: 40, late: 0, miss: 0 };
export const WEIGHTS: Record<Judgment, number> = { perfect: 1, great: 0.7, good: 0.4, late: 0, miss: 0 };

export type HitResult =
  | { kind: 'hit'; noteId: number; judgment: Judgment; delta: number }
  | { kind: 'wrong' };

export interface JudgeEvent {
  /**
   * 'milestone': the streak reached `streak`; 'break': a streak of `streak` notes ended;
   * 'level': the combo multiplier rose to `streak`; 'fail': the performance meter ran out.
   */
  type: 'hit' | 'miss' | 'wrong' | 'milestone' | 'break' | 'level' | 'fail';
  time: number;
  pitch: number;
  noteId: number;
  judgment: Judgment | null;
  delta: number;
  streak?: number;
}

export interface Counts {
  perfect: number;
  great: number;
  good: number;
  late: number;
  miss: number;
  wrong: number;
}

/** Streak lengths at which the multiplier rises to 2x, 3x, 4x. */
export const MULTIPLIER_STEPS = [10, 30, 50] as const;
export const MAX_MULTIPLIER = MULTIPLIER_STEPS.length + 1;

export function comboMultiplier(combo: number): number {
  return combo >= 50 ? 4 : combo >= 30 ? 3 : combo >= 10 ? 2 : 1;
}

/** How far the streak is toward the next multiplier level, 0..1; 1 at the top level. */
export function multiplierProgress(combo: number): number {
  let from = 0;
  for (const step of MULTIPLIER_STEPS) {
    if (combo < step) return (combo - from) / (step - from);
    from = step;
  }
  return 1;
}

/**
 * Pure scoring state machine. Onsets only. Time is song time in seconds.
 * Windows are in wall-clock seconds; callers divide by the playback rate
 * before constructing the judge if they want real-time windows at slow rates
 * (see `Judge.forRate`).
 */
export class Judge {
  readonly states: NoteState[];
  readonly judgments: (Judgment | null)[];
  /** per-note miss boundary (s), clamped to half the gap to the nearest same-pitch neighbour */
  readonly windows: number[];
  readonly counts: Counts = { perfect: 0, great: 0, good: 0, late: 0, miss: 0, wrong: 0 };
  score = 0;
  combo = 0;
  maxCombo = 0;
  judged = 0;
  private weightSum = 0;
  private failNoted = false;
  private cursor = 0;
  private byPitch = new Map<number, number[]>();
  private pitchCursor = new Map<number, number>();
  private readonly perfect: number;
  private readonly great: number;
  private readonly good: number;
  private readonly miss: number;
  readonly events: JudgeEvent[] = [];
  readonly meter: PerformanceMeter;

  constructor(
    readonly chart: Chart,
    readonly config: JudgeConfig = DEFAULT_JUDGE_CONFIG,
    /** playback rate: windows shrink in song time so they stay constant in real time */
    readonly rate = 1,
  ) {
    this.meter = new PerformanceMeter({ failAt: config.failAt ?? null });
    const scale = TIMING_SCALE[config.preset] * rate;
    this.perfect = config.perfect * scale;
    this.great = config.great * scale;
    this.good = config.good * scale;
    this.miss = config.miss * scale;
    const notes = chart.notes;
    this.states = notes.map(() => 'pending');
    this.judgments = notes.map(() => null);
    this.windows = notes.map(() => this.miss);
    const keyOf = (pitch: number) => (config.easy ? ((pitch % 12) + 12) % 12 : pitch);
    notes.forEach((n, i) => {
      const k = keyOf(n.pitch);
      let arr = this.byPitch.get(k);
      if (!arr) this.byPitch.set(k, (arr = []));
      arr.push(i);
    });
    // Clamp each window to half the gap to its same-key neighbours.
    for (const ids of this.byPitch.values()) {
      for (let j = 0; j < ids.length; j++) {
        const id = ids[j]!;
        const t = notes[id]!.time;
        let w = this.miss;
        if (j > 0) w = Math.min(w, (t - notes[ids[j - 1]!]!.time) / 2);
        if (j + 1 < ids.length) w = Math.min(w, (notes[ids[j + 1]!]!.time - t) / 2);
        this.windows[id] = Math.max(0.005, w);
      }
      this.pitchCursor.set(keyOf(notes[ids[0]!]!.pitch), 0);
    }
  }

  get accuracy(): number {
    return this.judged === 0 ? 1 : this.weightSum / this.judged;
  }

  get total(): number {
    return this.chart.notes.length;
  }

  get finished(): boolean {
    return this.judged >= this.total;
  }

  get multiplier(): number {
    return comboMultiplier(this.combo);
  }

  /** 0..1 toward the next multiplier level. */
  get multiplierProgress(): number {
    return multiplierProgress(this.combo);
  }

  get failed(): boolean {
    return this.meter.failed;
  }

  private note(type: JudgeEvent['type'], time: number, streak: number): void {
    this.events.push({ type, time, pitch: -1, noteId: -1, judgment: null, delta: 0, streak });
  }

  /** End the streak, if there is one. */
  private breakStreak(time: number): void {
    if (this.combo > 0) this.note('break', time, this.combo);
    this.combo = 0;
  }

  private checkFail(time: number): void {
    if (this.meter.failed && !this.failNoted) {
      this.failNoted = true;
      this.note('fail', time, 0);
    }
  }

  private key(pitch: number): number {
    return this.config.easy ? ((pitch % 12) + 12) % 12 : pitch;
  }

  /** Nearest pending note for this pitch within its window at time t, or -1. */
  private findCandidate(pitch: number, t: number): number {
    const ids = this.byPitch.get(this.key(pitch));
    if (!ids) return -1;
    let cur = this.pitchCursor.get(this.key(pitch)) ?? 0;
    while (cur < ids.length && this.states[ids[cur]!] !== 'pending') cur++;
    this.pitchCursor.set(this.key(pitch), cur);
    let best = -1;
    let bestAbs = Infinity;
    for (let j = cur; j < ids.length; j++) {
      const id = ids[j]!;
      const n = this.chart.notes[id]!;
      if (n.time - t > this.miss) break;
      if (this.states[id] !== 'pending') continue;
      const d = Math.abs(t - n.time);
      if (d <= this.windows[id]! && d < bestAbs) {
        best = id;
        bestAbs = d;
      }
    }
    return best;
  }

  /** Whether a note-on at (pitch, t) would match something; used by the octave tracker. */
  pendingNear(pitch: number, t: number): boolean {
    return this.findCandidate(pitch, t) >= 0;
  }

  noteOn(pitch: number, t: number): HitResult {
    const id = this.findCandidate(pitch, t);
    if (id < 0) {
      this.counts.wrong++;
      if (this.config.wrongNotePenalty === 'score') this.score = Math.max(0, this.score - 20);
      this.events.push({ type: 'wrong', time: t, pitch, noteId: -1, judgment: null, delta: 0 });
      if (this.config.wrongNotePenalty !== 'none') {
        this.breakStreak(t);
        this.meter.wrong();
        this.checkFail(t);
      }
      return { kind: 'wrong' };
    }
    const n = this.chart.notes[id]!;
    const delta = t - n.time;
    const d = Math.abs(delta);
    const judgment: Judgment = d <= this.perfect ? 'perfect' : d <= this.great ? 'great' : d <= this.good ? 'good' : 'late';
    this.events.push({ type: 'hit', time: t, pitch: n.pitch, noteId: id, judgment, delta });
    this.apply(id, judgment, t);
    return { kind: 'hit', noteId: id, judgment, delta };
  }

  private apply(id: number, judgment: Judgment, t: number): void {
    this.states[id] = judgment === 'miss' ? 'missed' : 'hit';
    this.judgments[id] = judgment;
    this.judged++;
    this.weightSum += WEIGHTS[judgment];
    if (judgment === 'miss' || judgment === 'late') {
      this.breakStreak(t);
      if (judgment === 'miss') this.meter.miss();
      else this.meter.late();
      this.checkFail(t);
    } else {
      const before = comboMultiplier(this.combo);
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      this.score += POINTS[judgment] * comboMultiplier(this.combo);
      this.meter.hit();
      if (comboMultiplier(this.combo) > before) this.note('level', t, comboMultiplier(this.combo));
      if (isMilestone(this.combo)) this.note('milestone', t, this.combo);
    }
    this.counts[judgment]++;
  }

  /** Mark notes whose window has passed as missed. */
  advance(t: number): void {
    const notes = this.chart.notes;
    while (this.cursor < notes.length) {
      const id = this.cursor;
      const n = notes[id]!;
      if (n.time + this.windows[id]! >= t) break;
      if (this.states[id] === 'pending') {
        this.events.push({ type: 'miss', time: t, pitch: n.pitch, noteId: id, judgment: 'miss', delta: 0 });
        this.apply(id, 'miss', t);
      }
      this.cursor++;
    }
  }

  /** Force everything still pending to missed (song ended). */
  finish(): void {
    this.advance(Number.POSITIVE_INFINITY);
  }

  /** Drain queued events. */
  takeEvents(): JudgeEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
