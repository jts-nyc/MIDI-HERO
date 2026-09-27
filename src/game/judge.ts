import { beatAt, type Chart } from '../midi/chart.ts';
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
   * 'level': the combo multiplier rose to `streak`; 'fail': the performance meter ran out;
   * 'star': star phrase `streak` was played clean and filled the gauge; 'starLost': star
   * phrase `streak` was spoiled; 'starOn' / 'starOff': star power went on / ran out;
   * 'held': note `noteId` was held to its end; 'released': it was let go early, at `time`.
   * For both, `streak` is the hold points the note earned.
   */
  type: 'hit' | 'miss' | 'wrong' | 'milestone' | 'break' | 'level' | 'fail' | 'star' | 'starLost' | 'starOn' | 'starOff' | 'held' | 'released';
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

/** A clean star phrase adds this much to the star gauge. */
export const STAR_GAIN = 0.25;
/** Gauge needed to switch star power on. */
export const STAR_MIN = 0.5;
/** A full gauge lasts this many beats, so the minimum lasts 16. */
export const STAR_FULL_BEATS = 32;
export const STAR_MULTIPLIER = 2;

/** Notes at least this many beats long are sustains: holding them scores. */
export const SUSTAIN_BEATS = 1;
/** Hold points per beat: one for every 1/16 beat held. */
export const HOLD_POINTS_PER_BEAT = 16;
/** Letting go this close to the end (in beats) still counts as holding to the end. */
export const HOLD_GRACE_BEATS = 1 / 8;

/** A sustained note that was hit and is being held, by the key or by the pedal. */
export interface Hold {
  noteId: number;
  /** judge key of the note (pitch, or pitch class in easy mode) */
  key: number;
  /** beat positions of the start and the end of the note */
  from: number;
  end: number;
  /** points paid so far, before multipliers */
  paid: number;
  keyDown: boolean;
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
  /** sustains being held right now */
  readonly holds: Hold[] = [];
  /** points earned by holding, multipliers included; part of `score` */
  holdScore = 0;
  pedalDown = false;
  /** 0..1; filled by clean star phrases, drained while star power is on */
  starGauge = 0;
  starActive = false;
  /** beat position up to which the gauge has been drained */
  private starBeat = 0;
  /** per phrase: notes not judged yet, and whether a miss or a wrong note spoiled it */
  private readonly phraseLeft: number[];
  private readonly phraseSpoiled: boolean[];
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
    this.phraseLeft = chart.phrases.map((p) => p.last - p.first + 1);
    this.phraseSpoiled = chart.phrases.map(() => false);
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

  /** Combo multiplier times the star multiplier: what a hit is worth right now. */
  get scoreMultiplier(): number {
    return comboMultiplier(this.combo) * (this.starActive ? STAR_MULTIPLIER : 1);
  }

  get failed(): boolean {
    return this.meter.failed;
  }

  /** Length of a note in beats. */
  beatsOf(id: number): number {
    const n = this.chart.notes[id]!;
    return beatAt(this.chart.beats, n.time + n.duration) - beatAt(this.chart.beats, n.time);
  }

  isSustain(id: number): boolean {
    return this.beatsOf(id) >= SUSTAIN_BEATS - 1e-6;
  }

  /** Pay a hold for the beats held up to `beat`. */
  private payHold(h: Hold, beat: number): void {
    const held = Math.min(beat, h.end) - h.from;
    const points = Math.max(0, Math.floor(held * HOLD_POINTS_PER_BEAT + 1e-6));
    if (points <= h.paid) return;
    const gain = (points - h.paid) * this.scoreMultiplier;
    h.paid = points;
    this.score += gain;
    this.holdScore += gain;
  }

  private endHold(index: number, t: number): void {
    const h = this.holds[index]!;
    const beat = beatAt(this.chart.beats, t);
    const complete = beat >= h.end - HOLD_GRACE_BEATS;
    this.payHold(h, complete ? h.end : beat);
    this.holds.splice(index, 1);
    this.events.push({ type: complete ? 'held' : 'released', time: t, pitch: this.chart.notes[h.noteId]!.pitch, noteId: h.noteId, judgment: null, delta: 0, streak: h.paid });
  }

  /** A key went up. A hold goes on if the pedal is down. */
  noteOff(pitch: number, t: number): void {
    const key = this.key(pitch);
    for (let i = this.holds.length - 1; i >= 0; i--) {
      const h = this.holds[i]!;
      if (h.key !== key || !h.keyDown) continue;
      h.keyDown = false;
      if (!this.pedalDown) this.endHold(i, t);
    }
  }

  /** The sustain pedal went down or up. Lifting it lets go of every hold whose key is already up. */
  pedal(down: boolean, t: number): void {
    this.pedalDown = down;
    if (down) return;
    for (let i = this.holds.length - 1; i >= 0; i--) if (!this.holds[i]!.keyDown) this.endHold(i, t);
  }

  private advanceHolds(t: number): void {
    if (this.holds.length === 0) return;
    const beat = beatAt(this.chart.beats, t);
    for (let i = this.holds.length - 1; i >= 0; i--) {
      const h = this.holds[i]!;
      if (beat >= h.end) this.endHold(i, t);
      else this.payHold(h, beat);
    }
  }

  /** Enough gauge to switch star power on, and it is not on already. */
  get starReady(): boolean {
    return !this.starActive && this.starGauge >= STAR_MIN - 1e-9;
  }

  /** Switch star power on (sustain pedal or Space). Returns false when the gauge is below half. */
  activateStar(t: number): boolean {
    if (!this.starReady) return false;
    this.starActive = true;
    this.starBeat = beatAt(this.chart.beats, t);
    this.note('starOn', t, 0);
    return true;
  }

  /** While star power is on the gauge runs down with the beats of the song. */
  private drainStar(t: number): void {
    if (!this.starActive) return;
    const beat = beatAt(this.chart.beats, t);
    if (beat <= this.starBeat) return;
    this.starGauge -= (beat - this.starBeat) / STAR_FULL_BEATS;
    this.starBeat = beat;
    if (this.starGauge <= 1e-9) {
      this.starGauge = 0;
      this.starActive = false;
      this.note('starOff', t, 0);
    }
  }

  private spoil(phrase: number, t: number): void {
    if (this.phraseSpoiled[phrase]) return;
    this.phraseSpoiled[phrase] = true;
    if (this.chart.phrases[phrase]!.star) this.note('starLost', t, phrase);
  }

  /** A wrong note spoils the star phrase that is being played at that moment. */
  private spoilAt(t: number): void {
    const phrases = this.chart.phrases;
    for (let p = 0; p < phrases.length; p++) {
      const ph = phrases[p]!;
      if (ph.start - this.miss > t) break;
      if (ph.star && this.phraseLeft[p]! > 0 && t <= ph.end + this.miss) this.spoil(p, t);
    }
  }

  /** Book a judged note on its phrase; a star phrase played clean to its last note fills the gauge. */
  private phraseNote(id: number, clean: boolean, t: number): void {
    const phrase = this.chart.notes[id]!.phrase;
    if (phrase === undefined || this.phraseLeft[phrase] === undefined) return;
    if (!clean) this.spoil(phrase, t);
    if (--this.phraseLeft[phrase]! === 0 && !this.phraseSpoiled[phrase] && this.chart.phrases[phrase]!.star) {
      this.starGauge = Math.min(1, this.starGauge + STAR_GAIN);
      this.note('star', t, phrase);
    }
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
        this.spoilAt(t);
      }
      return { kind: 'wrong' };
    }
    const n = this.chart.notes[id]!;
    const delta = t - n.time;
    const d = Math.abs(delta);
    const judgment: Judgment = d <= this.perfect ? 'perfect' : d <= this.great ? 'great' : d <= this.good ? 'good' : 'late';
    this.events.push({ type: 'hit', time: t, pitch: n.pitch, noteId: id, judgment, delta });
    this.apply(id, judgment, t);
    if (judgment !== 'late' && this.isSustain(id)) {
      const from = beatAt(this.chart.beats, n.time);
      this.holds.push({ noteId: id, key: this.key(n.pitch), from, end: from + this.beatsOf(id), paid: 0, keyDown: true });
    }
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
      this.score += POINTS[judgment] * this.scoreMultiplier;
      this.meter.hit();
      if (comboMultiplier(this.combo) > before) this.note('level', t, comboMultiplier(this.combo));
      if (isMilestone(this.combo)) this.note('milestone', t, this.combo);
    }
    this.counts[judgment]++;
    this.phraseNote(id, judgment !== 'miss' && judgment !== 'late', t);
  }

  /** Mark notes whose window has passed as missed. */
  advance(t: number): void {
    this.advanceHolds(t);
    this.drainStar(t);
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
