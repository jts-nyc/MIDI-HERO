import { describe, expect, it } from 'vitest';
import { DEFAULT_JUDGE_CONFIG, Judge, comboMultiplier, type JudgeConfig } from '../src/game/judge.ts';
import { buildChart, type Chart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480; // at 120 BPM one beat = 0.5 s, so tick = seconds * 960

const secs = (s: number) => Math.round(s * 2 * PPQ);

/** Chart from [time, pitch] pairs (quarter-second notes). */
function chart(notes: [number, number][]): Chart {
  const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t) + PPQ / 2, p)]);
  const song = parseSong(smf([[tempo(0, 120), ...evs, end(secs(notes[notes.length - 1]![0]) + PPQ)]]));
  return buildChart(song, { parts: [{ track: 0, channel: 0 }] });
}

const cfg = (over: Partial<JudgeConfig> = {}): JudgeConfig => ({ ...DEFAULT_JUDGE_CONFIG, ...over });

describe('timing tiers', () => {
  const cases: [number, string][] = [
    [0, 'perfect'], [0.034, 'perfect'], [-0.034, 'perfect'],
    [0.036, 'great'], [0.069, 'great'],
    [0.071, 'good'], [0.119, 'good'],
    [0.121, 'late'], [0.149, 'late'], [-0.149, 'late'],
  ];
  for (const [delta, expected] of cases) {
    it(`hit at ${delta * 1000} ms is ${expected}`, () => {
      const j = new Judge(chart([[1, 60]]), cfg());
      const r = j.noteOn(60, 1 + delta);
      expect(r.kind).toBe('hit');
      if (r.kind === 'hit') expect(r.judgment).toBe(expected);
    });
  }

  it('a hit beyond 150 ms matches nothing and counts as a wrong note', () => {
    const j = new Judge(chart([[1, 60]]), cfg());
    expect(j.noteOn(60, 1.151).kind).toBe('wrong');
    expect(j.counts.wrong).toBe(1);
    expect(j.states[0]).toBe('pending');
  });
});

describe('note selection', () => {
  it('clamps windows to half the gap between same-pitch notes and picks the nearest', () => {
    const j = new Judge(chart([[1, 60], [1.1, 60]]), cfg());
    expect(j.windows[0]).toBeCloseTo(0.05, 9);
    expect(j.windows[1]).toBeCloseTo(0.05, 9);
    const r = j.noteOn(60, 1.06);
    expect(r).toMatchObject({ kind: 'hit', noteId: 1 });
    const r2 = j.noteOn(60, 1.04);
    expect(r2).toMatchObject({ kind: 'hit', noteId: 0 });
  });

  it('judges each note of a chord independently', () => {
    const j = new Judge(chart([[1, 60], [1, 64], [1, 67]]), cfg());
    expect(j.noteOn(64, 1.01).kind).toBe('hit');
    expect(j.noteOn(60, 1.02).kind).toBe('hit');
    expect(j.noteOn(67, 1.03).kind).toBe('hit');
    expect(j.combo).toBe(3);
    expect(j.noteOn(60, 1.04).kind).toBe('wrong');
  });

  it('easy mode matches any octave', () => {
    const j = new Judge(chart([[1, 60]]), cfg({ easy: true }));
    expect(j.noteOn(72, 1).kind).toBe('hit');
  });
});

describe('scoring', () => {
  it('scores tiers with the combo multiplier and tracks accuracy', () => {
    const notes: [number, number][] = Array.from({ length: 12 }, (_, i) => [1 + i, 60 + (i % 3)]);
    const j = new Judge(chart(notes), cfg());
    for (let i = 0; i < 9; i++) j.noteOn(60 + (i % 3), 1 + i);
    expect(j.combo).toBe(9);
    expect(j.score).toBe(900);
    j.noteOn(60 + (9 % 3), 10); // 10th perfect: combo 10 → 2x
    expect(comboMultiplier(10)).toBe(2);
    expect(j.score).toBe(1100);
    expect(j.accuracy).toBe(1);
    j.advance(20); // remaining two missed
    expect(j.counts.miss).toBe(2);
    expect(j.combo).toBe(0);
    expect(j.maxCombo).toBe(10);
    expect(j.accuracy).toBeCloseTo(10 / 12, 9);
    expect(j.finished).toBe(true);
  });

  it('a wrong note resets the combo but not the score by default', () => {
    const j = new Judge(chart([[1, 60], [2, 60]]), cfg());
    j.noteOn(60, 1);
    j.noteOn(65, 1.5);
    expect(j.combo).toBe(0);
    expect(j.score).toBe(100);
  });

  it('wrongNotePenalty none keeps the combo, score subtracts points', () => {
    const none = new Judge(chart([[1, 60], [2, 60]]), cfg({ wrongNotePenalty: 'none' }));
    none.noteOn(60, 1);
    none.noteOn(65, 1.5);
    expect(none.combo).toBe(1);
    const score = new Judge(chart([[1, 60], [2, 60]]), cfg({ wrongNotePenalty: 'score' }));
    score.noteOn(60, 1);
    score.noteOn(65, 1.5);
    expect(score.score).toBe(80);
  });

  it('a late hit consumes the note and resets the combo without counting as wrong', () => {
    const j = new Judge(chart([[1, 60], [2, 60]]), cfg());
    j.noteOn(60, 1);
    j.noteOn(60, 2.13);
    expect(j.counts.late).toBe(1);
    expect(j.counts.wrong).toBe(0);
    expect(j.combo).toBe(0);
    expect(j.states[1]).toBe('hit');
  });

  it('advance marks only notes whose window has passed', () => {
    const j = new Judge(chart([[1, 60], [2, 60]]), cfg());
    j.advance(1.1);
    expect(j.states[0]).toBe('pending');
    j.advance(1.16);
    expect(j.states[0]).toBe('missed');
    expect(j.states[1]).toBe('pending');
    expect(j.takeEvents().map((e) => e.type)).toEqual(['miss']);
  });
});

describe('presets and rate', () => {
  it('relaxed widens tiers but never past the half-gap clamp', () => {
    const wide = new Judge(chart([[1, 60]]), cfg({ preset: 'relaxed' }));
    const r = wide.noteOn(60, 1.05);
    expect(r).toMatchObject({ kind: 'hit', judgment: 'perfect' });
    const tight = new Judge(chart([[1, 60], [1.1, 60]]), cfg({ preset: 'relaxed' }));
    expect(tight.windows[0]).toBeCloseTo(0.05, 9);
    expect(tight.noteOn(60, 1.06)).toMatchObject({ kind: 'hit', noteId: 1 });
  });

  it('shrinks windows in song time at slower rates so they stay constant in real time', () => {
    const j = new Judge(chart([[1, 60]]), cfg(), 0.5);
    expect(j.noteOn(60, 1.03)).toMatchObject({ judgment: 'great' });
  });
});

describe('autoplay replay', () => {
  it('scores 100% when every note is played exactly on time', () => {
    const notes: [number, number][] = Array.from({ length: 30 }, (_, i) => [1 + i * 0.25, 60 + (i % 5)]);
    const c = chart(notes);
    const j = new Judge(c, cfg());
    for (const n of c.notes) {
      j.advance(n.time);
      j.noteOn(n.pitch, n.time);
    }
    j.finish();
    expect(j.accuracy).toBe(1);
    expect(j.maxCombo).toBe(30);
    expect(j.counts.perfect).toBe(30);
  });
});
