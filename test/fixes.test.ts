// Regression tests for the round-1 review fixes (round 2).
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG, OVERHOLD_COST } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

/** Notes as [time, pitch, seconds] at 120 BPM. */
function makeChart(notes: [number, number, number?][], window: { low: number; high: number } | null = null) {
  const evs = notes.flatMap(([t, p, d = 0.25]) => [on(secs(t), p), off(secs(t + d), p)]);
  const song = parseSong(smf([[tempo(0, 120), ...evs, end(secs(notes.at(-1)![0]) + PPQ)]]));
  return buildChart(song, { parts: [{ track: 0, channel: 0 }], window });
}

function harness(over: Partial<SessionOptions> = {}, notes: [number, number, number?][] = [[1, 60], [2, 62], [3, 64]]) {
  const t = { perfMs: 10_000 };
  const clock = new GameClock(() => t.perfMs);
  const synth = new RecordingSynth();
  const chart = over.chart ?? makeChart(notes);
  const session = new PlaySession({
    chart, clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
    visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', ...over,
  });
  /** advance in frames of 16 ms, calling update on each */
  const advance = (sec: number) => {
    const until = t.perfMs + sec * 1000;
    while (t.perfMs < until) {
      t.perfMs = Math.min(until, t.perfMs + 16);
      session.update();
    }
  };
  const goTo = (songTime: number) => advance(songTime - session.now());
  const down = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const up = (pitch: number) => session.handleInput({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
  return { session, synth, advance, goTo, down, up, t };
}

describe('fix 1: the judge advances on the input-offset time', () => {
  it('a press exactly on the note with a 200 ms input offset is a Perfect, not a miss plus a wrong', () => {
    const { session, goTo, down, up } = harness({ inputOffsetMs: 200 });
    // The player hears the note at 1.0 and presses; the press reaches the game 200 ms later.
    goTo(1.2);
    down(60);
    up(60);
    goTo(2.2);
    down(62);
    up(62);
    goTo(3.2);
    down(64);
    up(64);
    goTo(6);
    expect(session.judge.counts).toMatchObject({ perfect: 3, miss: 0, wrong: 0 });
  });

  it('a release made before the deadline, by the offset, is not an overhold', () => {
    const chart = makeChart([[1, 60, 0.5], [4, 62, 0.5]]);
    const { session, goTo, down, up } = harness({ chart, inputOffsetMs: 150, judgeConfig: { ...DEFAULT_JUDGE_CONFIG, overhold: OVERHOLD_COST.expert } });
    goTo(1.15);
    down(60);
    // The note ends at 1.5; the grace is 150 ms of real time. Let go at 1.6 by the player's clock: within grace.
    goTo(1.75);
    up(60);
    goTo(3);
    expect(session.judge.counts.overheld).toBe(0);
    expect(session.judge.counts.perfect).toBe(1);
  });
});
