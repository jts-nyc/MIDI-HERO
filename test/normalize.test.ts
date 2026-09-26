import { describe, expect, it } from 'vitest';
import { ChannelFilter, OctaveTracker, parseMessage, type InputEvent } from '../src/input/normalize.ts';

const msg = (bytes: number[], perfMs = 0) => parseMessage({ data: bytes, perfMs });

describe('parseMessage', () => {
  it('parses note on/off including velocity-0 note-ons', () => {
    expect(msg([0x90, 60, 100])).toMatchObject({ type: 'on', pitch: 60, velocity: 100, channel: 0 });
    expect(msg([0x91, 60, 0])).toMatchObject({ type: 'off', pitch: 60, channel: 1 });
    expect(msg([0x80, 60, 64])).toMatchObject({ type: 'off', pitch: 60 });
  });

  it('turns CC64 into a pedal event and ignores other controllers', () => {
    expect(msg([0xb0, 64, 127])).toMatchObject({ type: 'pedal', velocity: 127 });
    expect(msg([0xb0, 7, 100])).toBeNull();
  });

  it('drops system realtime, sysex, aftertouch and bend', () => {
    expect(msg([0xf8])).toBeNull();
    expect(msg([0xfe])).toBeNull();
    expect(msg([0xf0, 0x41, 0xf7])).toBeNull();
    expect(msg([0xd0, 50])).toBeNull();
    expect(msg([0xa0, 60, 50])).toBeNull();
    expect(msg([0xe0, 0, 64])).toBeNull();
    expect(msg([])).toBeNull();
  });
});

const ev = (over: Partial<InputEvent>): InputEvent => ({ type: 'on', pitch: 60, velocity: 80, channel: 0, perfMs: 0, source: 'midi', ...over });

describe('ChannelFilter', () => {
  it('drops channel 9 before a lock and everything but the locked channel after', () => {
    const f = new ChannelFilter();
    expect(f.filter(ev({ channel: 9 }))).toBeNull();
    expect(f.filter(ev({ channel: 3 }))).not.toBeNull();
    f.lock(0);
    expect(f.filter(ev({ channel: 3, pitch: 61 }))).toBeNull();
    expect(f.filter(ev({ channel: 0, pitch: 62 }))).not.toBeNull();
  });

  it('merges doubled note-ons across channels within 15 ms', () => {
    const f = new ChannelFilter();
    expect(f.filter(ev({ channel: 0, perfMs: 100 }))).not.toBeNull();
    expect(f.filter(ev({ channel: 1, perfMs: 110 }))).toBeNull();
    expect(f.filter(ev({ channel: 1, perfMs: 130 }))).not.toBeNull();
  });

  it('never filters keyboard or autoplay events', () => {
    const f = new ChannelFilter();
    f.lock(0);
    expect(f.filter(ev({ channel: 9, source: 'autoplay' }))).not.toBeNull();
    expect(f.filter(ev({ channel: 5, source: 'keyboard', perfMs: 1 }))).not.toBeNull();
  });
});

describe('OctaveTracker', () => {
  it('reports a re-offset after three consecutive presses an octave off', () => {
    const t = new OctaveTracker(3);
    expect(t.observe(false, 12)).toBeNull();
    expect(t.observe(false, 12)).toBeNull();
    expect(t.observe(false, 12)).toEqual({ type: 'reoffset', delta: 12 });
  });

  it('a matching press or a different delta resets the streak', () => {
    const t = new OctaveTracker(3);
    t.observe(false, 12);
    t.observe(false, 12);
    t.observe(true, 0);
    expect(t.observe(false, 12)).toBeNull();
    t.observe(false, -12);
    expect(t.observe(false, 12)).toBeNull();
  });

  it('reports a transposition for a consistent non-octave delta', () => {
    const t = new OctaveTracker(3);
    t.observe(false, 5);
    t.observe(false, 5);
    expect(t.observe(false, 5)).toEqual({ type: 'transposed', delta: 5 });
  });
});
