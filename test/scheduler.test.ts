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
});
