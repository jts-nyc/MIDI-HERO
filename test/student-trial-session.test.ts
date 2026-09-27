import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import type { InputEvent } from '../src/input/normalize.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

/** Two one-second student notes and accompaniment extending beyond the final onset. */
function harness(over: Partial<SessionOptions> = {}) {
  const song = parseSong(smf([
    [tempo(0, 120), on(960, 60), off(1920, 60), on(2880, 67), off(3840, 67), end(4800)],
    [on(0, 36, 1), off(4800, 36, 1), end(4800)],
  ]));
  const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });
  const time = { ms: 0 };
  const clock = new GameClock(() => time.ms);
  const synth = new RecordingSynth();
  const session = new PlaySession({
    chart, clock, synth, rate: 1, inputOffsetMs: 0, relative: false,
    judgeConfig: { ...DEFAULT_JUDGE_CONFIG, overhold: null, failAt: null },
    visibleSeconds: 1, barSeconds: 2, autoplay: null, hint: '', feedbackSound: 'press',
    steadyBacking: true, finishAtSongEnd: true, disableStarPower: true, ...over,
  });
  const goTo = (seconds: number) => {
    time.ms += (seconds - session.now()) * 1000 / session.rate;
    session.update();
  };
  const input = (type: InputEvent['type'], pitch: number, velocity = type === 'on' ? 83 : 0) =>
    session.handleInput({ type, pitch, velocity, channel: 0, source: 'midi', perfMs: time.ms });
  return { chart, session, synth, goTo, input };
}

describe('student audio trial session', () => {
  it('sounds the wrong played pitch immediately and the next correct entrance recovers', () => {
    const { session, synth, goTo, input } = harness();
    goTo(1);
    input('on', 61, 57);
    expect(synth.calls).toEqual([{ method: 'noteOn', args: [0, 61, 57, 0] }]);
    input('off', 61);
    goTo(2.5);
    expect(session.judge.counts).toMatchObject({ wrong: 1, miss: 1 });
    // A missed target never gets an automatic replacement voice.
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(1);
    goTo(3);
    input('on', 67);
    expect(session.judge.counts.perfect).toBe(1);
    expect(session.judge.combo).toBe(1);
    expect(synth.calls.at(-1)).toEqual({ method: 'noteOn', args: [0, 67, 83, 0] });
    expect(synth.calls.some((c) => c.method === 'clunk' || c.method === 'bonk')).toBe(false);
  });

  it('releases the played note when the student lets go early', () => {
    const { session, synth, goTo, input } = harness();
    goTo(1);
    input('on', 60);
    goTo(1.1);
    input('off', 60);
    expect(synth.calls.at(-1)).toEqual({ method: 'noteOff', args: [0, 60, 0] });
    expect(session.noteVisuals[0]?.hold).toBe('released');
    goTo(2.5);
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(1);
  });

  it('keeps pedal sustain while disabling both pedal and direct star activation', () => {
    const { session, synth, goTo, input } = harness();
    goTo(1);
    input('on', 60);
    session.judge.starGauge = 1;
    input('pedal', -1, 127);
    goTo(1.1);
    input('off', 60);
    expect(session.judge.holds).toHaveLength(1);
    expect(session.activateStar()).toBe(false);
    expect(session.judge.starActive).toBe(false);
    input('pedal', -1, 0);
    expect(session.judge.holds).toHaveLength(0);
    expect(synth.calls.filter((c) => c.method === 'control')).toEqual([
      { method: 'control', args: [0, 64, 127, 0] },
      { method: 'control', args: [0, 64, 0, 0] },
    ]);
  });

  it('leaves note audio to the instrument when software sound is off', () => {
    const { synth, goTo, input } = harness({ feedbackSound: 'off' });
    goTo(1);
    input('on', 61);
    input('off', 61);
    input('pedal', -1, 127);
    goTo(3);
    input('on', 67);
    input('off', 67);
    input('pedal', -1, 0);
    expect(synth.calls).toEqual([]);
  });

  it('clears sustain on pause when the physical pedal is released before resume', () => {
    const { session, synth, goTo, input } = harness();
    goTo(1);
    input('on', 60);
    input('pedal', -1, 127);
    session.pause();
    expect(session.judge.pedalDown).toBe(false);
    expect(synth.calls.slice(-2)).toEqual([
      { method: 'allNotesOff', args: [0] },
      { method: 'control', args: [0, 64, 0, 0] },
    ]);
    input('pedal', -1, 0); // ignored by the paused session; the synth is already reset
    session.resume();
    goTo(3);
    input('on', 67);
    goTo(3.1);
    input('off', 67);
    expect(session.judge.holds).toHaveLength(0);
    expect(synth.calls.slice(-2)).toEqual([
      { method: 'noteOn', args: [0, 67, 83, 0] },
      { method: 'noteOff', args: [0, 67, 0] },
    ]);
    expect(synth.calls.filter((c) => c.method === 'control')).toEqual([
      { method: 'control', args: [0, 64, 127, 0] },
      { method: 'control', args: [0, 64, 0, 0] },
    ]);
  });

  it('clears software sustain when the passage ends with the pedal down', () => {
    const { chart, session, synth, goTo, input } = harness();
    goTo(1);
    input('pedal', -1, 127);
    goTo(chart.duration);
    expect(session.status).toBe('finished');
    expect(synth.calls.slice(-2)).toEqual([
      { method: 'allNotesOff', args: [0] },
      { method: 'control', args: [0, 64, 0, 0] },
    ]);
  });

  it('keeps backing steady even after enough errors to empty the meter', () => {
    const trial = harness();
    const normal = harness({ steadyBacking: false });
    for (const h of [trial, normal]) {
      h.goTo(0.5);
      for (let pitch = 30; pitch < 46; pitch++) {
        h.input('on', pitch);
        h.input('off', pitch);
      }
      expect(h.session.judge.meter.health).toBe(0);
      expect(h.session.status).toBe('playing');
    }
    expect(trial.session.mixLevel).toBe(1);
    expect(normal.session.mixLevel).toBeLessThan(1);
  });

  it.each(['held', 'released', 'omitted', 'wrong'] as const)(
    'plays the same full passage when the final note is %s', (ending) => {
      const { chart, session, synth, goTo, input } = harness();
      goTo(1);
      input('on', 60);
      goTo(2);
      input('off', 60);
      goTo(3);
      if (ending !== 'omitted') input('on', ending === 'wrong' ? 68 : 67);
      goTo(3.1);
      if (ending === 'released') input('off', 67);
      goTo(chart.duration - 0.01);
      expect(session.status).toBe('playing');
      expect(synth.calls.some((c) => c.method === 'allNotesOff')).toBe(false);
      goTo(chart.duration);
      expect(session.status).toBe('finished');
      expect(synth.calls.at(-2)?.method).toBe('allNotesOff');
    },
  );
});
