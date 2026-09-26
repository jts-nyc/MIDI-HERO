import { describe, expect, it } from 'vitest';
import { WebAudioSynth, familyFor } from '../src/audio/synth.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';

describe('WebAudioSynth', () => {
  it('starts a player note at the current audio time when asked for "now"', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.noteOn(0, 60, 100, 0);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    for (const o of ctx.oscillators) expect(o.started).toBe(ctx.currentTime);
  });

  it('honours a future schedule time and never schedules in the past', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.noteOn(1, 64, 100, ctx.currentTime + 0.5);
    expect(ctx.oscillators[0]!.started).toBeCloseTo(ctx.currentTime + 0.5, 9);
    synth.noteOn(1, 65, 100, ctx.currentTime - 3);
    expect(ctx.oscillators.at(-1)!.started).toBe(ctx.currentTime);
  });

  it('stops oscillators on noteOff and allNotesOff', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.noteOn(0, 60, 100, 0);
    synth.noteOff(0, 60, 0);
    expect(ctx.oscillators.every((o) => o.stopped !== null)).toBe(true);
    synth.noteOn(0, 62, 100, 0);
    synth.allNotesOff(0);
    expect(ctx.oscillators.every((o) => o.stopped !== null)).toBe(true);
  });

  it('routes drum channels to the noise kit (no oscillators for hats)', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.noteOn(9, 42, 100, 0);
    expect(ctx.oscillators).toHaveLength(0);
    synth.setDrumChannels([10]);
    synth.noteOn(10, 42, 100, 0);
    expect(ctx.oscillators).toHaveLength(0);
  });

  it('maps GM programs to timbre families', () => {
    expect(familyFor(0)).toBe('keys');
    expect(familyFor(33)).toBe('bass');
    expect(familyFor(48)).toBe('pad');
    expect(familyFor(81)).toBe('lead');
    expect(familyFor(61)).toBe('brass');
  });
});
