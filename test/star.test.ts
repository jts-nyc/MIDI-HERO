import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG, Judge, STAR_FULL_BEATS, STAR_GAIN, STAR_MIN } from '../src/game/judge.ts';
import { PlaySession } from '../src/game/session.ts';
import { beatAt, buildChart, type Chart } from '../src/midi/chart.ts';
import { BeatGrid } from '../src/midi/difficulty.ts';
import { parseSong } from '../src/midi/parse.ts';
import { markPhrases, phraseSpans, starEvery } from '../src/midi/phrases.ts';
import { end, off, on, smf, tempo, timeSig, type AbsEvent } from './helpers/smf.ts';

const PPQ = 480;
const PART = [{ track: 0, channel: 0 }];
/** Notes as [beat, pitch, beats long]. */
type N = [number, number, number?];

function songOf(notes: N[], bpm = 120, extra: AbsEvent[] = []) {
  const evs = notes.flatMap(([b, p, len = 1]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
  const last = Math.max(...notes.map(([b, , len = 1]) => b + len));
  return parseSong(smf([[tempo(0, bpm), ...extra, ...evs, end(Math.round(last * PPQ) + PPQ)]]));
}
const chartOf = (notes: N[], bpm = 120): Chart => buildChart(songOf(notes, bpm), { parts: PART });
/** Start beats of the phrases of a part. */
function starts(notes: N[], extra: AbsEvent[] = []): number[] {
  const song = songOf(notes, 120, extra);
  return phraseSpans(song.notes, new BeatGrid(song)).map((s) => s.startTick / PPQ);
}
/** `count` phrases of four quarter notes, each followed by a bar of rest. */
const phrasesOf = (count: number): N[] => Array.from({ length: count }, (_, p) => [0, 1, 2, 3].map((i): N => [p * 8 + i, 60 + i])).flat();

describe('phrase splitting', () => {
  it('a rest of a beat or more starts a new phrase', () => {
    expect(starts([[0, 60], [1, 62], [2, 64], [4, 65], [5, 67], [6.5, 69, 0.5], [7, 71], [9, 72]])).toEqual([0, 4, 9]);
  });

  it('shorter rests and overlapping notes do not', () => {
    expect(starts([[0, 60, 0.5], [1, 62, 0.25], [2, 64, 0.1], [2.9, 65], [3, 40, 4], [5, 67]])).toEqual([0]);
  });

  it('a part without rests is cut into two-bar windows', () => {
    const notes: N[] = Array.from({ length: 32 }, (_, i) => [i, 60 + (i % 5)]);
    expect(starts(notes)).toEqual([0, 8, 16, 24]);
  });

  it('a long run is cut on the bar lines, wherever it starts; runs up to four bars stay whole', () => {
    const run = (from: number, beats: number): N[] => Array.from({ length: beats }, (_, i) => [from + i, 60 + (i % 5)]);
    expect(starts([...run(0, 16), ...run(18, 3)])).toEqual([0, 18]);
    expect(starts([...run(2, 22)])).toEqual([2, 8, 16]);
    expect(starts(run(0, 24), [timeSig(0, 3, 4)])).toEqual([0, 6, 12, 18]);
  });

  it('gives the chart notes a phrase and keeps phrase bounds', () => {
    const chart = chartOf(phrasesOf(3));
    expect(chart.notes.map((n) => n.phrase)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    expect(chart.phrases.map((p) => [p.first, p.last, p.start, p.end])).toEqual([[0, 3, 0, 1.5], [4, 7, 4, 5.5], [8, 11, 8, 9.5]]);
  });

  it('phrases with fewer than three notes join their neighbour', () => {
    const notes = [[0, 60], [1, 62], [4, 64], [8, 65], [9, 67], [10, 69], [11, 71], [14, 72]].map(([b, p], id) => ({ id, tick: b! * PPQ, time: b! / 2, pitch: p! }));
    const spans = [0, 4, 8, 14].map((b, i, a) => ({ startTick: b * PPQ, endTick: (a[i + 1] ?? Infinity) * PPQ }));
    const phrases = markPhrases(notes, spans);
    expect(phrases.map((p) => [p.first, p.last])).toEqual([[0, 2], [3, 7]]);
  });

  it('every 4th phrase is a star phrase; short songs get them more often', () => {
    expect([1, 4, 8, 9, 15, 16, 40].map(starEvery)).toEqual([2, 2, 2, 3, 3, 4, 4]);
    const long = chartOf(phrasesOf(16));
    expect(long.phrases.map((p, i) => (p.star ? i : -1)).filter((i) => i >= 0)).toEqual([3, 7, 11, 15]);
    expect(long.notes.filter((n) => n.star).map((n) => n.phrase)).toEqual([3, 3, 3, 3, 7, 7, 7, 7, 11, 11, 11, 11, 15, 15, 15, 15]);
    const short = chartOf(phrasesOf(4));
    expect(short.phrases.map((p) => p.star)).toEqual([false, true, false, true]);
  });

  it('phrases come from the full part, so an easy chart keeps the same phrases', () => {
    const notes: N[] = Array.from({ length: 64 }, (_, i) => [i / 2, 60 + (i % 7), 0.5]);
    const song = songOf(notes);
    const easy = buildChart(song, { parts: PART, difficulty: 'easy' });
    const full = buildChart(song, { parts: PART });
    expect(easy.phrases.map((p) => p.start)).toEqual(full.phrases.map((p) => p.start));
    expect(easy.phrases.length).toBe(4);
    expect(easy.notes.length).toBeLessThan(full.notes.length);
  });
});

describe('beatAt', () => {
  it('maps song time to beats through tempo changes', () => {
    const song = parseSong(smf([[tempo(0, 120), tempo(4 * PPQ, 60), on(0, 60), off(8 * PPQ, 60), end(8 * PPQ)]]));
    const chart = buildChart(song, { parts: PART });
    expect(chart.beats.slice(0, 7)).toEqual([0, 0.5, 1, 1.5, 2, 3, 4]);
    expect(beatAt(chart.beats, 1.25)).toBeCloseTo(2.5, 9);
    expect(beatAt(chart.beats, 2.5)).toBeCloseTo(4.5, 9);
    expect(beatAt(chart.beats, -1)).toBeCloseTo(-2, 9);
  });
});

describe('star gauge', () => {
  // 4 phrases of 4 notes at 120 BPM: phrase p starts at 4p seconds; phrases 1 and 3 are star phrases
  const chart = () => chartOf(phrasesOf(4));
  const timeOf = (p: number, i: number) => p * 4 + i * 0.5;
  const playPhrase = (j: Judge, p: number, skip = -1) => {
    for (let i = 0; i < 4; i++) {
      if (i === skip) continue;
      j.advance(timeOf(p, i));
      j.noteOn(60 + i, timeOf(p, i));
    }
  };
  const types = (j: Judge) => j.takeEvents().map((e) => e.type).filter((t) => t.startsWith('star'));

  it('a clean star phrase adds 25%', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    playPhrase(j, 0);
    expect(j.starGauge).toBe(0); // not a star phrase
    playPhrase(j, 1);
    expect(j.starGauge).toBe(STAR_GAIN);
    expect(types(j)).toEqual(['star']);
    expect(j.starReady).toBe(false);
  });

  it('a missed note spoils the phrase', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    playPhrase(j, 1, 2);
    j.advance(8);
    expect(j.starGauge).toBe(0);
    expect(types(j)).toEqual(['starLost']);
  });

  it('a wrong note inside the phrase spoils it; one outside does not', () => {
    const inside = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    inside.noteOn(60, timeOf(1, 0));
    inside.noteOn(70, timeOf(1, 0) + 0.25);
    for (let i = 1; i < 4; i++) inside.noteOn(60 + i, timeOf(1, i));
    expect(inside.starGauge).toBe(0);
    const outside = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    outside.noteOn(70, 3); // in the rest before the phrase
    playPhrase(outside, 1);
    outside.noteOn(70, 6.5); // after its last note
    expect(outside.starGauge).toBe(STAR_GAIN);
  });

  it('a late hit is not clean', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    j.noteOn(60, timeOf(1, 0) + 0.13);
    for (let i = 1; i < 4; i++) j.noteOn(60 + i, timeOf(1, i));
    expect(j.counts.late).toBe(1);
    expect(j.starGauge).toBe(0);
  });

  it('never goes above 100%', () => {
    const j = new Judge(chartOf(phrasesOf(12)), DEFAULT_JUDGE_CONFIG); // every 3rd phrase is a star phrase
    for (let p = 0; p < 12; p++) playPhrase(j, p);
    expect(j.chart.phrases.filter((p) => p.star)).toHaveLength(4);
    expect(j.starGauge).toBe(1);
    const more = new Judge(chartOf(phrasesOf(8)), DEFAULT_JUDGE_CONFIG);
    more.starGauge = 0.9;
    playPhrase(more, 1);
    expect(more.starGauge).toBe(1);
  });
});

describe('star power', () => {
  const chart = () => chartOf(phrasesOf(8));

  it('cannot be switched on below 50%', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    j.starGauge = STAR_MIN - 0.01;
    expect(j.activateStar(1)).toBe(false);
    expect(j.starActive).toBe(false);
    j.starGauge = STAR_MIN;
    expect(j.starReady).toBe(true);
    expect(j.activateStar(1)).toBe(true);
    expect(j.starActive).toBe(true);
    expect(j.activateStar(1.1)).toBe(false); // already on
    expect(j.takeEvents().map((e) => e.type)).toEqual(['starOn']);
  });

  it('50% drains over 16 beats, a full gauge over 32', () => {
    const j = new Judge(chartOf([[0, 60], [200, 62]]), DEFAULT_JUDGE_CONFIG); // 120 BPM: a beat is 0.5 s
    j.starGauge = 0.5;
    j.activateStar(10);
    j.advance(12); // 4 beats later
    expect(j.starGauge).toBeCloseTo(0.5 - 4 / STAR_FULL_BEATS, 9);
    j.advance(17.9);
    expect(j.starActive).toBe(true);
    j.advance(18);
    expect(j.starActive).toBe(false);
    expect(j.starGauge).toBe(0);
    expect(j.takeEvents().map((e) => e.type)).toContain('starOff');
    j.starGauge = 1;
    j.activateStar(20);
    j.advance(35.9);
    expect(j.starActive).toBe(true);
    j.advance(36.01);
    expect(j.starActive).toBe(false);
  });

  it('drains by beats, so a slower tempo lasts longer in seconds', () => {
    const j = new Judge(chartOf([[0, 60], [200, 62]], 60), DEFAULT_JUDGE_CONFIG);
    j.starGauge = 0.5;
    j.activateStar(10);
    j.advance(25.9);
    expect(j.starActive).toBe(true);
    j.advance(26.01);
    expect(j.starActive).toBe(false);
  });

  it('doubles the multiplier while it is on', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    j.noteOn(60, 0);
    expect(j.score).toBe(100);
    j.starGauge = 0.5;
    j.activateStar(0.2);
    expect(j.scoreMultiplier).toBe(2);
    j.noteOn(61, 0.5);
    expect(j.score).toBe(300);
    j.advance(9); // 16 beats on: over
    j.noteOn(60, 8); // phrase 2, first note... already missed by advance
    expect(j.scoreMultiplier).toBe(1);
  });

  it('a clean star phrase while it is on extends it', () => {
    const j = new Judge(chart(), DEFAULT_JUDGE_CONFIG);
    j.starGauge = 0.5;
    j.activateStar(3.9);
    for (let i = 0; i < 4; i++) {
      j.advance(4 + i * 0.5);
      j.noteOn(60 + i, 4 + i * 0.5); // phrase 1: a star phrase
    }
    expect(j.chart.phrases[1]!.star).toBe(true);
    expect(j.starGauge).toBeCloseTo(0.5 - 3.2 / STAR_FULL_BEATS + STAR_GAIN, 9);
    expect(j.starActive).toBe(true);
  });
});

describe('PlaySession: star power', () => {
  function harness(autoplay = false) {
    const chart = chartOf(phrasesOf(8));
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: autoplay ? { jitterMs: 0 } : null, hint: '',
    });
    const goTo = (songTime: number) => {
      t.perfMs += (songTime - session.now()) * 1000;
      session.update();
    };
    const pedal = (value: number) => session.handleInput({ type: 'pedal', pitch: -1, velocity: value, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const playPhrase = (p: number, skip = -1) => {
      for (let i = 0; i < 4; i++) {
        goTo(p * 4 + i * 0.5);
        if (i !== skip) session.handleInput({ type: 'on', pitch: 60 + i, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
      }
    };
    return { session, goTo, pedal, playPhrase, fx: session.fx };
  }

  it('the sustain pedal switches it on once the gauge is half full', () => {
    const { session, goTo, pedal, playPhrase, fx } = harness();
    playPhrase(1);
    goTo(6);
    pedal(127);
    expect(session.judge.starActive).toBe(false);
    expect(fx.meters).toMatchObject({ starGauge: 0.25, starReady: false, starActive: false });
    playPhrase(3);
    goTo(14);
    expect(fx.meters).toMatchObject({ starGauge: 0.5, starReady: true });
    pedal(40); // half-pressed: below 64
    expect(session.judge.starActive).toBe(false);
    pedal(64);
    goTo(14.1);
    expect(fx.meters.starActive).toBe(true);
    expect(fx.callouts.filter((c) => c.active).map((c) => c.text)).toContain('STAR POWER!');
    pedal(0);
    goTo(15);
    expect(session.judge.starActive).toBe(true); // lifting the pedal does not switch it off
    goTo(22.2);
    expect(fx.meters).toMatchObject({ starActive: false, starGauge: 0 });
  });

  it('activateStar is what Space calls; it does nothing while paused', () => {
    const { session, goTo } = harness();
    session.judge.starGauge = 0.75;
    goTo(1);
    session.pause();
    expect(session.activateStar()).toBe(false);
    session.resume();
    expect(session.activateStar()).toBe(true);
  });

  it('a spoiled star phrase loses its gold', () => {
    const { session, playPhrase, goTo } = harness();
    expect(session.chart.notes.filter((n) => n.star)).toHaveLength(16);
    playPhrase(1, 1);
    goTo(8);
    expect(session.chart.notes.filter((n) => n.phrase === 1).map((n) => n.star)).toEqual([false, false, false, false]);
    expect(session.chart.notes.filter((n) => n.star)).toHaveLength(12);
  });

  it('autoplay uses star power as soon as it can', () => {
    const { session, goTo } = harness(true);
    for (let t = -3; t < 40 && session.status === 'playing'; t += 1 / 60) goTo(t);
    expect(session.result().accuracy).toBe(1);
    // 32 notes: 100 points each, 2x from the 10th, 3x from the 30th, doubled while star power is on
    expect(session.result().score).toBeGreaterThan(9 * 100 + 20 * 200 + 3 * 300);
  });
});
