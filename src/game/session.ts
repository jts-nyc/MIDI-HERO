import type { GameClock } from '../audio/clock.ts';
import type { Synth } from '../audio/synth.ts';
import { ChannelFilter, OctaveTracker, type InputEvent, type OctaveEvent } from '../input/normalize.ts';
import type { Chart } from '../midi/chart.ts';
import { noteName } from '../render/layout.ts';
import type { Hud, KeyVisual, NoteVisual, Popup } from '../render/renderer.ts';
import { theme } from '../render/renderer.ts';
import { Judge, type Counts, type JudgeConfig, type Judgment } from './judge.ts';

export type SessionStatus = 'playing' | 'paused' | 'finished';

export interface AutoplayOptions {
  /** random timing error, ms (uniform ±) */
  jitterMs: number;
}

export interface SessionOptions {
  chart: Chart;
  clock: GameClock;
  judgeConfig: JudgeConfig;
  /** playback rate */
  rate: number;
  /** real-time input offset, ms; subtracted from every input */
  inputOffsetMs: number;
  /** player-note synth, or null when the instrument makes its own sound */
  synth: Synth | null;
  /** relative judging: hardware octave shift is unknown and may change */
  relative: boolean;
  /** seconds of highway visible above the hit line, for the lead-in */
  visibleSeconds: number;
  /** one bar, in seconds, at the song start */
  barSeconds: number;
  autoplay: AutoplayOptions | null;
  hint: string;
}

export interface PlayResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Counts;
  total: number;
  judged: number;
}

const JUDGMENT_LABEL: Record<Judgment, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', late: 'Late', miss: 'Miss' };
const JUDGMENT_COLOR: Record<Judgment, string> = {
  perfect: theme.perfect, great: theme.great, good: theme.good, late: theme.wrong, miss: theme.noteMissed,
};
const KEY_FLASH = 0.25; // s, for wrong/missed key flashes

/** One play-through of a chart: input → judge → visuals, plus autoplay and the player-note synth. */
export class PlaySession {
  readonly judge: Judge;
  readonly noteVisuals: NoteVisual[];
  readonly keyVisuals = new Map<number, KeyVisual>();
  readonly popups: Popup[] = [];
  readonly filter = new ChannelFilter();
  readonly tracker = new OctaveTracker(3);
  /** semitones added to a played pitch to get the chart pitch (relative judging) */
  octaveOffset = 0;
  status: SessionStatus = 'playing';
  readonly leadIn: number;
  onOctave: (ev: OctaveEvent) => void = () => {};
  onFinished: (result: PlayResult) => void = () => {};
  private autoCursor = 0;
  private autoOffs: { time: number; pitch: number }[] = [];
  private autoJitter: number[] = [];
  private heldKeys = new Set<number>();
  private lastNow = -Infinity;

  constructor(readonly opts: SessionOptions) {
    this.judge = new Judge(opts.chart, opts.judgeConfig, opts.rate);
    this.noteVisuals = opts.chart.notes.map(() => ({ state: 'pending', hitTime: 0, judgment: '' }));
    this.leadIn = opts.visibleSeconds * opts.rate + opts.barSeconds;
    if (opts.autoplay) {
      const j = opts.autoplay.jitterMs / 1000;
      this.autoJitter = opts.chart.notes.map(() => (Math.random() * 2 - 1) * j);
    }
    opts.clock.setRate(opts.rate);
    opts.clock.start(-this.leadIn);
  }

  get chart(): Chart {
    return this.opts.chart;
  }

  now(): number {
    return this.opts.clock.now();
  }

  /** Song time an input event happened at, after the input offset. */
  songTimeOf(ev: InputEvent): number {
    return this.opts.clock.audibleSongTime(ev.perfMs) - (this.opts.inputOffsetMs / 1000) * this.opts.rate;
  }

  handleInput(ev: InputEvent): void {
    if (this.status !== 'playing') return;
    const passed = this.filter.filter(ev);
    if (!passed) return;
    if (ev.type === 'pedal') {
      this.opts.synth?.control(0, 64, ev.velocity, 0);
      return;
    }
    const pitch = ev.pitch + (this.opts.relative ? this.octaveOffset : 0);
    if (ev.type === 'off') {
      this.heldKeys.delete(pitch);
      this.keyVisuals.delete(pitch);
      this.opts.synth?.noteOff(0, pitch, 0);
      return;
    }
    // Sound first: synchronous, at the audio clock's current time.
    this.opts.synth?.noteOn(0, pitch, ev.velocity, 0);
    this.heldKeys.add(pitch);
    const t = this.songTimeOf(ev);
    this.judge.advance(t);
    const result = this.judge.noteOn(pitch, t);
    if (result.kind === 'hit') {
      if (ev.source === 'midi' && this.filter.locked === null) this.filter.lock(ev.channel);
      this.noteVisuals[result.noteId] = { state: 'hit', hitTime: this.now(), judgment: result.judgment };
      this.keyVisuals.set(pitch, { kind: result.judgment, since: t });
      this.popups.push({ text: JUDGMENT_LABEL[result.judgment], pitch, time: this.now(), color: JUDGMENT_COLOR[result.judgment] });
      if (ev.source !== 'autoplay') this.tracker.observe(true, 0);
    } else {
      this.keyVisuals.set(pitch, { kind: 'wrong', since: t });
      if (ev.source !== 'autoplay' && this.opts.relative) {
        const delta = this.pendingOctaveDelta(pitch, t);
        const oev = this.tracker.observe(false, delta);
        if (oev) {
          if (oev.type === 'reoffset') this.octaveOffset += oev.delta;
          this.onOctave(oev);
        }
      }
    }
    this.trimPopups();
  }

  /** If a pending note of the same pitch class is due now, its pitch minus the played pitch; else 0. */
  private pendingOctaveDelta(pitch: number, t: number): number {
    const notes = this.chart.notes;
    let best = 0;
    let bestAbs = Infinity;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i]!;
      if (n.time < t - 0.3) continue;
      if (n.time > t + 0.3) break;
      if (this.judge.states[i] !== 'pending') continue;
      if (((n.pitch - pitch) % 12 + 12) % 12 !== 0 || n.pitch === pitch) continue;
      const d = Math.abs(n.time - t);
      if (d < bestAbs) {
        bestAbs = d;
        best = n.pitch - pitch;
      }
    }
    return best;
  }

  private trimPopups(): void {
    const now = this.now();
    while (this.popups.length > 24 || (this.popups.length && now - this.popups[0]!.time > 1)) this.popups.shift();
  }

  /** Per-frame update: misses, autoplay, visual expiry, finish detection. */
  update(): void {
    if (this.status !== 'playing') return;
    const now = this.now();
    if (now < this.lastNow) {
      // seek backwards: not supported mid-session
    }
    this.lastNow = now;
    if (this.opts.autoplay) this.runAutoplay(now);
    this.judge.advance(now);
    for (const e of this.judge.takeEvents()) {
      if (e.type === 'miss') {
        this.noteVisuals[e.noteId] = { state: 'missed', hitTime: now, judgment: 'miss' };
        this.popups.push({ text: 'Miss', pitch: e.pitch, time: now, color: JUDGMENT_COLOR.miss });
      }
    }
    for (const [pitch, kv] of this.keyVisuals) {
      if (!this.heldKeys.has(pitch) && now - kv.since > KEY_FLASH) this.keyVisuals.delete(pitch);
    }
    this.trimPopups();
    if (this.judge.finished || now > this.chart.duration) {
      this.judge.finish();
      this.status = 'finished';
      this.opts.synth?.allNotesOff(0);
      this.onFinished(this.result());
    }
  }

  private runAutoplay(now: number): void {
    const notes = this.chart.notes;
    const perfNow = this.opts.clock.perfNowMs();
    const perfFor = (songTime: number) => perfNow - ((now - songTime) * 1000) / this.opts.rate;
    while (this.autoCursor < notes.length) {
      const n = notes[this.autoCursor]!;
      const at = n.time + (this.autoJitter[this.autoCursor] ?? 0);
      if (at > now) break;
      const played = n.pitch - (this.opts.relative ? this.octaveOffset : 0);
      this.handleInput({ type: 'on', pitch: played, velocity: n.velocity, channel: 0, perfMs: perfFor(at) + (this.opts.inputOffsetMs || 0), source: 'autoplay' });
      this.autoOffs.push({ time: at + Math.max(0.05, n.duration), pitch: played });
      this.autoCursor++;
    }
    this.autoOffs.sort((a, b) => a.time - b.time);
    while (this.autoOffs.length && this.autoOffs[0]!.time <= now) {
      const o = this.autoOffs.shift()!;
      this.handleInput({ type: 'off', pitch: o.pitch, velocity: 0, channel: 0, perfMs: perfFor(o.time), source: 'autoplay' });
    }
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.opts.clock.pause();
    this.status = 'paused';
    this.opts.synth?.allNotesOff(0);
  }

  resume(): void {
    if (this.status !== 'paused') return;
    this.opts.clock.resume();
    this.status = 'playing';
  }

  /** Jump so the first note arrives after a normal lead-in. */
  skipToFirstNote(): void {
    const target = this.chart.firstNoteTime - this.leadIn;
    if (target > this.now()) this.opts.clock.seek(target);
  }

  hud(): Hud {
    const j = this.judge;
    return {
      score: j.score,
      combo: j.combo,
      accuracy: j.accuracy,
      progress: Math.max(0, this.now() / this.chart.duration),
      hint: this.opts.hint,
    };
  }

  result(): PlayResult {
    const j = this.judge;
    return { score: j.score, accuracy: j.accuracy, maxCombo: j.maxCombo, counts: { ...j.counts }, total: j.total, judged: j.judged };
  }

  static keysHint(window: { low: number; high: number } | null): string {
    return window ? `Your keys: ${noteName(window.low)}–${noteName(window.high)}` : '';
  }
}
