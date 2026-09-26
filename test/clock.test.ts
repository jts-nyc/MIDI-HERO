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
