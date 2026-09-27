import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import {
  endPass, isCleanPass, loopLabel, loopOf, nextHold, owedPitches, practiceSections, rateIndexOf, runRate, startRun, trimChart,
} from '../src/game/practice.ts';
import { RATES } from '../src/game/results.ts';
import { PlaySession, type PracticeOptions, type SessionOptions } from '../src/game/session.ts';
import { buildChart, type Chart } from '../src/midi/chart.ts';
import { beatLines, parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
/** ticks of a time in seconds at 120 BPM */
const secs = (s: number) => Math.round(s * 2 * PPQ);

/** A 4/4 song at 120 BPM (2 s bars) with notes as [time, pitch, seconds?]. */
function makeSong(notes: [number, number, number?][], lengthSeconds: number) {
  const evs = notes.flatMap(([t, p, d = 0.25]) => [on(secs(t), p), off(secs(t + d), p)]);
  return parseSong(smf([[tempo(0, 120), ...evs, end(secs(lengthSeconds))]]));
}

/** 24 bars, one note a beat, so three 8-bar sections of 32 notes each; a chord on beat 1 of bar 9. */
const NOTES: [number, number, number?][] = Array.from({ length: 96 }, (_, i) => [i * 0.5, 60 + (i % 5)] as [number, number]);
NOTES.push([16, 64], [16, 67]);
NOTES.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const song = makeSong(NOTES, 48);
const fullChart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });
const barTimes = beatLines(song, fullChart.duration).filter((l) => l.isBar).map((l) => l.time);
const sections = practiceSections(barTimes, fullChart.duration, fullChart.notes);

describe('practice sections and loops', () => {
  it('cuts the song into labelled 8-bar sections with their note counts', () => {
    expect(sections.map((s) => [s.label, s.start, s.end, s.notes])).toEqual([
      ['Bars 1–8', 0, 16, 32],
      ['Bars 9–16', 16, 32, 34],
      ['Bars 17–24', 32, 48, 32],
    ]);
    expect(sections[1]!.notesPerSec).toBeCloseTo(34 / 16, 9);
  });

  it('loops one section or a run of adjacent ones, in either order', () => {
    expect(loopOf(sections, 1, 1)).toEqual({ start: 16, end: 32 });
    expect(loopOf(sections, 2, 0)).toEqual({ start: 0, end: 48 });
    expect(loopLabel(sections, 1, 1)).toBe('Bars 9–16');
    expect(loopLabel(sections, 0, 1)).toBe('Bars 1–16');
  });

  it('trims the chart to the loop, re-indexing notes and cutting phrases to fit', () => {
    const loop = loopOf(sections, 1, 1);
    const trimmed = trimChart(fullChart, loop);
    expect(trimmed.notes.length).toBe(34);
    expect(trimmed.notes.map((n) => n.id)).toEqual(trimmed.notes.map((_, i) => i));
    expect(trimmed.notes.every((n) => n.time >= 16 && n.time < 32)).toBe(true);
    expect(trimmed.firstNoteTime).toBe(16);
    for (const p of trimmed.phrases) {
      expect(p.first).toBeGreaterThanOrEqual(0);
      expect(p.last).toBeLessThan(trimmed.notes.length);
      expect(p.first).toBeLessThanOrEqual(p.last);
    }
    for (const n of trimmed.notes) if (n.phrase !== undefined) expect(trimmed.phrases[n.phrase]).toBeDefined();
    expect(trimmed.backing).toBe(fullChart.backing);
    expect(trimmed.duration).toBe(fullChart.duration);
    expect(trimChart(fullChart, { start: 100, end: 110 }).notes).toEqual([]);
  });
});

describe('speed ladder', () => {
  it('starts at the RATES entry at or below the rate', () => {
    expect(rateIndexOf(1)).toBe(RATES.length - 1);
    expect(rateIndexOf(0.85)).toBe(RATES.indexOf(0.8));
    expect(rateIndexOf(0.3)).toBe(0);
    expect(runRate(startRun(0.75, true))).toBe(0.75);
  });

  it('steps up after two clean passes and down after two failed ones, resetting the runs', () => {
    let run = startRun(0.8, true);
    run = endPass(run, true);
    expect([run.passes, run.cleanPasses, runRate(run)]).toEqual([1, 1, 0.8]);
    run = endPass(run, false); // a failed pass breaks the clean run
    run = endPass(run, true);
    expect(runRate(run)).toBe(0.8);
    run = endPass(run, true);
    expect([run.passes, run.cleanPasses, runRate(run)]).toEqual([4, 3, 0.9]);
    run = endPass(run, true);
    run = endPass(run, true);
    expect(runRate(run)).toBe(1);
    run = endPass(run, true);
    run = endPass(run, true);
    expect(runRate(run)).toBe(1); // the top
    run = endPass(run, false);
    run = endPass(run, false);
    expect(runRate(run)).toBe(0.9);
    expect(run.failedRun).toBe(0);
  });

  it('holds the rate when the ladder is off', () => {
    let run = startRun(0.7, false);
    for (let i = 0; i < 5; i++) run = endPass(run, true);
    expect([run.passes, run.cleanPasses, runRate(run)]).toEqual([5, 5, 0.7]);
  });

  it('a clean pass has no miss, no late and no wrong note', () => {
    const c = { perfect: 3, great: 2, good: 1, late: 0, miss: 0, wrong: 0, overheld: 1 };
    expect(isCleanPass(c)).toBe(true);
    expect(isCleanPass({ ...c, late: 1 })).toBe(false);
    expect(isCleanPass({ ...c, wrong: 1 })).toBe(false);
    expect(isCleanPass({ ...c, miss: 1 })).toBe(false);
    expect(isCleanPass({ ...c, late: 1 }, true)).toBe(true); // wait mode: hit or wrong only
    expect(isCleanPass({ ...c, wrong: 1 }, true)).toBe(false);
  });
});

describe('wait gate', () => {
  const notes = [{ time: 1, pitch: 60 }, { time: 2, pitch: 64 }, { time: 2, pitch: 67 }, { time: 3, pitch: 62 }];

  it('finds the first pending note that has reached the hit line', () => {
    const states = ['hit', 'pending', 'pending', 'pending'] as const;
    expect(nextHold(notes, states, 1.5)).toBe(-1);
    expect(nextHold(notes, states, 2)).toBe(1);
    expect(nextHold(notes, ['hit', 'hit', 'hit', 'pending'], 2.5)).toBe(-1);
    expect(nextHold(notes, ['hit', 'hit', 'hit', 'pending'], 3.01)).toBe(3);
  });

  it('owes the pending pitches of the onset only', () => {
    expect(owedPitches(notes, ['hit', 'pending', 'pending', 'pending'], 2)).toEqual([64, 67]);
    expect(owedPitches(notes, ['hit', 'hit', 'pending', 'pending'], 2)).toEqual([67]);
    expect(owedPitches(notes, ['hit', 'hit', 'hit', 'pending'], 2)).toEqual([]);
    const out = [1, 2, 3];
    expect(owedPitches(notes, ['pending', 'pending', 'pending', 'pending'], 1, out)).toBe(out);
    expect(out).toEqual([60]);
  });
});

// ---------------------------------------------------------------------------
// The session in practice mode
// ---------------------------------------------------------------------------
function harness(over: Partial<SessionOptions> = {}, practiceOver: Partial<PracticeOptions> = {}, from = 1, to = 1) {
  const loop = loopOf(sections, from, to);
  const chart: Chart = trimChart(fullChart, loop);
  const t = { perfMs: 10_000 };
  const clock = new GameClock(() => t.perfMs);
  const synth = new RecordingSynth();
  const clicks: { accent: boolean; when: number }[] = [];
  const practice: PracticeOptions = { loop, sections, current: from, label: loopLabel(sections, from, to), wait: false, ladder: true, ...practiceOver };
  const session = new PlaySession({
    chart, clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
    visibleSeconds: 1, barSeconds: 2, countInBeats: 4, autoplay: null, hint: '', barTimes, practice,
    click: (accent, when) => clicks.push({ accent, when }),
    ...over,
  });
  const passes: number[] = [];
  session.onPass = (run) => passes.push(run.passes);
  /** advance in 16 ms frames */
  const advance = (sec: number) => {
    const until = t.perfMs + sec * 1000;
    while (t.perfMs < until) {
      t.perfMs = Math.min(until, t.perfMs + 16);
      session.update();
    }
  };
  const goTo = (songTime: number) => advance((songTime - session.now()) / session.rate);
  const down = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const up = (pitch: number) => session.handleInput({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
  return { session, clock, synth, clicks, passes, advance, goTo, down, up, t, loop, chart };
}

describe('PlaySession in practice mode', () => {
  it('starts a bar before the loop, counts in, and fills the practice view', () => {
    const { session, clicks, loop, advance } = harness();
    expect(session.now()).toBeCloseTo(loop.start - 2, 9);
    expect(session.practice).toMatchObject({ current: 1, loop, passes: 0, waiting: false, waitingFor: [] });
    expect(session.practice!.sections.length).toBe(3);
    advance(2.1);
    expect(clicks.map((c) => c.accent)).toEqual([true, false, false, false]);
    expect(session.chart.notes.length).toBe(34); // the loop only: nothing before it can be missed
  });

  it('a normal play has no practice view', () => {
    const t = { perfMs: 0 };
    const s = new PlaySession({
      chart: fullChart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: null, hint: '',
    });
    expect(s.practice).toBeUndefined();
    expect(s.result().practice).toBeUndefined();
  });

  it('loops: after the loop end it re-seeks the one clock to the count-in and starts a fresh pass', () => {
    const { session, clock, clicks, passes, advance, loop } = harness();
    advance(2 + 16 + 0.5); // count-in, the section, and a little
    expect(passes).toEqual([1]);
    expect(session.practice!.passes).toBe(1);
    expect(session.status).toBe('playing');
    expect(clock.now()).toBeGreaterThanOrEqual(loop.start - 2);
    expect(clock.now()).toBeLessThan(loop.start);
    expect(session.judge.judged).toBe(0); // a fresh judge
    expect(session.noteVisuals.every((v) => v.state === 'pending')).toBe(true);
    expect(session.result().practice).toMatchObject({ passes: 1, cleanPasses: 0, rate: 1, label: 'Bars 9–16' });
    advance(2.1);
    expect(clicks.length).toBe(8); // counted in again
  });

  it('autoplay passes are clean, and two of them step the rate up the ladder', () => {
    const { session, clock, passes, advance } = harness({ rate: 0.8, autoplay: { jitterMs: 0 } });
    expect(session.rate).toBe(0.8);
    advance(2 / 0.8 + 16 / 0.8 + 0.5); // one pass at 80%
    expect(passes).toEqual([1]);
    expect(session.rate).toBe(0.8);
    advance(2 / 0.8 + 16 / 0.8 + 0.5);
    expect(passes).toEqual([1, 2]);
    expect(session.rate).toBe(0.9);
    expect(clock.rate).toBe(0.9);
    expect(session.result().practice).toMatchObject({ passes: 2, cleanPasses: 2, rate: 0.9 });
  });

  it('failed passes step the rate down, and the ladder can be off', () => {
    const a = harness({ rate: 0.9 });
    a.advance((2 + 16 + 0.5) / 0.9);
    a.advance((2 + 16 + 0.5) / 0.9);
    expect(a.passes).toEqual([1, 2]);
    expect(a.session.rate).toBe(0.8);
    const b = harness({ rate: 0.9 }, { ladder: false });
    b.advance((2 + 16 + 0.5) / 0.9);
    b.advance((2 + 16 + 0.5) / 0.9);
    expect(b.passes).toEqual([1, 2]);
    expect(b.session.rate).toBe(0.9);
  });

  it('wait mode holds the clock at an unplayed note until every pitch of the onset is down', () => {
    const { session, clock, goTo, advance, down, up } = harness({}, { wait: true });
    goTo(16.05); // the chord at bar 9: 62, 64 and 67
    expect(session.practice!.waiting).toBe(true);
    expect(clock.playing).toBe(false);
    expect(session.now()).toBeCloseTo(16, 9);
    expect([...session.practice!.waitingFor].sort()).toEqual([62, 64, 67]);
    advance(3);
    expect(session.now()).toBeCloseTo(16, 9); // held
    expect(session.judge.counts.miss).toBe(0);
    down(64);
    expect([...session.practice!.waitingFor].sort()).toEqual([62, 67]);
    down(61); // a wrong note does not help
    expect(session.judge.counts.wrong).toBe(1);
    expect(session.practice!.waiting).toBe(true);
    down(62);
    down(67);
    expect(session.practice!.waiting).toBe(false);
    expect(clock.playing).toBe(true);
    expect(session.practice!.waitingFor).toEqual([]);
    expect(session.judge.counts.perfect).toBe(3); // no timing judgment at the held onset
    up(64); up(62); up(67); up(61);
    advance(0.3);
    expect(session.now()).toBeGreaterThan(16.2);
  });

  it('wait mode tells the band to stop while held and start again after, and shows no timing words', () => {
    const { session, goTo, down } = harness({}, { wait: true });
    const waits: boolean[] = [];
    session.onWait = (w) => waits.push(w);
    goTo(16.05);
    expect(waits).toEqual([true]);
    down(62); down(64); down(67);
    expect(waits).toEqual([true, false]);
    expect(session.popups.filter((p) => /Perfect|Great|Good/.test(p.text))).toEqual([]);
  });

  it('wait mode with the input offset holds where the player hears the note', () => {
    const { session, clock, goTo, down } = harness({ inputOffsetMs: 100 }, { wait: true });
    goTo(16.15);
    expect(session.practice!.waiting).toBe(true);
    expect(clock.now()).toBeCloseTo(16.1, 9); // clock time the judge sees as 16.0
    down(62); down(64); down(67);
    expect(session.judge.counts.perfect).toBe(3);
    expect(session.practice!.waiting).toBe(false);
  });

  it('a menu pause during a wait hold keeps the hold on resume', () => {
    const { session, clock, goTo, down, up, advance } = harness({}, { wait: true });
    goTo(16.05);
    session.pause();
    session.resume();
    expect(clock.playing).toBe(false);
    expect(session.practice!.waiting).toBe(true);
    down(62); down(64); down(67);
    up(62); up(64); up(67);
    expect(clock.playing).toBe(true);
    advance(0.1);
    expect(session.status).toBe('playing');
  });

  it('autoplay with jitter does not deadlock in wait mode', () => {
    const { session, passes, advance } = harness({ autoplay: { jitterMs: 40 } }, { wait: true });
    advance(2 + 16 + 1.5);
    expect(passes).toEqual([1]);
    expect(session.judge.judged).toBeLessThan(34);
  });

  it('a star phrase spoiled in one pass is gold again in the next', () => {
    const chart = trimChart(fullChart, loopOf(sections, 1, 1));
    for (const n of chart.notes.slice(0, 4)) n.star = true;
    const { session, advance, passes } = harness({ chart });
    for (const n of session.chart.notes) n.star = false; // as dimPhrase does
    advance(2 + 16 + 0.5);
    expect(passes).toEqual([1]);
    expect(session.chart.notes.map((n) => !!n.star).slice(0, 5)).toEqual([true, true, true, true, false]);
  });

  it('stopPractice ends the session, from a pause too, and reports the completed passes', () => {
    const { session, goTo, down, up, advance } = harness();
    let result: ReturnType<PlaySession['result']> | null = null;
    session.onFinished = (r) => (result = r);
    advance(2 + 16 + 0.5);
    goTo(16);
    down(60); up(60);
    session.pause();
    session.stopPractice();
    expect(session.status).toBe('finished');
    expect(result!.practice).toMatchObject({ passes: 1, cleanPasses: 0, rate: 1, wait: false });
  });
});
