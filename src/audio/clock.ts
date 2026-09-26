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

export class GameClock {
  private ctx: AudioTimeSource | null = null;
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
      return ct + (perfMs - pt) / 1000;
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
