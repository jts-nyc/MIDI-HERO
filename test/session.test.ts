import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

function makeChart(notes: [number, number][], window: { low: number; high: number } | null = null) {
  const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t) + PPQ / 4, p)]);
  const song = parseSong(smf([[tempo(0, 120), ...evs, end(secs(notes.at(-1)![0]) + PPQ)]]));
  return buildChart(song, { parts: [{ track: 0, channel: 0 }], window });
}

/** Fake time: perf clock we can advance; the session's clock uses it. */
function harness(over: Partial<SessionOptions> = {}, notes: [number, number][] = [[1, 60], [2, 62], [3, 64]]) {
  const t = { perfMs: 10_000 };
  const realPerf = performance.now;
  const clock = new GameClock(() => t.perfMs);
  const synth = new RecordingSynth();
  const chart = over.chart ?? makeChart(notes);
  const session = new PlaySession({
    chart, clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
    visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', ...over,
  });
  const advance = (sec: number) => {
    t.perfMs += sec * 1000;
    session.update();
  };
  const press = (pitch: number, source: 'midi' | 'keyboard' = 'midi', channel = 0) => {
    session.handleInput({ type: 'on', pitch, velocity: 90, channel, perfMs: t.perfMs, source });
    session.handleInput({ type: 'off', pitch, velocity: 0, channel, perfMs: t.perfMs + 50, source });
  };
  const goTo = (songTime: number) => advance(songTime - session.now());
  void realPerf;
  return { session, synth, advance, press, goTo, t };
}

describe('PlaySession', () => {
  it('starts in the lead-in and judges input at the input time', () => {
    const { session, goTo, t } = harness();
    expect(session.now()).toBeCloseTo(-2, 9); // visibleSeconds + barSeconds
    goTo(1.05);
    session.handleInput({ type: 'on', pitch: 60, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    expect(session.judge.counts.great).toBe(1);
    expect(session.keyVisuals.get(60)?.kind).toBe('great');
    expect(session.popups.at(-1)?.text).toBe('Great');
  });

  it('sounds the player note synchronously via the synth on every press', () => {
    const { session, synth, press, goTo } = harness();
    goTo(0.5);
    press(61); // wrong note, still sounds
    expect(synth.calls[0]).toMatchObject({ method: 'noteOn', args: [0, 61, 90, 0] });
    expect(synth.calls[1]).toMatchObject({ method: 'noteOff', args: [0, 61, 0] });
    expect(session.judge.counts.wrong).toBe(1);
  });

  it('locks the MIDI channel on the first matching note and drops others after', () => {
    const { session, press, goTo } = harness();
    goTo(1);
    press(60, 'midi', 2);
    expect(session.filter.locked).toBe(2);
    goTo(2);
    press(62, 'midi', 0); // wrong channel, ignored
    expect(session.judge.counts.great + session.judge.counts.perfect).toBe(1);
    press(62, 'midi', 2);
    expect(session.judge.counts.perfect).toBe(2);
  });

  it('finishes with misses when time runs out and reports a result', () => {
    const { session, advance } = harness();
    let result = null as ReturnType<PlaySession['result']> | null;
    session.onFinished = (r) => (result = r);
    advance(20);
    expect(session.status).toBe('finished');
    expect(result!.counts.miss).toBe(3);
    expect(result!.accuracy).toBe(0);
  });

  it('autoplay through the input path scores 100%', () => {
    const notes: [number, number][] = Array.from({ length: 20 }, (_, i) => [1 + i * 0.3, 60 + (i % 7)]);
    const { session, advance } = harness({ autoplay: { jitterMs: 0 } }, notes);
    for (let i = 0; i < 300; i++) advance(0.033);
    expect(session.status).toBe('finished');
    expect(session.result().accuracy).toBe(1);
    expect(session.result().maxCombo).toBe(20);
  });

  it('applies the octave offset in relative mode and re-offsets after three octave-off presses', () => {
    const chart = makeChart([[1, 60], [2, 62], [3, 64], [4, 65], [5, 67]], { low: 60, high: 84 });
    const { session, press, goTo } = harness({ chart, relative: true });
    const events: string[] = [];
    session.onOctave = (e) => events.push(e.type);
    goTo(1); press(48); // an octave low
    goTo(2); press(50);
    goTo(3); press(52);
    expect(events).toEqual(['reoffset']);
    expect(session.octaveOffset).toBe(12);
    goTo(4); press(53); // now judged as 65
    expect(session.judge.counts.perfect).toBe(1);
  });

  it('pause freezes time and resume continues', () => {
    const { session, advance } = harness();
    advance(1);
    session.pause();
    const t = session.now();
    advance(5);
    expect(session.now()).toBe(t);
    session.resume();
    advance(0.5);
    expect(session.now()).toBeCloseTo(t + 0.5, 9);
  });
});
