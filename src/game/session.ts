import type { GameClock } from '../audio/clock.ts';
import { FEEDBACK_CHANNEL, FEEDBACK_CHANNELS, type Synth } from '../audio/synth.ts';
import { ChannelFilter, OctaveTracker, type InputEvent, type OctaveEvent } from '../input/normalize.ts';
import type { CarriedNote, Chart } from '../midi/chart.ts';
import {
  createFx, emitBreak, emitCallout, emitHit, emitLevel, emitMilestone, emitMiss, emitSpark, emitStar, emitStreak, emitWrong, setCountdown, stepFx,
  type FxState,
} from '../render/fx.ts';
import { noteName } from '../render/layout.ts';
import type { Hud, KeyVisual, NoteVisual, Popup } from '../render/renderer.ts';
import { theme } from '../render/renderer.ts';
import { Judge, type Counts, type JudgeConfig, type Judgment } from './judge.ts';
import { buildSections, sectionResults, type SectionResult } from './results.ts';

export type SessionStatus = 'playing' | 'paused' | 'finished';

/**
 * What a key press sounds like.
 * 'chart': a hit sounds the chart note (original pitch, velocity and instrument), a wrong key clunks, a miss is silent.
 * 'press': every press sounds the pressed key (free play; v0.1 behaviour).
 * 'off': the instrument makes its own sound.
 */
export type FeedbackSound = 'chart' | 'press' | 'off';

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
  /** default 'press' */
  feedbackSound?: FeedbackSound;
  /** GM program per selected part key, for chart-note feedback */
  feedbackPrograms?: Record<string, number>;
  /** relative judging: hardware octave shift is unknown and may change */
  relative: boolean;
  /** seconds of highway visible above the hit line, for the lead-in */
  visibleSeconds: number;
  /** one bar, in seconds, at the song start */
  barSeconds: number;
  autoplay: AutoplayOptions | null;
  hint: string;
  /** bar-line times in seconds, for the per-section accuracy of the result */
  barTimes?: readonly number[];
  /** clicks of the count-in, for the countdown on screen; default 4 */
  countInBeats?: number;
  /** particles and other moving effects; default on. Meters and counters always show. */
  effects?: boolean;
}

export interface PlayResult {
  score: number;
  accuracy: number;
  maxCombo: number;
  counts: Counts;
  total: number;
  judged: number;
  /** the performance meter ran out (arcade mode) */
  failed: boolean;
  /** how far into the song the play got, 0..1 */
  progress: number;
  /** accuracy per 8-bar section, in song order */
  sections: SectionResult[];
}

const JUDGMENT_LABEL: Record<Judgment, string> = { perfect: 'Perfect', great: 'Great', good: 'Good', late: 'Late', miss: 'Miss' };
const JUDGMENT_COLOR: Record<Judgment, string> = {
  perfect: theme.perfect, great: theme.great, good: theme.good, late: theme.wrong, miss: theme.noteMissed,
};
const KEY_FLASH = 0.25; // s, for wrong/missed key flashes
const SOUND_LOOKAHEAD = 0.05; // s, real time: note-offs are scheduled this far ahead of their song time
const MIN_SOUND = 0.08; // s, a hit at the very end of a note is still heard
const SPARK_EVERY = 0.07; // s, real time between the sparks of a held note
const MAX_FRAME = 0.1; // s, longest step the effects take in one frame
const OUTRO = 0.6; // s, real time between the last judged note and the results, so it can ring out

/** A chart note sounding on a feedback channel until `end`. */
interface Sounding {
  channel: number;
  pitch: number;
  end: number;
}

/** One play-through of a chart: input → judge → visuals, plus autoplay and the player-note synth. */
export class PlaySession {
  readonly judge: Judge;
  readonly noteVisuals: NoteVisual[];
  readonly keyVisuals = new Map<number, KeyVisual>();
  readonly popups: Popup[] = [];
  /** effects and meters for the renderer */
  readonly fx: FxState = createFx();
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
  private readonly feedback: FeedbackSound;
  private readonly feedbackChannels = new Map<string, number>();
  private readonly sounding: Sounding[] = [];
  /** notes earned by the last hit that are still to come, in time order */
  private readonly earned: CarriedNote[] = [];
  /** song time at which a fully judged song ends */
  private endAt = Infinity;
  private nextSpark = 0;

  constructor(readonly opts: SessionOptions) {
    this.judge = new Judge(opts.chart, opts.judgeConfig, opts.rate);
    this.fx.enabled = opts.effects ?? true;
    this.fx.meters.canFail = (opts.judgeConfig.failAt ?? null) !== null;
    this.syncMeters();
    this.feedback = opts.synth ? opts.feedbackSound ?? 'press' : 'off';
    if (this.feedback === 'chart') {
      for (const n of opts.chart.notes) {
        if (this.feedbackChannels.has(n.partKey)) continue;
        const channel = FEEDBACK_CHANNEL + Math.min(this.feedbackChannels.size, FEEDBACK_CHANNELS - 1);
        this.feedbackChannels.set(n.partKey, channel);
        opts.synth!.program(channel, opts.feedbackPrograms?.[n.partKey] ?? 0);
      }
    }
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

  /** 0..1: how much of the band's drums and pads the player has earned; falls when health is low. */
  get mixLevel(): number {
    return this.judge.meter.mixLevel;
  }

  /** Song time an input event happened at, after the input offset. */
  songTimeOf(ev: InputEvent): number {
    return this.opts.clock.audibleSongTime(ev.perfMs) - (this.opts.inputOffsetMs / 1000) * this.opts.rate;
  }

  handleInput(ev: InputEvent): void {
    if (this.status !== 'playing') return;
    const passed = this.filter.filter(ev);
    if (!passed) return;
    const press = this.feedback === 'press' ? this.opts.synth : null;
    const chartSound = this.feedback === 'chart' ? this.opts.synth : null;
    if (ev.type === 'pedal') {
      press?.control(0, 64, ev.velocity, 0);
      // The pedal holds sustained notes, as on a piano, and switches star power on.
      this.judge.pedal(ev.velocity >= 64, this.songTimeOf(ev));
      if (this.judge.events.length) this.drainEvents(this.now());
      if (ev.velocity >= 64) this.activateStar();
      return;
    }
    const pitch = ev.pitch + (this.opts.relative ? this.octaveOffset : 0);
    if (ev.type === 'off') {
      this.heldKeys.delete(pitch);
      // The key highlight stays for KEY_FLASH after release so a quick tap is still visible.
      const kv = this.keyVisuals.get(pitch);
      if (kv) kv.since = Math.max(kv.since, this.now() - KEY_FLASH * 0.6);
      press?.noteOff(0, pitch, 0);
      this.judge.noteOff(pitch, this.songTimeOf(ev));
      if (this.judge.events.length) this.drainEvents(this.now()); // a released hold loses its trail at once
      return;
    }
    // Sound first: synchronous, at the audio clock's current time.
    press?.noteOn(0, pitch, ev.velocity, 0);
    this.heldKeys.add(pitch);
    const t = this.songTimeOf(ev);
    this.judge.advance(t);
    const result = this.judge.noteOn(pitch, t);
    // Chart feedback depends on the verdict, so it sounds right after it, still inside this handler.
    if (chartSound) {
      if (result.kind === 'hit') this.soundChartNote(chartSound, result.noteId, t);
      else {
        chartSound.clunk(ev.velocity, 0);
        this.earned.length = 0; // a wrong key takes the rest of the phrase out of the mix
      }
    }
    if (result.kind === 'hit') {
      if (ev.source === 'midi' && this.filter.locked === null) this.filter.lock(ev.channel);
      const n = this.chart.notes[result.noteId]!;
      const holding = this.judge.holds.some((h) => h.noteId === result.noteId);
      this.noteVisuals[result.noteId] = holding
        ? { state: 'hit', hitTime: this.now(), judgment: result.judgment, hold: 'holding', holdEnd: n.time + n.duration }
        : { state: 'hit', hitTime: this.now(), judgment: result.judgment };
      this.keyVisuals.set(pitch, { kind: result.judgment, since: t });
      this.popups.push({ text: JUDGMENT_LABEL[result.judgment], pitch, time: this.now(), color: JUDGMENT_COLOR[result.judgment] });
      emitHit(this.fx, pitch, result.judgment === 'miss' ? 'late' : result.judgment, this.fx.meters.starActive);
      if (this.judge.combo > 0) emitStreak(this.fx, this.judge.combo);
      if (ev.source !== 'autoplay') this.tracker.observe(true, 0);
    } else {
      this.keyVisuals.set(pitch, { kind: 'wrong', since: t });
      emitWrong(this.fx, pitch);
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

  /** Switch star power on, if the gauge allows: the sustain pedal, or Space. */
  activateStar(): boolean {
    if (this.status !== 'playing') return false;
    return this.judge.activateStar(this.now());
  }

  /** The hit note as written in the file: original pitch, velocity and instrument, for its written length. */
  private soundChartNote(synth: Synth, noteId: number, t: number): void {
    const n = this.chart.notes[noteId]!;
    const channel = this.feedbackChannels.get(n.partKey) ?? FEEDBACK_CHANNEL;
    synth.noteOn(channel, n.origPitch, n.velocity, 0);
    this.sounding.push({ channel, pitch: n.origPitch, end: Math.max(n.time + n.duration, t + MIN_SOUND * this.opts.rate) });
    this.earned.length = 0;
    if (n.carry) {
      for (const c of n.carry) this.earned.push(c);
      this.playEarned(this.now());
    }
  }

  /** Sound the earned notes that fall due, each at its own time on the audio clock. */
  private playEarned(now: number): void {
    const synth = this.opts.synth;
    if (!synth || this.earned.length === 0) return;
    const horizon = now + SOUND_LOOKAHEAD * this.opts.rate;
    let due = 0;
    while (due < this.earned.length && this.earned[due]!.time <= horizon) {
      const c = this.earned[due++]!;
      if (c.time + c.duration <= now) continue; // already over
      const channel = this.feedbackChannels.get(c.partKey) ?? FEEDBACK_CHANNEL;
      synth.noteOn(channel, c.pitch, c.velocity, c.time <= now ? 0 : this.opts.clock.songTimeToContextTime(c.time));
      this.sounding.push({ channel, pitch: c.pitch, end: c.time + c.duration });
    }
    if (due) this.earned.splice(0, due);
  }

  /** Schedule the note-offs that fall due, at their exact time on the audio clock. */
  private releaseSounding(now: number): void {
    const synth = this.opts.synth;
    if (!synth || this.sounding.length === 0) return;
    const horizon = now + SOUND_LOOKAHEAD * this.opts.rate;
    let kept = 0;
    for (let i = 0; i < this.sounding.length; i++) {
      const s = this.sounding[i]!;
      if (s.end <= horizon) synth.noteOff(s.channel, s.pitch, this.opts.clock.songTimeToContextTime(s.end));
      else this.sounding[kept++] = s;
    }
    this.sounding.length = kept;
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

  /** Turn what the judge reported since the last frame into visuals. */
  private drainEvents(now: number): void {
    const events = this.judge.events;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      switch (e.type) {
        case 'miss':
          this.noteVisuals[e.noteId] = { state: 'missed', hitTime: now, judgment: 'miss' };
          this.popups.push({ text: 'Miss', pitch: e.pitch, time: now, color: JUDGMENT_COLOR.miss });
          emitMiss(this.fx, e.pitch);
          break;
        case 'break': emitBreak(this.fx, e.streak ?? 0); break;
        case 'milestone': emitMilestone(this.fx, e.streak ?? 0); break;
        case 'level': emitLevel(this.fx, e.streak ?? 1); break;
        case 'fail': emitCallout(this.fx, 'SONG FAILED', 'fail', 2); break;
        case 'star': emitCallout(this.fx, this.judge.starReady ? 'STAR POWER READY' : 'STAR PHRASE!', 'star', 1); break;
        case 'starOn': emitStar(this.fx); break;
        case 'starLost': this.dimPhrase(e.streak ?? -1); break;
        case 'held': this.endHold(e.noteId, 'held', Math.min(now, e.time)); break;
        case 'released': this.endHold(e.noteId, 'released', e.time); break;
        case 'overheld': this.heldTooLong(e.noteId, now); break;
        default: break;
      }
    }
    events.length = 0;
  }

  /**
   * A hold is over. Let go early, the trail is cut and the rest of the hold points are
   * gone; the note itself keeps sounding for its written length.
   */
  private endHold(noteId: number, how: 'held' | 'released', at: number): void {
    const vis = this.noteVisuals[noteId];
    if (vis) {
      vis.hold = how;
      vis.holdEnd = at;
    }
    if (how === 'held') emitHit(this.fx, this.chart.notes[noteId]!.pitch, 'good', this.fx.meters.starActive);
  }

  /** The key of a note is still down well after the note ended: a sour bonk, a red key, "Let go". */
  private heldTooLong(noteId: number, now: number): void {
    const n = this.chart.notes[noteId]!;
    if (this.feedback !== 'off') this.opts.synth?.bonk(n.origPitch, n.velocity, 0);
    if (this.heldKeys.has(n.pitch)) this.keyVisuals.set(n.pitch, { kind: 'wrong', since: now });
    this.popups.push({ text: 'Let go', pitch: n.pitch, time: now, color: theme.wrong });
    emitWrong(this.fx, n.pitch);
  }

  /** Sparks rise from the keys of the notes that are being held. */
  private sparkHolds(): void {
    const holds = this.judge.holds;
    if (holds.length === 0 || this.fx.clock < this.nextSpark) return;
    this.nextSpark = this.fx.clock + SPARK_EVERY;
    for (let i = 0; i < holds.length; i++) emitSpark(this.fx, this.chart.notes[holds[i]!.noteId]!.pitch, this.fx.meters.starActive);
  }

  /** A spoiled star phrase loses its gold: what is left of it looks like any other note. */
  private dimPhrase(phrase: number): void {
    const p = this.chart.phrases[phrase];
    if (!p) return;
    for (let i = p.first; i <= p.last; i++) {
      const n = this.chart.notes[i]!;
      if (n.star) n.star = false;
    }
  }

  private syncMeters(): void {
    const j = this.judge;
    const m = this.fx.meters;
    m.multiplier = j.multiplier;
    m.multiplierProgress = j.multiplierProgress;
    m.health = j.meter.health;
    m.zone = j.meter.zone;
    m.low = j.meter.low;
    m.starGauge = j.starGauge;
    m.starReady = j.starReady;
    m.starActive = j.starActive;
  }

  private trimPopups(): void {
    const now = this.now();
    while (this.popups.length > 24 || (this.popups.length && now - this.popups[0]!.time > 1)) this.popups.shift();
  }

  /** Per-frame update: misses, autoplay, visual expiry, finish detection. */
  update(): void {
    if (this.status !== 'playing') return;
    const now = this.now();
    const dt = Math.min(MAX_FRAME, Math.max(0, (now - this.lastNow) / this.opts.rate));
    this.lastNow = now;
    if (this.opts.autoplay) this.runAutoplay(now);
    this.judge.advance(now);
    this.playEarned(now);
    this.releaseSounding(now);
    this.drainEvents(now);
    this.sparkHolds();
    this.syncMeters();
    setCountdown(this.fx, now, this.opts.countInBeats ?? 4, this.opts.barSeconds / (this.opts.countInBeats ?? 4));
    stepFx(this.fx, dt);
    for (const [pitch, kv] of this.keyVisuals) {
      if (!this.heldKeys.has(pitch) && now - kv.since > KEY_FLASH) this.keyVisuals.delete(pitch);
    }
    this.trimPopups();
    if (this.judge.finished && this.endAt === Infinity) {
      let end = now;
      for (const s of this.sounding) end = Math.max(end, s.end);
      for (const c of this.earned) end = Math.max(end, c.time + c.duration);
      for (const h of this.judge.holds) {
        const n = this.chart.notes[h.noteId]!;
        end = Math.max(end, n.time + n.duration);
      }
      this.endAt = end + OUTRO * this.opts.rate;
    }
    if (this.judge.failed) {
      this.finish();
      return;
    }
    if (now >= this.endAt || now > this.chart.duration) {
      this.judge.finish();
      this.finish();
    }
  }

  private finish(): void {
    this.status = 'finished';
    this.sounding.length = 0;
    this.earned.length = 0;
    this.opts.synth?.allNotesOff(0);
    this.onFinished(this.result());
  }

  private runAutoplay(now: number): void {
    const notes = this.chart.notes;
    const perfNow = this.opts.clock.perfNowMs();
    const perfFor = (songTime: number) => perfNow - ((now - songTime) * 1000) / this.opts.rate;
    if (this.judge.starReady) this.activateStar();
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
    this.judge.releaseAll(this.now());
    this.drainEvents(this.now());
    this.heldKeys.clear();
    this.opts.clock.pause();
    this.status = 'paused';
    this.sounding.length = 0;
    this.earned.length = 0;
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
    return {
      score: j.score, accuracy: j.accuracy, maxCombo: j.maxCombo, counts: { ...j.counts }, total: j.total, judged: j.judged,
      failed: j.failed, progress: Math.min(1, Math.max(0, this.now() / this.chart.duration)),
      sections: sectionResults(buildSections(this.opts.barTimes ?? [], this.chart.duration), this.chart.notes, j.judgments),
    };
  }

  static keysHint(window: { low: number; high: number } | null): string {
    return window ? `Your keys: ${noteName(window.low)}–${noteName(window.high)}` : '';
  }
}
