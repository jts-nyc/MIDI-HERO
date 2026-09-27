// Regression tests for the round-1 review fixes (round 2).
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { FEEDBACK_CHANNEL, RecordingSynth, WebAudioSynth } from '../src/audio/synth.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';
import { DEFAULT_JUDGE_CONFIG, OVERHOLD_COST } from '../src/game/judge.ts';
import { keyLevelOf, listKeyLevel } from '../src/game/results.ts';
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

describe('fix 2: a note-off stops the voice its note started, not a retriggered one', () => {
  it('the synth releases only the voice named by the note-off', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    const first = synth.noteOn(FEEDBACK_CHANNEL, 60, 100, 0);
    const oscFirst = ctx.oscillators.length;
    const second = synth.noteOn(FEEDBACK_CHANNEL, 60, 100, 0); // retrigger: the first is released
    expect(second).not.toBe(first);
    const secondOscs = ctx.oscillators.slice(oscFirst);
    synth.noteOff(FEEDBACK_CHANNEL, 60, ctx.currentTime + 0.07, first); // the first note's scheduled end
    expect(secondOscs.every((o) => o.stopped === null)).toBe(true);
    synth.noteOff(FEEDBACK_CHANNEL, 60, ctx.currentTime + 0.57, second);
    expect(secondOscs.every((o) => o.stopped !== null)).toBe(true);
  });

  it('notes 1.0–1.5 and 1.5–2.0 on one pitch, the second hit early at 1.43: it sounds to 2.0', () => {
    const chart = makeChart([[1, 60, 0.5], [1.5, 60, 0.5], [3, 62]]);
    const { session, synth, goTo, down, up } = harness({ chart, feedbackSound: 'chart' });
    goTo(1);
    down(60);
    up(60);
    goTo(1.43);
    down(60);
    up(60);
    goTo(2.5);
    expect(session.judge.counts.miss).toBe(0);
    const ons = synth.calls.filter((c) => c.method === 'noteOn' && c.args[0] === FEEDBACK_CHANNEL);
    const offs = synth.calls.filter((c) => c.method === 'noteOff' && c.args[0] === FEEDBACK_CHANNEL);
    expect(ons).toHaveLength(2);
    // voices are numbered 1 and 2 by the recording synth, in order
    expect(offs.map((c) => [c.args[2], c.args[3]])).toEqual([[1.5, 1], [2, 2]]);
  });
});

describe('fix 3: a key released after an octave re-offset releases the pitch it pressed', () => {
  it('the hold ends when the key comes up; no overhold, and the key is no longer held', () => {
    const chart = makeChart([[1, 60, 1], [4, 62]]);
    const { session, goTo, down, up } = harness({ chart, relative: true, judgeConfig: { ...DEFAULT_JUDGE_CONFIG, overhold: OVERHOLD_COST.expert } });
    session.octaveOffset = 12;
    goTo(1);
    down(48); // played as 60
    expect(session.judge.counts.perfect).toBe(1);
    goTo(1.3);
    session.octaveOffset = 0; // the tracker re-offset while the key is down
    up(48);
    goTo(3);
    expect(session.noteVisuals[0]!.hold).toBe('released'); // let go early: the hold is not paid in full
    expect(session.judge.counts.overheld).toBe(0);
    expect((session as unknown as { heldKeys: Set<number> }).heldKeys.size).toBe(0);
  });
});

describe('fix 4: the song list looks a best up under the key the play path records it under', () => {
  const three = ['easy', 'medium', 'hard'] as const;
  it('a choice saved before levels existed finds its best under the no-suffix key', () => {
    let asked = false;
    expect(listKeyLevel({}, () => ((asked = true), three))).toBe('expert');
    expect(asked).toBe(false);
  });

  it('a pack level alone is resolved against the part: its top level is the no-suffix key', () => {
    expect(listKeyLevel({ difficulty: 'hard' }, () => three)).toBe('expert');
    expect(listKeyLevel({ difficulty: 'expert' }, () => three)).toBe('expert');
    expect(listKeyLevel({ difficulty: 'medium' }, () => three)).toBe('medium');
    expect(listKeyLevel({ difficulty: 'medium' }, () => ['easy', 'medium'])).toBe('expert');
  });

  it('a stored key level wins, and it is what the play path computes', () => {
    expect(listKeyLevel({ keyLevel: 'easy', difficulty: 'hard' }, () => three)).toBe('easy');
    expect(keyLevelOf('hard', three)).toEqual({ level: 'hard', keyLevel: 'expert' });
    expect(keyLevelOf('expert', ['easy'])).toEqual({ level: 'easy', keyLevel: 'easy' });
  });
});
