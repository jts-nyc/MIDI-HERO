import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { BackingScheduler } from '../src/audio/scheduler.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import type { BackingEvent } from '../src/midi/chart.ts';

const ev = (time: number, type: BackingEvent['type'], over: Partial<BackingEvent> = {}): BackingEvent => ({
  time, type, track: 1, channel: 0, partKey: '1:0', pitch: 60, velocity: 90, controller: -1, value: 0, ...over,
});

function harness(events: BackingEvent[], opts: ConstructorParameters<typeof BackingScheduler>[3] = {}) {
  const t = { perfMs: 0 };
  const clock = new GameClock(() => t.perfMs);
  const synth = new RecordingSynth();
  const timers: (() => void)[] = [];
  const sched = new BackingScheduler(events, synth, clock, {
    setIntervalFn: (fn) => { timers.push(fn); return 1; },
    clearIntervalFn: () => { timers.length = 0; },
    ...opts,
  });
  return { t, clock, synth, sched, timers };
}

describe('BackingScheduler', () => {
  it('schedules events inside the lookahead window at their song time, in order', () => {
    const { t, clock, synth, sched } = harness([ev(0.5, 'on'), ev(1.0, 'off'), ev(1.5, 'on', { pitch: 62 })]);
    clock.start(0);
    sched.start();
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(0);
    t.perfMs = 400; // horizon 0.52
    sched.tick();
    const ons = synth.calls.filter((c) => c.method === 'noteOn');
    expect(ons).toHaveLength(1);
    expect(ons[0]!.args).toEqual([0, 60, 90, 0.5]); // no audio: context time == song time
    t.perfMs = 1400;
    sched.tick();
    expect(synth.calls.filter((c) => c.method === 'noteOff')).toHaveLength(1);
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(2);
  });

  it('does nothing while paused and resumes from the current position without replaying', () => {
    const { t, clock, synth, sched } = harness([ev(0.5, 'on'), ev(2.0, 'on', { pitch: 62 })]);
    clock.start(0);
    sched.start();
    t.perfMs = 600;
    sched.tick();
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(1);
    clock.pause();
    sched.stop();
    expect(synth.calls.at(-1)!.method).toBe('allNotesOff');
    t.perfMs = 5000;
    sched.tick();
    clock.resume();
    sched.start(); // reset() lands after the already-played note
    t.perfMs = 5000 + 1500;
    sched.tick();
    const ons = synth.calls.filter((c) => c.method === 'noteOn');
    expect(ons).toHaveLength(2);
    expect(ons[1]!.args[1]).toBe(62);
  });

  it('mutes parts in the muted set and still sends programs, controllers and bends', () => {
    const { t, clock, synth, sched } = harness(
      [ev(0, 'program', { value: 33 }), ev(0.1, 'cc', { controller: 7, value: 100 }), ev(0.1, 'bend', { value: 4096 }), ev(0.2, 'on', { partKey: 'dup' }), ev(0.2, 'on', { pitch: 64 })],
      { mutedParts: new Set(['dup']) },
    );
    clock.start(0);
    sched.start();
    t.perfMs = 300;
    sched.tick();
    expect(synth.calls.map((c) => c.method)).toEqual(['program', 'control', 'bend', 'noteOn']);
    expect(synth.calls[3]!.args[1]).toBe(64);
  });

  it('replays the latest program change when starting mid-song', () => {
    const { t, clock, synth, sched } = harness([ev(0, 'program', { value: 5 }), ev(1, 'program', { value: 9 }), ev(3, 'on')]);
    clock.start(2);
    sched.start();
    expect(synth.calls[0]).toMatchObject({ method: 'program', args: [0, 9] });
    t.perfMs = 1000;
    sched.tick();
    expect(synth.calls.at(-1)!.method).toBe('noteOn');
  });

  it('prepends count-in clicks before song time 0', () => {
    const { t, clock, synth, sched } = harness([ev(0, 'on')], { countIn: { beats: 4, beatSeconds: 0.5 } });
    clock.start(-2);
    sched.start();
    t.perfMs = 2100;
    sched.tick();
    const ons = synth.calls.filter((c) => c.method === 'noteOn');
    expect(ons).toHaveLength(5);
    expect(ons.map((c) => c.args[3])).toEqual([-2, -1.5, -1, -0.5, 0]);
    expect(ons[0]!.args[0]).toBe(9);
  });

  it('scales the lookahead by the playback rate', () => {
    const { t, clock, synth, sched } = harness([ev(0.1, 'on')], { lookaheadSeconds: 0.12 });
    clock.setRate(0.5);
    clock.start(0);
    sched.start();
    // at rate 0.5 the horizon is now + 0.06 song seconds: 0.1 is outside
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(0);
    t.perfMs = 100; // song 0.05, horizon 0.11
    sched.tick();
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(1);
  });

  // Round 3: wait mode holds the clock just past an onset (by the input offset) and stops the band;
  // the band's notes on that onset, and longer ones still sounding, used to stay silent after it.
  it('after a wait, strikes again the band notes sounding at the held time, and only those', () => {
    const { t, clock, synth, sched } = harness([
      ev(0, 'on', { pitch: 48 }), ev(4, 'off', { pitch: 48 }), // a long bass note across the wait
      ev(1, 'on', { pitch: 60 }), ev(1.5, 'off', { pitch: 60 }), // on the held onset
      ev(0.5, 'on', { pitch: 55 }), ev(0.8, 'off', { pitch: 55 }), // over before it
      ev(1, 'on', { pitch: 36, channel: 9 }), ev(1.1, 'off', { pitch: 36, channel: 9 }), // a drum hit
      ev(2, 'on', { pitch: 62 }), ev(2.5, 'off', { pitch: 62 }),
    ].sort((a, b) => a.time - b.time));
    clock.start(0);
    sched.start();
    t.perfMs = 1040;
    sched.tick();
    // the gate: the note at 1 s is held at 1.04 (a 40 ms input offset)
    clock.seek(1.04);
    clock.pause();
    sched.stop();
    synth.calls.length = 0;
    t.perfMs = 9000;
    clock.resume();
    sched.start({ resound: true });
    const ons = synth.calls.filter((c) => c.method === 'noteOn');
    expect(ons.map((c) => c.args[1]).sort()).toEqual([48, 60]);
    expect(ons.every((c) => Math.abs((c.args[3] as number) - 1.04) < 1e-6)).toBe(true);
    // then on as usual, nothing twice
    t.perfMs = 9000 + 1000;
    sched.tick();
    expect(synth.calls.filter((c) => c.method === 'noteOn').map((c) => c.args[1]).sort()).toEqual([48, 60, 62]);
  });

  /** Play to `at`, then stop and restart the way a wait release does; returns the calls after the restart. */
  function waitAt(h: ReturnType<typeof harness>, at: number) {
    h.clock.start(0);
    h.sched.start();
    h.t.perfMs = at * 1000;
    h.sched.tick();
    h.clock.pause();
    h.sched.stop();
    h.synth.calls.length = 0;
    h.clock.resume();
    h.sched.start({ resound: true });
    return h.synth.calls;
  }

  it('after a wait, does not strike again drum hits on GS/XG rhythm channels other than 10', () => {
    const h = harness([
      ev(0.9, 'on', { pitch: 36, channel: 10 }), ev(1.5, 'off', { pitch: 36, channel: 10 }), // a kick on a rhythm part
      ev(0.9, 'on', { pitch: 48 }), ev(1.5, 'off', { pitch: 48 }),
    ].sort((a, b) => a.time - b.time), { drumChannels: [10] });
    const ons = waitAt(h, 1).filter((c) => c.method === 'noteOn');
    expect(ons.map((c) => [c.args[0], c.args[1]])).toEqual([[0, 48]]);
  });

  it('after a wait, strikes again the notes the sustain pedal still holds, and the pedal ends them', () => {
    const h = harness([
      ev(0, 'cc', { controller: 64, value: 127, pitch: -1 }),
      ev(0.2, 'on', { pitch: 48 }), ev(0.5, 'off', { pitch: 48 }), // key up, but the pedal holds it
      ev(0.3, 'cc', { channel: 1, controller: 64, value: 127, pitch: -1 }),
      ev(0.4, 'cc', { channel: 1, controller: 64, value: 0, pitch: -1 }),
      ev(0.4, 'on', { channel: 1, pitch: 50 }), ev(0.6, 'off', { channel: 1, pitch: 50 }), // pedal up on channel 1: over
      ev(2, 'cc', { controller: 64, value: 0, pitch: -1 }),
    ].sort((a, b) => a.time - b.time));
    const calls = waitAt(h, 1);
    const ons = calls.filter((c) => c.method === 'noteOn');
    expect(ons.map((c) => [c.args[0], c.args[1]])).toEqual([[0, 48]]);
    // the pedal is down again and the key is up, so the release at 2 s ends the note
    const i = calls.findIndex((c) => c.method === 'noteOn');
    expect(calls.slice(0, i).some((c) => c.method === 'control' && c.args[0] === 0 && c.args[1] === 64 && (c.args[2] as number) >= 64)).toBe(true);
    expect(calls.slice(i).some((c) => c.method === 'noteOff' && c.args[0] === 0 && c.args[1] === 48)).toBe(true);
  });

  it('a plain start (pause and resume) does not strike anything again', () => {
    const { t, clock, synth, sched } = harness([ev(0, 'on', { pitch: 48 }), ev(4, 'off', { pitch: 48 })]);
    clock.start(0);
    sched.start();
    t.perfMs = 500;
    sched.tick();
    clock.pause();
    sched.stop();
    synth.calls.length = 0;
    clock.resume();
    sched.start();
    expect(synth.calls.filter((c) => c.method === 'noteOn')).toHaveLength(0);
  });
});
