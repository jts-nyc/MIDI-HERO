/** Guided latency calibration: tap along to a row of beats, take the median offset. Pure. */

export const CALIBRATION_BEATS = 8;
/** Beats before the scored ones, to find the pulse. */
export const CALIBRATION_LEAD_IN = 4;
export const CALIBRATION_INTERVAL = 0.6; // s between beats (100 BPM)
/** Fewest taps that make a usable measurement. */
export const CALIBRATION_MIN_TAPS = 5;
/** A tap further than this from every beat is not a tap on a beat. */
export const CALIBRATION_TOLERANCE = 0.28; // s, less than half the interval
export const OFFSET_LIMIT_MS = 300;

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Times of the beats of one run, in seconds: the lead-in first, then the scored beats. */
export function calibrationBeats(start: number, interval = CALIBRATION_INTERVAL, leadIn = CALIBRATION_LEAD_IN, beats = CALIBRATION_BEATS): { leadIn: number[]; scored: number[] } {
  const at = (i: number) => start + i * interval;
  return {
    leadIn: Array.from({ length: leadIn }, (_, i) => at(i)),
    scored: Array.from({ length: beats }, (_, i) => at(leadIn + i)),
  };
}

export interface CalibrationResult {
  /** taps that landed on a beat */
  count: number;
  /** median of tap time minus beat time, in ms, rounded and clamped to the settings range; + = taps come late */
  offsetMs: number;
  /** median distance of the taps from that median, in ms: how steady the tapping was */
  spreadMs: number;
  /** enough taps, and steady enough, to trust */
  ok: boolean;
}

/** Collects the taps of one run. Times are seconds on whatever clock the beats were given in. */
export class TapCalibrator {
  readonly offsets: (number | null)[];
  private readonly beats: readonly number[];
  private readonly tolerance: number;

  constructor(beats: readonly number[], tolerance = CALIBRATION_TOLERANCE) {
    this.beats = beats;
    this.tolerance = tolerance;
    this.offsets = beats.map(() => null);
  }

  /** Book a tap on the nearest beat that has none yet. Returns the beat index, or -1 if it was not near any. */
  tap(time: number): number {
    let best = -1;
    let bestAbs = Infinity;
    for (let i = 0; i < this.beats.length; i++) {
      if (this.offsets[i] !== null) continue;
      const d = Math.abs(time - this.beats[i]!);
      if (d <= this.tolerance && d < bestAbs) {
        best = i;
        bestAbs = d;
      }
    }
    if (best >= 0) this.offsets[best] = (time - this.beats[best]!) * 1000;
    return best;
  }

  get count(): number {
    return this.offsets.reduce((n: number, o) => n + (o === null ? 0 : 1), 0);
  }

  /** True once the last beat is out of reach. */
  done(time: number): boolean {
    return this.beats.length === 0 || time > this.beats[this.beats.length - 1]! + this.tolerance;
  }

  result(): CalibrationResult {
    const taps = this.offsets.filter((o): o is number => o !== null);
    const mid = median(taps);
    const spread = median(taps.map((o) => Math.abs(o - mid)));
    return {
      count: taps.length,
      offsetMs: Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(mid))),
      spreadMs: Math.round(spread),
      ok: taps.length >= CALIBRATION_MIN_TAPS && spread <= 60,
    };
  }
}

/**
 * The visual offset from the two measurements. Tapping to what you see includes the delay
 * of the keyboard (the input offset) and the delay of the screen; the difference is the screen's.
 */
export function visualOffset(visualTapOffsetMs: number, inputOffsetMs: number): number {
  return Math.max(-OFFSET_LIMIT_MS, Math.min(OFFSET_LIMIT_MS, Math.round(visualTapOffsetMs - inputOffsetMs)));
}
