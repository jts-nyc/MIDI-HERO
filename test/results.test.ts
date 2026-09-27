import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG, type Judgment } from '../src/game/judge.ts';
import { bestDelta, buildSections, sectionResults, starCount, suggestNextStep, type SectionResult, type SuggestionInput } from '../src/game/results.ts';
import { PlaySession } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { beatLines, parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

describe('suggestNextStep', () => {
  const cases: [string, SuggestionInput, { kind: string; text: string; difficulty?: string; rate?: number }][] = [
    ['90% on Easy: move up to Medium', { accuracy: 0.9, difficulty: 'easy', rate: 1 }, { kind: 'harder', text: 'Try Medium', difficulty: 'medium' }],
    ['97% on Medium: Hard', { accuracy: 0.97, difficulty: 'medium', rate: 1 }, { kind: 'harder', text: 'Try Hard', difficulty: 'hard' }],
    ['95% on Hard: Expert', { accuracy: 0.95, difficulty: 'hard', rate: 1 }, { kind: 'harder', text: 'Try Expert', difficulty: 'expert' }],
    ['95% on Expert at full speed: mastered', { accuracy: 0.95, difficulty: 'expert', rate: 1 }, { kind: 'mastered', text: 'Mastered! Pick a new song' }],
    ['90% at 80% speed: speed up before moving up', { accuracy: 0.92, difficulty: 'easy', rate: 0.8 }, { kind: 'faster', text: 'Try 90% speed', rate: 0.9 }],
    ['90% at 90% speed: full speed', { accuracy: 0.92, difficulty: 'easy', rate: 0.9 }, { kind: 'faster', text: 'Try full speed', rate: 1 }],
    ['below 70% at full speed: slow down', { accuracy: 0.69, difficulty: 'easy', rate: 1 }, { kind: 'slower', text: 'Try 90% speed', rate: 0.9 }],
    ['below 70% at 90%: slower still', { accuracy: 0.4, difficulty: 'medium', rate: 0.9 }, { kind: 'slower', text: 'Try 80% speed', rate: 0.8 }],
    ['below 70% at the slowest speed: an easier level', { accuracy: 0.4, difficulty: 'medium', rate: 0.5 }, { kind: 'easier', text: 'Try Easy', difficulty: 'easy' }],
    ['below 70% on Easy at the slowest speed: nothing left to lower', { accuracy: 0.4, difficulty: 'easy', rate: 0.5 }, { kind: 'again', text: 'Play it again: watch the keys light up as the notes land' }],
    ['a failed song slows down even with good accuracy so far', { accuracy: 0.93, difficulty: 'hard', rate: 1, failed: true }, { kind: 'slower', text: 'Try 90% speed', rate: 0.9 }],
    ['70% to 90%: play it again', { accuracy: 0.8, difficulty: 'easy', rate: 1 }, { kind: 'again', text: 'Play it again: 90% unlocks the next step' }],
    ['exactly 70% is not "below 70%"', { accuracy: 0.7, difficulty: 'easy', rate: 1 }, { kind: 'again', text: 'Play it again: 90% unlocks the next step' }],
    ['89.9% does not move up', { accuracy: 0.899, difficulty: 'easy', rate: 1 }, { kind: 'again', text: 'Play it again: 90% unlocks the next step' }],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(suggestNextStep(input)).toEqual(expected);
    });
  }

  it('names the weakest section when one stands out', () => {
    const section = (fromBar: number, accuracy: number): SectionResult => ({ fromBar, toBar: fromBar + 7, start: 0, end: 1, label: `Bars ${fromBar}–${fromBar + 7}`, total: 10, hit: 8, accuracy });
    expect(suggestNextStep({ accuracy: 0.8, difficulty: 'easy', rate: 1, sections: [section(1, 0.95), section(9, 0.6), section(17, 0.85)] }))
      .toEqual({ kind: 'section', text: 'Play it again: work on bars 9–16' });
    expect(suggestNextStep({ accuracy: 0.8, difficulty: 'easy', rate: 1, sections: [section(1, 0.82), section(9, 0.78)] }).kind).toBe('again');
  });

  it('always gives exactly one suggestion with a text', () => {
    for (const difficulty of ['easy', 'medium', 'hard', 'expert'] as const) {
      for (const rate of [0.5, 0.75, 1]) {
        for (let a = 0; a <= 1; a += 0.05) expect(suggestNextStep({ accuracy: a, difficulty, rate }).text.length).toBeGreaterThan(5);
      }
    }
  });
});

describe('sections', () => {
  const bars = Array.from({ length: 20 }, (_, i) => i * 2); // 2-second bars, 40 s

  it('cuts the song into 8-bar windows', () => {
    expect(buildSections(bars, 42).map((s) => [s.fromBar, s.toBar, s.start, s.end])).toEqual([[1, 8, 0, 16], [9, 16, 16, 32], [17, 20, 32, 42]]);
    expect(buildSections([], 10)).toEqual([{ fromBar: 1, toBar: 1, start: 0, end: 10 }]);
    expect(buildSections(bars, 10).map((s) => s.fromBar)).toEqual([1]);
  });

  it('weighs accuracy per section and skips sections without notes', () => {
    const notes = [1, 5, 9, 15.9, 33, 34, 41].map((time) => ({ time }));
    const judgments: (Judgment | null)[] = ['perfect', 'great', 'miss', 'good', 'perfect', 'late', null];
    const r = sectionResults(buildSections(bars, 42), notes, judgments);
    expect(r.map((s) => [s.label, s.total, s.hit])).toEqual([['Bars 1–8', 4, 3], ['Bars 17–20', 2, 1]]);
    expect(r[0]!.accuracy).toBeCloseTo((1 + 0.7 + 0 + 0.4) / 4, 9);
    expect(r[1]!.accuracy).toBeCloseTo(0.5, 9);
  });

  it('a session reports sections along the bar lines of the song', () => {
    const PPQ = 480;
    // 32 bars of 4/4 at 120 BPM (2 s each), one note per bar on beat 2
    const evs = Array.from({ length: 32 }, (_, i) => [on(i * 4 * PPQ + PPQ, 60 + (i % 3)), off(i * 4 * PPQ + 2 * PPQ, 60 + (i % 3))]).flat();
    const song = parseSong(smf([[tempo(0, 120), ...evs, end(32 * 4 * PPQ)]]));
    const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: null, hint: '',
      barTimes: beatLines(song, chart.duration).filter((l) => l.isBar).map((l) => l.time),
    });
    // play the first 8 bars perfectly, then stop playing
    for (let i = 0; i < 8; i++) {
      t.perfMs += (i * 2 + 0.5 - session.now()) * 1000;
      session.update();
      session.handleInput({ type: 'on', pitch: 60 + (i % 3), velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    }
    t.perfMs += 100_000;
    session.update();
    const r = session.result();
    expect(r.sections.map((s) => [s.label, s.total, s.accuracy])).toEqual([['Bars 1–8', 8, 1], ['Bars 9–16', 8, 0], ['Bars 17–24', 8, 0], ['Bars 25–32', 8, 0]]);
    expect(r.accuracy).toBe(0.25);
    expect(suggestNextStep({ accuracy: r.accuracy, difficulty: 'easy', rate: 1, sections: r.sections }).text).toBe('Try 90% speed');
  });
});

describe('stars and best delta', () => {
  it('gives 0 to 5 stars', () => {
    expect([0, 0.2, 0.5, 0.7, 0.85, 0.95, 1].map(starCount)).toEqual([0, 1, 2, 3, 4, 5, 5]);
  });

  it('compares with the previous best', () => {
    expect(bestDelta(0.86, 0.82)).toBe('+4.0%');
    expect(bestDelta(0.795, 0.82)).toBe('−2.5%');
    expect(bestDelta(0.82, 0.82)).toBe('±0.0%');
    expect(bestDelta(0.82, null)).toBeNull();
    expect(bestDelta(0.82, undefined)).toBeNull();
  });
});
