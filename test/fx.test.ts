import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import {
  activeCount, createFx, emitBreak, emitHit, emitLevel, emitMilestone, emitMiss, emitStreak, emitWrong, POOL, setCountdown, stepFx, Tint,
} from '../src/render/fx.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

/** Deterministic stand-in for Math.random. */
function lcg(seed = 1): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

describe('effects state', () => {
  it('bursts by judgment: more and bigger particles for a better hit', () => {
    const counts = (['perfect', 'great', 'good', 'late'] as const).map((kind) => {
      const fx = createFx(lcg());
      emitHit(fx, 60, kind);
      return [activeCount(fx.particles), activeCount(fx.rings), activeCount(fx.shocks)];
    });
    expect(counts).toEqual([[14, 1, 1], [9, 1, 0], [5, 1, 0], [0, 1, 0]]);
    const size = (kind: 'perfect' | 'good') => {
      const fx = createFx(() => 0.5);
      emitHit(fx, 60, kind);
      return fx.particles[0]!.size;
    };
    expect(size('perfect')).toBeGreaterThan(size('good'));
  });

  it('particles fly up from the key, fall, and die', () => {
    const fx = createFx(lcg());
    emitHit(fx, 64, 'perfect');
    const live = fx.particles.filter((p) => p.active);
    expect(live.every((p) => p.pitch === 64 && p.vy < 0 && p.tint === Tint.perfect)).toBe(true);
    stepFx(fx, 1 / 60);
    expect(live.every((p) => p.y < 0)).toBe(true);
    for (let i = 0; i < 60; i++) stepFx(fx, 1 / 60);
    expect(activeCount(fx.particles)).toBe(0);
    expect(activeCount(fx.rings)).toBe(0);
    expect(activeCount(fx.shocks)).toBe(0);
  });

  it('pools are fixed: a flood of hits reuses slots and never grows them', () => {
    const fx = createFx(lcg());
    const pools = [fx.particles, fx.rings, fx.shocks, fx.flashes, fx.callouts];
    const first = pools.map((p) => p[0]);
    for (let i = 0; i < 200; i++) {
      emitHit(fx, 48 + (i % 25), 'perfect', i % 2 === 0);
      emitMiss(fx, 48 + (i % 25));
      emitWrong(fx, 48 + (i % 25));
      emitMilestone(fx, 10);
      if (i % 3 === 0) stepFx(fx, 1 / 60);
    }
    expect(pools.map((p) => p.length)).toEqual([POOL.particles, POOL.rings, POOL.shocks, POOL.flashes, POOL.callouts]);
    expect(pools.map((p) => p[0])).toEqual(first);
    expect(first.every((o, i) => o === pools[i]![0])).toBe(true);
    expect(activeCount(fx.particles)).toBeLessThanOrEqual(POOL.particles);
  });

  it('star power turns hits gold', () => {
    const fx = createFx(lcg());
    emitHit(fx, 60, 'great', true);
    expect(fx.particles.filter((p) => p.active).every((p) => p.tint === Tint.gold)).toBe(true);
    expect(activeCount(fx.particles)).toBe(13);
  });

  it('a miss flashes its key red; a wrong key flashes and rings', () => {
    const fx = createFx(lcg());
    emitMiss(fx, 62);
    expect(fx.flashes.filter((f) => f.active).map((f) => [f.pitch, f.tint])).toEqual([[62, Tint.wrong]]);
    expect(activeCount(fx.particles)).toBe(0);
    emitWrong(fx, 63);
    expect(activeCount(fx.flashes)).toBe(2);
    expect(activeCount(fx.rings)).toBe(1);
  });

  it('with effects off only the flashes and counters remain', () => {
    const fx = createFx(lcg());
    fx.enabled = false;
    emitHit(fx, 60, 'perfect');
    emitWrong(fx, 61);
    emitStreak(fx, 5);
    expect([activeCount(fx.particles), activeCount(fx.rings), activeCount(fx.shocks)]).toEqual([0, 0, 0]);
    expect(activeCount(fx.flashes)).toBe(1);
    expect(fx.streak.value).toBe(5);
  });

  it('the streak pulses on a hit and shatters when a real streak breaks', () => {
    const fx = createFx(lcg());
    emitStreak(fx, 12);
    expect(fx.streak).toMatchObject({ value: 12, pulse: 1 });
    stepFx(fx, 0.2);
    expect(fx.streak.pulse).toBeLessThan(0.5);
    emitBreak(fx, 12);
    expect(fx.streak).toMatchObject({ value: 0, shatterValue: 12 });
    expect(fx.streak.shatterLife).toBeGreaterThan(0);
    expect(fx.glow).toMatchObject({ tint: Tint.wrong });
    expect(fx.glow.life).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) stepFx(fx, 1 / 60);
    expect(fx.streak.shatterLife).toBe(0);
    expect(fx.glow.life).toBe(0);
    emitBreak(fx, 2); // too short to make a scene
    expect(fx.streak.shatterLife).toBe(0);
  });

  it('milestones call out and the multiplier level lights the edges', () => {
    const fx = createFx(lcg());
    emitMilestone(fx, 25);
    expect(fx.callouts.filter((c) => c.active).map((c) => [c.text, c.kind])).toEqual([['25 NOTE STREAK!', 'milestone']]);
    emitLevel(fx, 3);
    expect(fx.meters.multiplierPulse).toBe(1);
    expect(fx.glow.life).toBeGreaterThan(0);
    stepFx(fx, 2);
    expect(activeCount(fx.callouts)).toBe(0);
  });

  it('counts down 4 3 2 1 on the clicks of the count-in', () => {
    const fx = createFx();
    const at = (t: number) => {
      setCountdown(fx, t, 4, 0.5);
      return fx.countdown.value;
    };
    expect([-3, -2.01, -2, -1.99, -1.5, -1.49, -1, -0.5, -0.01, 0, 1].map(at)).toEqual([0, 0, 4, 4, 3, 3, 2, 1, 1, 0, 0]);
    setCountdown(fx, -1.75, 4, 0.5);
    expect(fx.countdown.phase).toBeCloseTo(0.5, 9);
    setCountdown(fx, -1.5, 3, 0.5);
    expect(fx.countdown.value).toBe(3);
  });
});

describe('PlaySession fills the effects state', () => {
  const PPQ = 480;
  const secs = (s: number) => Math.round(s * 2 * PPQ);
  function harness(n: number, over: Partial<SessionOptions> = {}) {
    const evs = Array.from({ length: n }, (_, i) => [on(secs(1 + i * 0.5), 60 + (i % 5)), off(secs(1.2 + i * 0.5), 60 + (i % 5))]).flat();
    const chart = buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(secs(2 + n * 0.5))]])), { parts: [{ track: 0, channel: 0 }] });
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: null, hint: '', ...over,
    });
    const goTo = (songTime: number) => {
      t.perfMs += ((songTime - session.now()) * 1000) / session.opts.rate;
      session.update();
    };
    const down = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const play = (i: number) => {
      goTo(1 + i * 0.5);
      down(60 + (i % 5));
    };
    return { session, goTo, down, play, fx: session.fx };
  }

  it('a hit bursts at the key and grows the streak', () => {
    const { play, fx } = harness(4);
    play(0);
    expect(activeCount(fx.particles)).toBe(14);
    expect(fx.particles.find((p) => p.active)!.pitch).toBe(60);
    expect(fx.streak).toMatchObject({ value: 1, pulse: 1 });
    play(1);
    expect(fx.streak.value).toBe(2);
  });

  it('a miss flashes the key of the missed note and breaks the streak', () => {
    const { play, goTo, fx } = harness(6);
    for (let i = 0; i < 4; i++) play(i);
    goTo(3.2); // note 4 (pitch 64, at 3.0) missed
    expect(fx.flashes.filter((f) => f.active).map((f) => f.pitch)).toEqual([64]);
    expect(fx.streak).toMatchObject({ value: 0, shatterValue: 4 });
  });

  it('a wrong key flashes where it was pressed', () => {
    const { goTo, down, fx, session } = harness(3);
    goTo(0.5);
    down(70);
    expect(session.judge.counts.wrong).toBe(1);
    expect(fx.flashes.filter((f) => f.active).map((f) => f.pitch)).toEqual([70]);
  });

  it('the tenth hit raises the multiplier and calls out the streak', () => {
    const { play, goTo, fx } = harness(12);
    for (let i = 0; i < 9; i++) play(i);
    goTo(5.2);
    expect(fx.meters).toMatchObject({ multiplier: 1, multiplierProgress: 0.9 });
    play(9);
    goTo(5.52);
    expect(fx.meters).toMatchObject({ multiplier: 2, multiplierProgress: 0 });
    expect(fx.meters.multiplierPulse).toBeGreaterThan(0.5);
    expect(fx.callouts.filter((c) => c.active).map((c) => c.text)).toEqual(['10 NOTE STREAK!']);
  });

  it('health and its zone follow the judge', () => {
    const { goTo, fx, session } = harness(12);
    expect(fx.meters).toMatchObject({ health: 0.6, zone: 'green', low: false, canFail: false });
    goTo(3.2); // five notes missed
    expect(fx.meters.health).toBeCloseTo(0.2, 9);
    expect(fx.meters).toMatchObject({ zone: 'red', low: true });
    expect(session.mixLevel).toBeLessThan(1);
  });

  it('shows the countdown through the lead-in and clears it when the song starts', () => {
    const { goTo, fx } = harness(3);
    const seen: number[] = [];
    for (let t = -2.9; t < 0.3; t += 0.1) {
      goTo(t);
      if (seen.at(-1) !== fx.countdown.value) seen.push(fx.countdown.value);
    }
    expect(seen).toEqual([0, 4, 3, 2, 1, 0]);
  });

  it('effects run in real time when the song is slowed down', () => {
    const { goTo, fx } = harness(3, { rate: 0.5 });
    goTo(-1);
    const before = fx.clock;
    goTo(-0.975); // 25 ms of song time = 50 ms of real time at half speed
    expect(fx.clock - before).toBeCloseTo(0.05, 6);
  });

  it('the effects option turns the particles off', () => {
    const { play, fx } = harness(3, { effects: false });
    play(0);
    expect(activeCount(fx.particles)).toBe(0);
    expect(fx.streak.value).toBe(1);
  });
});
