import { describe, expect, it } from 'vitest';
import { GameClock, type AudioTimeSource } from '../src/audio/clock.ts';

/** Fake performance clock plus fake AudioContext whose audible time lags currentTime by `latency`. */
function fakes(latency = 0.05) {
  const t = { perfMs: 1000 };
  const ctx: AudioTimeSource & { currentTime: number } = {
    currentTime: 10,
    getOutputTimestamp: () => ({ contextTime: ctx.currentTime - latency, performanceTime: t.perfMs }),
  };
  const advance = (sec: number) => {
    t.perfMs += sec * 1000;
    ctx.currentTime += sec;
  };
  return { t, ctx, advance, clock: new GameClock(() => t.perfMs) };
}

describe('GameClock without audio', () => {
  it('runs on the performance clock, pauses and resumes', () => {
    const { advance, clock } = fakes();
    clock.start(0);
    advance(1);
    expect(clock.now()).toBeCloseTo(1, 9);
    clock.pause();
    advance(5);
    expect(clock.now()).toBeCloseTo(1, 9);
    clock.resume();
    advance(0.5);
    expect(clock.now()).toBeCloseTo(1.5, 9);
  });

  it('applies the rate without a jump', () => {
    const { advance, clock } = fakes();
    clock.start(0);
    advance(1);
    clock.setRate(0.5);
    expect(clock.now()).toBeCloseTo(1, 9);
    advance(1);
    expect(clock.now()).toBeCloseTo(1.5, 9);
  });

  it('maps a past performance timestamp to the song time audible then', () => {
    const { t, advance, clock } = fakes();
    clock.start(0);
    advance(2);
    expect(clock.audibleSongTime(t.perfMs - 100)).toBeCloseTo(1.9, 9);
  });
});

describe('GameClock with audio', () => {
  it('attaches without a jump and uses the audible timeline', () => {
    const { ctx, advance, clock } = fakes(0.05);
    clock.start(0);
    advance(1);
    clock.attach(ctx);
    expect(clock.now()).toBeCloseTo(1, 9);
    advance(1);
    expect(clock.now()).toBeCloseTo(2, 9);
    expect(clock.outputLatency()).toBeCloseTo(0.05, 9);
  });

  it('schedules on currentTime so the sound is heard at the song time', () => {
    const { ctx, advance, clock } = fakes(0.05);
    clock.attach(ctx);
    clock.start(0);
    advance(1);
    // Song time 1.5 is audible 0.5 s from now; schedule it 0.05 s earlier on the context clock.
    expect(clock.songTimeToContextTime(1.5)).toBeCloseTo(ctx.currentTime + 0.5, 9);
    // With latency: audible ref for 1.5 = (currentTime - 0.05) + 0.5; plus latency 0.05 = currentTime + 0.5
  });

  it('falls back to currentTime when getOutputTimestamp reports 0/0 (suspended)', () => {
    const { ctx, advance, clock } = fakes(0.05);
    ctx.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
    clock.attach(ctx);
    clock.start(0);
    advance(1);
    expect(clock.now()).toBeCloseTo(1, 9);
  });
});

describe('GameClock offset smoothing', () => {
  /** An audio clock that reports every 10 ms with up to ±`jitterMs` of error in its performance time. */
  function jittery(jitterMs: number, seed = 1) {
    let x = seed;
    const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
    const t = { perfMs: 1000 };
    let report = { contextTime: 0.01, performanceTime: 1000 };
    const ctx: AudioTimeSource & { currentTime: number } = {
      currentTime: 0.01,
      getOutputTimestamp: () => report,
    };
    const advance = (ms: number) => {
      const before = Math.floor(t.perfMs / 10);
      t.perfMs += ms;
      ctx.currentTime += ms / 1000;
      if (Math.floor(t.perfMs / 10) !== before) {
        const ct = ctx.currentTime - 0.04;
        report = { contextTime: ct, performanceTime: t.perfMs - 40 + rnd() * jitterMs };
      }
    };
    return { t, ctx, advance, clock: new GameClock(() => t.perfMs) };
  }

  /** Spread of the song-time step per 16.7 ms frame around the true step, in ms. */
  function frameJitter(jitterMs: number): number {
    const { ctx, advance, clock } = jittery(jitterMs);
    clock.attach(ctx);
    clock.start(0);
    for (let i = 0; i < 120; i++) { advance(1); clock.now(); } // settle
    let prev = clock.now();
    let worst = 0;
    for (let f = 0; f < 600; f++) {
      for (let i = 0; i < 16; i++) { advance(1); clock.now(); }
      advance(0.7);
      const now = clock.now();
      worst = Math.max(worst, Math.abs((now - prev) * 1000 - 16.7));
      prev = now;
    }
    return worst;
  }

  it('turns ±4 ms of report jitter into well under 1 ms of frame-to-frame error', () => {
    expect(frameJitter(0)).toBeLessThan(0.01);
    expect(frameJitter(4)).toBeLessThan(1);
  });

  it('takes a jump at once instead of smoothing it in', () => {
    const { ctx, advance, clock, t } = jittery(0);
    clock.attach(ctx);
    clock.start(0);
    advance(100);
    const before = clock.now();
    // the audio device changed: the audio clock is now 200 ms behind where it was
    ctx.getOutputTimestamp = () => ({ contextTime: ctx.currentTime - 0.24, performanceTime: t.perfMs });
    ctx.currentTime += 0.001;
    expect(before - clock.now()).toBeGreaterThan(0.19);
  });

  it('follows a slow drift between the audio and performance clocks', () => {
    const { ctx, clock, t } = jittery(0);
    let ct = 1;
    ctx.getOutputTimestamp = () => ({ contextTime: ct, performanceTime: t.perfMs });
    clock.attach(ctx);
    clock.start(0);
    // the audio clock runs 200 ppm fast for a minute
    for (let i = 0; i < 6000; i++) { t.perfMs += 10; ct += 0.01 * 1.0002; clock.now(); }
    expect(clock.now()).toBeCloseTo(60 * 1.0002, 3);
  });
});
