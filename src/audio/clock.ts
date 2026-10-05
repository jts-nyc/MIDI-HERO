/**
 * GameClock: the single time reference for the game.
 *
 * Song time is measured against an "audible" reference clock. With an AudioContext
 * attached, that is the audio clock at the frame currently coming out of the speakers
 * (via getOutputTimestamp), so what you see and what you are judged against line up
 * with what you hear. Before audio exists, performance.now() serves the same role.
 */

export interface OutputTimestamp {
  contextTime?: number;
  performanceTime?: number;
}

export interface AudioTimeSource {
  readonly currentTime: number;
  readonly state?: string;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  getOutputTimestamp?(): OutputTimestamp;
}

/**
 * The browser reports the audio clock against the performance clock once per audio callback,
 * and on some systems (Linux/ChromeOS audio servers with large buffers) each report is a few ms
 * off. Used raw, that error shakes the highway and moves the judging window from frame to
 * frame. The clock keeps a smoothed offset between the two clocks instead: each new report
 * pulls it a fraction of the way, and a report far from it (a device change, a resume) is taken
 * at once. The two clocks drift apart by parts per million, far less than the smoothing lags.
 */
export const OFFSET_SMOOTHING = 0.1; // share of the error taken from each new report
export const OFFSET_SNAP = 0.015; // s: a report this far off is a jump, not jitter

export class GameClock {
  private ctx: AudioTimeSource | null = null;
  /** smoothed (audio reference − performance time), seconds; NaN until the first report */
  private offset = NaN;
  private lastReport = NaN;
  private startSong = 0;
  private startRef = 0;
  private _rate = 1;
  private _playing = false;
  private perfNow: () => number;

  constructor(perfNow: () => number = () => performance.now()) {
    this.perfNow = perfNow;
  }

  get rate(): number {
    return this._rate;
  }

  get playing(): boolean {
    return this._playing;
  }

  get hasAudio(): boolean {
    return this.ctx !== null;
  }

  /** Current performance-timeline time in ms (injectable for tests). */
  perfNowMs(): number {
    return this.perfNow();
  }

  /** Switch to an AudioContext without a jump in song time. */
  attach(ctx: AudioTimeSource): void {
    const song = this.now();
    this.ctx = ctx;
    this.offset = NaN;
    this.lastReport = NaN;
    this.startSong = song;
    this.startRef = this.refNow();
  }

  /** Reference clock (seconds) that corresponds to a performance-timeline timestamp (ms). */
  private refAt(perfMs: number): number {
    if (!this.ctx) return perfMs / 1000;
    const ots = this.ctx.getOutputTimestamp?.();
    const ct = ots?.contextTime ?? 0;
    const pt = ots?.performanceTime ?? 0;
    if (ct > 0 || pt > 0) {
      if (ct !== this.lastReport) {
        // a new report: smooth it in, or take it at once if it is a jump
        this.lastReport = ct;
        const raw = ct - pt / 1000;
        const err = raw - this.offset;
        this.offset = Math.abs(err) < OFFSET_SNAP ? this.offset + err * OFFSET_SMOOTHING : raw;
      }
      return this.offset + perfMs / 1000;
    }
    // Suspended or unsupported: fall back to currentTime with an estimated offset.
    return this.ctx.currentTime + (perfMs - this.perfNow()) / 1000;
  }

  private refNow(): number {
    return this.refAt(this.perfNow());
  }

  /** Song time that is audible at a given performance timestamp (ms). */
  audibleSongTime(perfMs: number): number {
    if (!this._playing) return this.startSong;
    return this.startSong + (this.refAt(perfMs) - this.startRef) * this._rate;
  }

  /** Song time audible right now. */
  now(): number {
    return this.audibleSongTime(this.perfNow());
  }

  start(songTime = 0): void {
    this.startSong = songTime;
    this.startRef = this.refNow();
    this._playing = true;
  }

  pause(): void {
    if (!this._playing) return;
    this.startSong = this.now();
    this._playing = false;
  }

  resume(): void {
    if (this._playing) return;
    this.startRef = this.refNow();
    this._playing = true;
  }

  seek(songTime: number): void {
    this.startSong = songTime;
    this.startRef = this.refNow();
  }

  setRate(rate: number): void {
    const song = this.now();
    this._rate = Math.min(2, Math.max(0.1, rate));
    this.startSong = song;
    this.startRef = this.refNow();
  }

  /** Estimated seconds between scheduling on currentTime and hearing it. */
  outputLatency(): number {
    if (!this.ctx) return 0;
    const ct = this.ctx.getOutputTimestamp?.()?.contextTime ?? 0;
    if (ct > 0) return Math.max(0, this.ctx.currentTime - ct);
    return (this.ctx.baseLatency ?? 0) + (this.ctx.outputLatency ?? 0);
  }

  /** AudioContext time at which to schedule a sound so that it is heard at `songTime`. */
  songTimeToContextTime(songTime: number): number {
    if (!this.ctx) return songTime;
    const audibleRef = this._playing ? this.startRef + (songTime - this.startSong) / this._rate : this.refNow();
    return audibleRef + this.outputLatency();
  }
}
