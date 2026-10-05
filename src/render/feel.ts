/**
 * Feel: the tuning constants and the small pure helpers the highway renderers share for hit
 * feedback, beat pulses and the frame-time fallback. No canvas, no DOM; see docs/FEEL.md for
 * what each number does and why it has the value it has.
 */
import type { BeatLine } from '../midi/parse.ts';

export const FEEL = {
  /** light column up the lane from a hit: seconds it lasts, by judgment */
  beamLife: { perfect: 0.22, great: 0.18, good: 0.14 },
  /** brightness of the column, by judgment (0..1) */
  beamStrength: { perfect: 1, great: 0.75, good: 0.5 },
  /** height of the column as a share of the highway */
  beamReach: 0.45,
  /** the struck key flashes white for this long at the start of the column */
  keyFlash: 0.11,
  /** timing word: total life, pop-in time, starting scale, how far it rises (px) */
  popup: { life: 0.5, popIn: 0.07, overshoot: 1.6, rise: 24, fadeFrom: 0.55 },
  /** font size of "Perfect" and of every other word, px */
  popupSize: { perfect: 19, other: 15 },
  /** hit line brightens on every beat, more on a bar line: seconds it decays over, weight of a beat */
  beatPulse: 0.14,
  beatWeight: 0.4,
  /** light above the hit line that grows with the multiplier; alpha by multiplier 1..4, and in star power */
  charge: [0.0, 0.1, 0.16, 0.24] as readonly number[],
  chargeStar: 0.32,
  /** px of the charge band above the hit line */
  chargeHeight: 34,
  /** the multiplier badge sinks and greys when a streak of 10+ breaks; seconds */
  dropLife: 0.5,
  /** flare along the hit line on a milestone, a level-up or star power; seconds */
  surgeLife: 0.45,
} as const;

/** Where a timing word is `age` seconds after its hit: written into `out`, nothing allocated. */
export interface PopupPose {
  scale: number;
  alpha: number;
  /** px above its resting row */
  rise: number;
}

export function popupPose(age: number, out: PopupPose, still = false): PopupPose {
  const p = FEEL.popup;
  const t = Math.max(0, age) / p.life;
  out.alpha = t <= p.fadeFrom ? 1 : Math.max(0, 1 - (t - p.fadeFrom) / (1 - p.fadeFrom));
  if (still) {
    out.scale = 1;
    out.rise = 0;
    return out;
  }
  // Snap in from big to its size (ease-out), then drift up, slowing.
  const k = Math.min(1, Math.max(0, age) / p.popIn);
  out.scale = 1 + (p.overshoot - 1) * (1 - k) * (1 - k);
  out.rise = p.rise * (1 - (1 - Math.min(1, t)) ** 2);
  return out;
}

/**
 * How bright the beat pulse is at `time`: 1 just as a bar line reaches the hit line, `beatWeight`
 * for a beat, decaying to 0 over `beatPulse` seconds. `from` is an index at or before the lines
 * that can matter (the renderers keep a forward cursor).
 */
export function beatPulse(lines: readonly BeatLine[], from: number, time: number): number {
  let v = 0;
  for (let i = Math.max(0, from); i < lines.length; i++) {
    const b = lines[i]!;
    if (b.time > time) break;
    const age = time - b.time;
    if (age >= FEEL.beatPulse) continue;
    const pulse = (1 - age / FEEL.beatPulse) * (b.isBar ? 1 : FEEL.beatWeight);
    if (pulse > v) v = pulse;
  }
  return v;
}

/** The count-in pulses like a beat: 1 on each click, decaying over the first part of the beat. */
export function countPulse(phase: number): number {
  return Math.max(0, 1 - phase * 3);
}

/** Alpha of the charge light above the hit line. */
export function chargeAlpha(multiplier: number, star: boolean): number {
  if (star) return FEEL.chargeStar;
  return FEEL.charge[Math.max(0, Math.min(FEEL.charge.length - 1, multiplier - 1))]!;
}

// ---------------------------------------------------------------------------
// Frame-time fallback
// ---------------------------------------------------------------------------

/** A frame timestamp older than this (ms), or from the future, is not trusted: headless Chrome sends the odd stray one. */
export const FRAME_STAMP_TRUST_MS = 50;

/**
 * The instant to draw a frame at: the frame's own requestAnimationFrame timestamp when it is from
 * the last few frames, otherwise now. Shared by the full game and simple mode (docs/FEEL.md).
 */
export function frameStamp(frameMs: number, nowMs: number): number {
  return frameMs <= nowMs && frameMs > nowMs - FRAME_STAMP_TRUST_MS ? frameMs : nowMs;
}

/** 0: everything; 1: half the particles, canvas at most 1.5× resolution; 2: no particles or lights, 1× resolution. */
export type EffectsLevel = 0 | 1 | 2;

export const GOVERNOR = {
  /** frames per verdict */
  window: 90,
  /** a frame interval above this (ms) is a slow frame: below ~50 fps */
  slowMs: 20,
  /** step down when at least this share of a window's frames are slow */
  degradeShare: 0.25,
  /** a window with at most this share of slow frames is a good one */
  goodShare: 0.03,
  /** good windows in a row before stepping back up one level */
  recoverWindows: 10,
  /** times the level may step back up in one song, so it cannot see-saw */
  maxRecoveries: 1,
  /** intervals longer than this are a hitch (tab switch, pause), not a slow frame, and are skipped */
  ignoreMs: 250,
  /** frames at the start of a song that are not judged (loading, first draws) */
  warmup: 45,
} as const;

/**
 * Watches the time between frames and says when to turn effects down (or back up). Pure: feed it
 * every frame interval; it returns the new level when it changes, otherwise null.
 */
export class FrameGovernor {
  level: EffectsLevel = 0;
  private frames = 0;
  private slow = 0;
  private seen = 0;
  private good = 0;
  private recoveries = 0;

  constructor(private readonly floor: EffectsLevel = 0) {
    this.level = floor;
  }

  /** A new song: start judging afresh, at the level the last song ended on. */
  reset(): void {
    this.frames = 0;
    this.slow = 0;
    this.seen = 0;
    this.good = 0;
    this.recoveries = 0;
  }

  sample(intervalMs: number): EffectsLevel | null {
    if (!(intervalMs > 0) || intervalMs > GOVERNOR.ignoreMs) return null;
    if (this.seen++ < GOVERNOR.warmup) return null;
    this.frames++;
    if (intervalMs > GOVERNOR.slowMs) this.slow++;
    if (this.frames < GOVERNOR.window) return null;
    const share = this.slow / this.frames;
    this.frames = 0;
    this.slow = 0;
    if (share >= GOVERNOR.degradeShare && this.level < 2) {
      this.good = 0;
      return (this.level = (this.level + 1) as EffectsLevel);
    }
    if (share <= GOVERNOR.goodShare) {
      if (++this.good >= GOVERNOR.recoverWindows && this.level > this.floor && this.recoveries < GOVERNOR.maxRecoveries) {
        this.good = 0;
        this.recoveries++;
        return (this.level = (this.level - 1) as EffectsLevel);
      }
    } else this.good = 0;
    return null;
  }
}
