import { describe, expect, it } from 'vitest';
import { buildChart, chooseWindow, foldPitch } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf } from './helpers/smf.ts';

const PPQ = 480;
const seq = (pitches: number[], channel = 0, step = PPQ) =>
  pitches.flatMap((p, i) => [on(i * step, p, channel), off(i * step + step / 2, p, channel)]);

describe('chooseWindow', () => {
  it('picks the C-aligned window covering the most notes', () => {
    // 25-key span = 24 semitones. Notes mostly in C4..C6 with two outliers below.
    const pitches = [60, 62, 64, 67, 72, 76, 79, 84, 48, 50];
    expect(chooseWindow(pitches, 24)).toEqual({ low: 60, high: 84 });
  });

  it('prefers the window nearest the median on ties', () => {
    // Every note fits in either C3..C5 or C4..C6 (only pitch 60..72 used)
    expect(chooseWindow([60, 64, 67, 72], 24)).toEqual({ low: 60, high: 84 });
  });
});

describe('foldPitch', () => {
  it('folds by octaves into the window and leaves in-range pitches alone', () => {
    const w = { low: 60, high: 84 };
    expect(foldPitch(64, w)).toBe(64);
    expect(foldPitch(40, w)).toBe(64);
    expect(foldPitch(95, w)).toBe(83);
    expect(foldPitch(84, w)).toBe(84);
  });
});

describe('buildChart', () => {
  it('selects only the chosen parts and puts the rest in the backing', () => {
    const song = parseSong(smf([
      [...seq([60, 62, 64], 0), end(PPQ * 3)],
      [...seq([48, 50, 52], 1), end(PPQ * 3)],
    ]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });
    expect(chart.notes.map((n) => n.pitch)).toEqual([60, 62, 64]);
    expect(chart.backing.filter((e) => e.type === 'on').map((e) => e.pitch)).toEqual([48, 50, 52]);
    expect(chart.window).toBeNull();
    expect(chart.foldedRatio).toBe(0);
  });

  it('splits a two-hand part by pitch and can keep one hand', () => {
    const song = parseSong(smf([[...seq([48, 60, 52, 64], 0), end(PPQ * 4)]]));
    const both = buildChart(song, { parts: [{ track: 0, channel: 0 }], split: 60 });
    expect(both.notes.map((n) => n.hand)).toEqual(['L', 'R', 'L', 'R']);
    const right = buildChart(song, { parts: [{ track: 0, channel: 0 }], split: 60, hands: ['R'] });
    expect(right.notes.map((n) => n.pitch)).toEqual([60, 64]);
    // the left hand goes to the backing
    expect(right.backing.filter((e) => e.type === 'on').map((e) => e.pitch)).toEqual([48, 52]);
  });

  it('folds out-of-window notes and marks them', () => {
    const song = parseSong(smf([[...seq([60, 40, 95], 0), end(PPQ * 3)]]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }], window: { low: 60, high: 84 } });
    expect(chart.notes.map((n) => [n.pitch, n.folded])).toEqual([[60, false], [64, true], [83, true]]);
    expect(chart.foldedRatio).toBeCloseTo(2 / 3, 6);
    expect(chart.minPitch).toBe(60);
    expect(chart.maxPitch).toBe(83);
  });

  it('drops instead of folding in drop mode', () => {
    const song = parseSong(smf([[...seq([60, 40], 0), end(PPQ * 2)]]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }], window: { low: 60, high: 84 }, foldMode: 'drop' });
    expect(chart.notes.map((n) => n.pitch)).toEqual([60]);
    expect(chart.droppedCount).toBe(1);
  });

  it('merges two notes that fold onto one key within 30 ms', () => {
    // 48 and 60 at the same time: fold 48 → 60, collision → one note (Megalovania-style octave pair)
    const song = parseSong(smf([[on(0, 48), on(0, 60), off(PPQ / 2, 48), off(PPQ, 60), end(PPQ)]]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }], window: { low: 60, high: 84 } });
    expect(chart.notes).toHaveLength(1);
    expect(chart.notes[0]!.pitch).toBe(60);
    expect(chart.notes[0]!.duration).toBeCloseTo(0.5, 6); // the longer of the two
    expect(chart.droppedCount).toBe(1);
  });

  it('keeps ticks and orders backing events off-before-on at equal times', () => {
    const song = parseSong(smf([
      [...seq([60], 0), end(PPQ)],
      [on(0, 48, 1), off(PPQ / 2, 48, 1), on(PPQ / 2, 50, 1), off(PPQ, 50, 1), end(PPQ)],
    ]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });
    expect(chart.notes[0]!.tick).toBe(0);
    const at = chart.backing.filter((e) => Math.abs(e.time - 0.25) < 1e-9).map((e) => e.type);
    expect(at).toEqual(['off', 'on']);
    expect(chart.duration).toBeCloseTo(0.5 + 2, 6);
  });
});
