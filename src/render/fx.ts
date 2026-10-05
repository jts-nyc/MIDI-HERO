/**
 * Effects state: particles, rings, shockwaves, key flashes, call-outs, the streak
 * counter and the meters. Pure: no canvas, no DOM. The session fills it, any highway
 * renderer draws it.
 *
 * Positions are relative to an anchor the renderer knows: the top centre of a key
 * (`pitch`) on the hit line. x grows to the right and y downward, in CSS pixels.
 * Everything runs on `clock`, real seconds, so effects keep their speed when the
 * song is slowed down. Pools are fixed; nothing is allocated while playing.
 */

import { FEEL } from './feel.ts';

export const Tint = { perfect: 0, great: 1, good: 2, late: 3, wrong: 4, gold: 5 } as const;
export type TintId = (typeof Tint)[keyof typeof Tint];

export type HitKind = 'perfect' | 'great' | 'good' | 'late';

export interface Particle {
  active: boolean;
  pitch: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  tint: TintId;
}

/** Expanding ring at a key. `radius` is in white-key widths. */
export interface Ring {
  active: boolean;
  pitch: number;
  age: number;
  life: number;
  radius: number;
  tint: TintId;
}

/** Horizontal wave along the hit line, spreading from a key. */
export interface Shock {
  active: boolean;
  pitch: number;
  age: number;
  life: number;
  tint: TintId;
}

/**
 * A column of light up the lane of a key that was just hit, and a white flash on the key itself
 * for the first `FEEL.keyFlash` seconds. `strength` 0..1 by judgment.
 */
export interface Beam {
  active: boolean;
  pitch: number;
  age: number;
  life: number;
  strength: number;
  tint: TintId;
}

/** A flare along the whole hit line: a milestone, a level-up, star power. */
export interface Surge {
  age: number;
  life: number;
  tint: TintId;
}

/** A key lit in a colour for a moment (red for a missed note). */
export interface KeyFlash {
  active: boolean;
  pitch: number;
  age: number;
  life: number;
  tint: TintId;
}

export type CalloutKind = 'milestone' | 'break' | 'star' | 'fail';

export interface Callout {
  active: boolean;
  text: string;
  kind: CalloutKind;
  age: number;
  life: number;
}

export interface StreakFx {
  /** current streak */
  value: number;
  /** 1 right after a hit, decays to 0 */
  pulse: number;
  /** the streak that just ended, falling apart */
  shatterValue: number;
  shatterAge: number;
  shatterLife: number;
}

/** Light at the screen edges: a multiplier level-up (tinted) or a streak break (red). */
export interface EdgeGlow {
  age: number;
  life: number;
  tint: TintId;
}

export interface Meters {
  multiplier: number;
  /** 0..1 toward the next multiplier level */
  multiplierProgress: number;
  /** 1 right after the multiplier rose, decays to 0 */
  multiplierPulse: number;
  /** 1 right after a streak of 10+ broke and the multiplier fell back, decays to 0 */
  multiplierDrop: number;
  /** 0..1 */
  health: number;
  zone: 'green' | 'yellow' | 'red';
  /** health is low: the highway dims */
  low: boolean;
  /** whether the song can fail (arcade mode) */
  canFail: boolean;
  /** 0..1 */
  starGauge: number;
  /** enough gauge to activate */
  starReady: boolean;
  starActive: boolean;
}

export interface Countdown {
  /** beats left before the song starts; 0 = no countdown on screen */
  value: number;
  /** 0..1 through the current beat */
  phase: number;
}

export interface FxState {
  clock: number;
  particles: Particle[];
  rings: Ring[];
  shocks: Shock[];
  flashes: KeyFlash[];
  beams: Beam[];
  callouts: Callout[];
  streak: StreakFx;
  glow: EdgeGlow;
  surge: Surge;
  meters: Meters;
  countdown: Countdown;
  /** false: meters and counters only, no particles (slow machines, reduced motion) */
  enabled: boolean;
  /** share of the particles a hit bursts into, 0..1; lower levels keep the highway calmer */
  intensity: number;
  rng: () => number;
  cursor: { particles: number; rings: number; shocks: number; flashes: number; beams: number; callouts: number };
}

export const POOL = { particles: 256, rings: 32, shocks: 8, flashes: 32, beams: 32, callouts: 4 } as const;

const GRAVITY = 900; // px/s²
const PULSE_DECAY = 6; // 1/s
const SHATTER_LIFE = 0.7;
const GLOW_LIFE = 0.6;

/** Particles per hit and their size, by judgment. */
const BURST: Record<HitKind, { count: number; size: number; speed: number; ring: number }> = {
  perfect: { count: 14, size: 5, speed: 330, ring: 1.5 },
  great: { count: 9, size: 4, speed: 270, ring: 1.15 },
  good: { count: 5, size: 3, speed: 210, ring: 0.85 },
  late: { count: 0, size: 0, speed: 0, ring: 0.6 },
};

const fill = <T>(n: number, make: () => T): T[] => Array.from({ length: n }, make);

export function createFx(rng: () => number = Math.random): FxState {
  return {
    clock: 0,
    particles: fill(POOL.particles, () => ({ active: false, pitch: 0, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, tint: Tint.perfect })),
    rings: fill(POOL.rings, () => ({ active: false, pitch: 0, age: 0, life: 0, radius: 0, tint: Tint.perfect })),
    shocks: fill(POOL.shocks, () => ({ active: false, pitch: 0, age: 0, life: 0, tint: Tint.perfect })),
    flashes: fill(POOL.flashes, () => ({ active: false, pitch: 0, age: 0, life: 0, tint: Tint.wrong })),
    beams: fill(POOL.beams, () => ({ active: false, pitch: 0, age: 0, life: 0, strength: 0, tint: Tint.perfect })),
    callouts: fill(POOL.callouts, () => ({ active: false, text: '', kind: 'milestone' as CalloutKind, age: 0, life: 0 })),
    streak: { value: 0, pulse: 0, shatterValue: 0, shatterAge: 0, shatterLife: 0 },
    glow: { age: 0, life: 0, tint: Tint.perfect },
    surge: { age: 0, life: 0, tint: Tint.perfect },
    meters: {
      multiplier: 1, multiplierProgress: 0, multiplierPulse: 0, multiplierDrop: 0, health: 0.6, zone: 'green', low: false, canFail: false,
      starGauge: 0, starReady: false, starActive: false,
    },
    countdown: { value: 0, phase: 0 },
    enabled: true,
    intensity: 1,
    rng,
    cursor: { particles: 0, rings: 0, shocks: 0, flashes: 0, beams: 0, callouts: 0 },
  };
}

/** Next free slot of a pool, or the oldest one when the pool is full. */
function take<T extends { active: boolean }>(pool: T[], fx: FxState, name: keyof FxState['cursor']): T {
  const n = pool.length;
  let i = fx.cursor[name];
  for (let k = 0; k < n; k++) {
    const j = (i + k) % n;
    if (!pool[j]!.active) {
      i = j;
      break;
    }
  }
  fx.cursor[name] = (i + 1) % n;
  const item = pool[i]!;
  item.active = true;
  return item;
}

function ring(fx: FxState, pitch: number, radius: number, tint: TintId, life = 0.35): void {
  const r = take(fx.rings, fx, 'rings');
  r.pitch = pitch;
  r.age = 0;
  r.life = life;
  r.radius = radius;
  r.tint = tint;
}

function flash(fx: FxState, pitch: number, tint: TintId, life = 0.3): void {
  const f = take(fx.flashes, fx, 'flashes');
  f.pitch = pitch;
  f.age = 0;
  f.life = life;
  f.tint = tint;
}

function burst(fx: FxState, pitch: number, count: number, size: number, speed: number, tint: TintId): void {
  for (let i = 0; i < count; i++) {
    const p = take(fx.particles, fx, 'particles');
    // a fan upward from the key, a little wider than a right angle
    const angle = -Math.PI / 2 + (fx.rng() - 0.5) * Math.PI * 0.9;
    const v = speed * (0.45 + 0.55 * fx.rng());
    p.pitch = pitch;
    p.x = (fx.rng() - 0.5) * 10;
    p.y = 0;
    p.vx = Math.cos(angle) * v;
    p.vy = Math.sin(angle) * v;
    p.age = 0;
    p.life = 0.35 + 0.3 * fx.rng();
    p.size = size * (0.6 + 0.8 * fx.rng());
    p.tint = tint;
  }
}

/** A chart note was hit. `star`: star power is on, everything is gold and bigger. */
export function emitHit(fx: FxState, pitch: number, kind: HitKind, star = false): void {
  if (!fx.enabled) return;
  const b = BURST[kind];
  const tint = star && kind !== 'late' ? Tint.gold : Tint[kind];
  burst(fx, pitch, Math.round((star ? b.count + 4 : b.count) * fx.intensity), b.size, b.speed, tint);
  ring(fx, pitch, b.ring, tint);
  if (kind !== 'late') {
    const beam = take(fx.beams, fx, 'beams');
    beam.pitch = pitch;
    beam.age = 0;
    beam.life = FEEL.beamLife[kind];
    beam.strength = FEEL.beamStrength[kind] * (star ? 1.15 : 1);
    beam.tint = tint;
  }
  if (kind === 'perfect') {
    const s = take(fx.shocks, fx, 'shocks');
    s.pitch = pitch;
    s.age = 0;
    s.life = 0.4;
    s.tint = tint;
  }
}

/** A sustained note is being held: a few sparks rise from its key. */
export function emitSpark(fx: FxState, pitch: number, star = false): void {
  if (!fx.enabled) return;
  burst(fx, pitch, 2, 3, 160, star ? Tint.gold : Tint.great);
}

/** A chart note went by unplayed: its key flashes red. */
export function emitMiss(fx: FxState, pitch: number): void {
  flash(fx, pitch, Tint.wrong, 0.35);
}

/** A key was pressed that no note asked for. */
export function emitWrong(fx: FxState, pitch: number): void {
  flash(fx, pitch, Tint.wrong, 0.25);
  if (fx.enabled) ring(fx, pitch, 0.7, Tint.wrong, 0.25);
}

function surge(fx: FxState, tint: TintId): void {
  fx.surge.age = 0;
  fx.surge.life = FEEL.surgeLife;
  fx.surge.tint = tint;
}

/**
 * A streak long enough to carry a multiplier ended: the badge sinks and greys for a moment.
 * Shown on every level: it says what was lost without a red flash or a noise.
 */
export function emitDrop(fx: FxState, streak: number): void {
  if (streak >= 10) fx.meters.multiplierDrop = 1;
}

/** The streak grew to `value`. */
export function emitStreak(fx: FxState, value: number): void {
  fx.streak.value = value;
  fx.streak.pulse = 1;
}

/** A streak of `value` notes ended. Short streaks just reset; longer ones shatter. */
export function emitBreak(fx: FxState, value: number): void {
  fx.streak.value = 0;
  fx.streak.pulse = 0;
  if (value < 3) return;
  fx.streak.shatterValue = value;
  fx.streak.shatterAge = 0;
  fx.streak.shatterLife = SHATTER_LIFE;
  fx.glow.age = 0;
  fx.glow.life = GLOW_LIFE;
  fx.glow.tint = Tint.wrong;
}

export function emitCallout(fx: FxState, text: string, kind: CalloutKind, life = 1.4): void {
  const c = take(fx.callouts, fx, 'callouts');
  c.text = text;
  c.kind = kind;
  c.age = 0;
  c.life = life;
}

export function emitMilestone(fx: FxState, streak: number): void {
  emitCallout(fx, `${streak} NOTE STREAK!`, 'milestone');
  if (fx.enabled) surge(fx, Tint.good);
}

/** The multiplier rose to `multiplier`. `glow` false: the badge pulses, the screen edges stay dark. */
export function emitLevel(fx: FxState, multiplier: number, glow = true): void {
  fx.meters.multiplierPulse = 1;
  fx.meters.multiplierDrop = 0;
  if (!glow) return;
  if (fx.enabled) surge(fx, multiplier >= 4 ? Tint.perfect : multiplier === 3 ? Tint.great : Tint.good);
  fx.glow.age = 0;
  fx.glow.life = GLOW_LIFE;
  fx.glow.tint = multiplier >= 4 ? Tint.perfect : multiplier === 3 ? Tint.great : Tint.good;
}

/** Star power went on. */
export function emitStar(fx: FxState): void {
  emitCallout(fx, 'STAR POWER!', 'star', 1.2);
  if (fx.enabled) surge(fx, Tint.gold);
  fx.glow.age = 0;
  fx.glow.life = GLOW_LIFE * 1.5;
  fx.glow.tint = Tint.gold;
}

function expire(pool: { active: boolean; age: number; life: number }[], dt: number): void {
  for (let i = 0; i < pool.length; i++) {
    const e = pool[i]!;
    if (e.active && (e.age += dt) >= e.life) e.active = false;
  }
}

/** Advance every effect by `dt` real seconds. */
export function stepFx(fx: FxState, dt: number): void {
  if (!(dt > 0)) return;
  fx.clock += dt;
  const particles = fx.particles;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i]!;
    if (!p.active) continue;
    p.age += dt;
    if (p.age >= p.life) {
      p.active = false;
      continue;
    }
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  expire(fx.rings, dt);
  expire(fx.shocks, dt);
  expire(fx.flashes, dt);
  expire(fx.beams, dt);
  expire(fx.callouts, dt);
  const decay = Math.exp(-PULSE_DECAY * dt);
  fx.streak.pulse *= decay;
  fx.meters.multiplierPulse *= decay;
  if (fx.meters.multiplierDrop > 0) fx.meters.multiplierDrop = Math.max(0, fx.meters.multiplierDrop - dt / FEEL.dropLife);
  if (fx.surge.life > 0 && (fx.surge.age += dt) >= fx.surge.life) fx.surge.life = 0;
  if (fx.streak.shatterLife > 0 && (fx.streak.shatterAge += dt) >= fx.streak.shatterLife) fx.streak.shatterLife = 0;
  if (fx.glow.life > 0 && (fx.glow.age += dt) >= fx.glow.life) fx.glow.life = 0;
}

/**
 * Countdown for the lead-in: `beats` clicks, one every `beatSeconds`, the last one a beat
 * before song time 0. Shows "4 3 2 1" on the clicks of a 4/4 count-in.
 */
export function setCountdown(fx: FxState, songTime: number, beats: number, beatSeconds: number): void {
  const c = fx.countdown;
  if (songTime >= 0 || beatSeconds <= 0 || songTime < -beats * beatSeconds) {
    c.value = 0;
    c.phase = 0;
    return;
  }
  const left = -songTime / beatSeconds; // beats until the song starts
  c.value = Math.min(beats, Math.ceil(left));
  c.phase = c.value - left;
}

export function activeCount(pool: readonly { active: boolean }[]): number {
  let n = 0;
  for (const p of pool) if (p.active) n++;
  return n;
}
