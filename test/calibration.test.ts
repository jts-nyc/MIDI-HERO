import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import {
  CALIBRATION_BEATS, CALIBRATION_INTERVAL, CALIBRATION_LEAD_IN, calibrationBeats, median, TapCalibrator, visualOffset,
} from '../src/game/calibration.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';

describe('median', () => {
  it('is the middle value, or the mean of the two middle ones', () => {
    expect(median([])).toBe(0);
    expect(median([7])).toBe(7);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([10, 12, 11, 300, 9])).toBe(11); // one wild tap does not move it
  });
});

describe('calibration beats', () => {
  it('has 4 lead-in beats and 8 scored ones, 0.6 s apart', () => {
    const b = calibrationBeats(1);
    expect(b.leadIn).toHaveLength(CALIBRATION_LEAD_IN);
    expect(b.scored).toHaveLength(CALIBRATION_BEATS);
    expect(b.leadIn[0]).toBe(1);
    expect(b.scored[0]).toBeCloseTo(1 + 4 * CALIBRATION_INTERVAL, 9);
    expect(b.scored[7]! - b.scored[6]!).toBeCloseTo(0.6, 9);
  });
});

describe('TapCalibrator', () => {
  const beats = calibrationBeats(1).scored;
  const run = (offsets: (number | null)[]) => {
    const cal = new TapCalibrator(beats);
    offsets.forEach((o, i) => {
      if (o !== null) cal.tap(beats[i]! + o / 1000);
    });
    return cal;
  };

  it('takes the median of 8 taps', () => {
    const r = run([30, 42, 38, 25, 45, 36, 40, 33]).result();
    expect(r).toEqual({ count: 8, offsetMs: 37, spreadMs: 4, ok: true });
  });

  it('measures early taps as a negative offset', () => {
    expect(run([-20, -25, -15, -22, -18, -30, -21, null]).result().offsetMs).toBe(-21);
  });

  it('ignores one wild tap', () => {
    expect(run([30, 32, 28, 250, 31, 29, 33, null]).result()).toMatchObject({ count: 7, offsetMs: 31, ok: true });
  });

  it('books each tap on the nearest free beat and ignores taps between beats', () => {
    const cal = new TapCalibrator(beats);
    expect(cal.tap(beats[2]! + 0.05)).toBe(2);
    expect(cal.tap(beats[2]! + 0.06)).toBe(-1); // beat 2 is taken and beat 3 is too far
    expect(cal.tap(beats[0]! - 0.29)).toBe(-1); // on the lead-in
    expect(cal.tap(beats[3]! + 0.3)).toBe(-1); // halfway between two beats
    expect(cal.tap(beats[3]! + 0.33)).toBe(4); // early for the next beat
    expect(cal.count).toBe(2);
    expect(cal.offsets[4]).toBeCloseTo(-270, 6);
  });

  it('needs at least 5 steady taps', () => {
    expect(run([30, 31, 29, 30, null, null, null, null]).result()).toMatchObject({ count: 4, ok: false });
    expect(run([30, 31, 29, 30, 32, null, null, null]).result()).toMatchObject({ count: 5, ok: true });
    expect(run([-200, 150, -90, 220, 10, -250, 180, 90]).result().ok).toBe(false);
    expect(run([]).result()).toEqual({ count: 0, offsetMs: 0, spreadMs: 0, ok: false });
  });

  it('is done once the last beat is out of reach', () => {
    const cal = new TapCalibrator(beats);
    expect(cal.done(beats[7]! + 0.2)).toBe(false);
    expect(cal.done(beats[7]! + 0.29)).toBe(true);
  });

  it('keeps the result inside the range of the settings', () => {
    const wide = new TapCalibrator([1, 3, 5, 7, 9], 0.5);
    for (const b of [1, 3, 5, 7, 9]) wide.tap(b + 0.4);
    expect(wide.result().offsetMs).toBe(300);
  });
});

describe('visual offset', () => {
  it('is what is left of the visual taps after the keyboard delay', () => {
    expect(visualOffset(55, 30)).toBe(25);
    expect(visualOffset(20, 30)).toBe(-10);
    expect(visualOffset(900, 0)).toBe(300);
  });
});

describe('calibration on the game clock', () => {
  it('a tap heard on the click measures zero; a late tap measures its delay', () => {
    // perf time 1000 ms is context time 4.98 (see FakeAudioContext): 20 ms of output latency
    const t = { perfMs: 1000 };
    const ctx = new FakeAudioContext();
    const clock = new GameClock(() => t.perfMs);
    clock.attach(ctx);
    clock.start(0);
    const beats = calibrationBeats(1).scored;
    // the click is scheduled ahead by the output latency, so that it is heard at its beat
    expect(clock.songTimeToContextTime(beats[0]!)).toBeCloseTo(4.98 + beats[0]! + 0.02, 9);
    const cal = new TapCalibrator(beats);
    beats.forEach((b, i) => cal.tap(clock.audibleSongTime(1000 + b * 1000 + (i % 2 ? 24 : 26))));
    expect(cal.result()).toMatchObject({ count: 8, offsetMs: 25, ok: true });
  });
});
