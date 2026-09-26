import { describe, expect, it } from 'vitest';
import { parseMidi } from 'midi-file';
import { beatLines, buildTempoMap, MidiParseError, parseSong, secondsToTicks, ticksToSeconds } from '../src/midi/parse.ts';
import { cc, end, gsRhythm, name, off, on, program, smf, tempo, timeSig } from './helpers/smf.ts';

const PPQ = 480;

describe('tempo map', () => {
  it('defaults to 120 BPM when the file has no tempo', () => {
    const map = buildTempoMap([], PPQ);
    expect(map).toEqual([{ tick: 0, usPerBeat: 500_000, seconds: 0 }]);
    expect(ticksToSeconds(map, PPQ, PPQ * 2)).toBeCloseTo(1, 9);
  });

  it('accumulates seconds across a mid-song tempo change', () => {
    // 2 beats at 120 (1 s), then 2 beats at 60 (2 s)
    const map = buildTempoMap([{ tick: 0, usPerBeat: 500_000 }, { tick: PPQ * 2, usPerBeat: 1_000_000 }], PPQ);
    expect(ticksToSeconds(map, PPQ, PPQ * 2)).toBeCloseTo(1, 9);
    expect(ticksToSeconds(map, PPQ, PPQ * 4)).toBeCloseTo(3, 9);
    expect(ticksToSeconds(map, PPQ, PPQ * 3)).toBeCloseTo(2, 9);
    expect(secondsToTicks(map, PPQ, 3)).toBeCloseTo(PPQ * 4, 6);
    expect(secondsToTicks(map, PPQ, 0.5)).toBeCloseTo(PPQ, 6);
  });

  it('prepends a default when the first tempo is not at tick 0', () => {
    const map = buildTempoMap([{ tick: PPQ, usPerBeat: 250_000 }], PPQ);
    expect(map[0]).toEqual({ tick: 0, usPerBeat: 500_000, seconds: 0 });
    expect(map[1]!.seconds).toBeCloseTo(0.5, 9);
  });

  it('collects tempo events from non-zero tracks', () => {
    const bytes = smf([
      [name('conductor'), end(0)],
      [name('lead'), tempo(0, 60), on(0, 60), off(PPQ, 60), end(PPQ)],
    ]);
    const song = parseSong(bytes);
    expect(song.tempoMap).toHaveLength(1);
    expect(song.tempoMap[0]!.usPerBeat).toBe(1_000_000);
    expect(song.notes[0]!.duration).toBeCloseTo(1, 9);
  });
});

describe('note pairing', () => {
  it('pairs notes and converts to seconds', () => {
    const bytes = smf([[tempo(0, 120), on(0, 60), off(PPQ, 60), on(PPQ, 64), off(PPQ * 3, 64), end(PPQ * 3)]]);
    const song = parseSong(bytes);
    expect(song.notes.map((n) => [n.pitch, n.time, n.duration])).toEqual([
      [60, 0, 0.5],
      [64, 0.5, 1],
    ]);
    expect(song.lastNoteOffTime).toBeCloseTo(1.5, 9);
  });

  it('closes the earliest open note first for overlapping same-pitch notes', () => {
    const bytes = smf([[on(0, 60), on(PPQ, 60), off(PPQ * 2, 60), off(PPQ * 4, 60), end(PPQ * 4)]]);
    const song = parseSong(bytes);
    expect(song.notes.map((n) => [n.tick, n.endTick])).toEqual([
      [0, PPQ * 2],
      [PPQ, PPQ * 4],
    ]);
  });

  it('treats noteOn with velocity 0 as noteOff (via the library)', () => {
    const bytes = smf([[on(0, 60), on(PPQ, 60, 0, 0), end(PPQ)]]);
    const raw = parseMidi(bytes);
    expect(raw.tracks[0]![1]!.type).toBe('noteOff');
    const song = parseSong(bytes);
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]!.endTick).toBe(PPQ);
  });

  it('closes an unterminated note at its track end', () => {
    const bytes = smf([[on(0, 60), off(PPQ, 60), on(PPQ, 62), end(PPQ * 2)]]);
    const song = parseSong(bytes);
    const n = song.notes[1]!;
    expect(n.unterminated).toBe(true);
    expect(n.endTick).toBe(PPQ * 2);
  });

  it('caps an unterminated note followed by an end-of-track sentinel', () => {
    // Real files end track 0 at tick 262143; a dangling note must not last minutes.
    const sentinel = 262143;
    const bytes = smf([
      [tempo(0, 120), end(sentinel)],
      [on(0, 60), off(PPQ, 60), on(PPQ, 62), end(sentinel)],
    ]);
    const song = parseSong(bytes);
    const n = song.notes[1]!;
    expect(n.unterminated).toBe(true);
    // last real noteOff at 0.5 s, cap = 2.5 s = 2.5 * 2 beats * 480
    expect(n.endTick).toBe(Math.round(2.5 * 2 * PPQ));
    expect(n.duration).toBeCloseTo(2, 6);
  });

  it('parses running-status files identically', () => {
    const events = [[on(0, 60), off(PPQ, 60), on(PPQ, 62), off(PPQ * 2, 62), end(PPQ * 2)]];
    const a = parseSong(smf(events, { running: false }));
    const b = parseSong(smf(events, { running: true }));
    expect(b.notes).toEqual(a.notes);
  });

  it('splits format 0 files by channel', () => {
    const bytes = smf([[on(0, 60, 0), on(0, 48, 1), off(PPQ, 60, 0), off(PPQ, 48, 1), end(PPQ)]]);
    const song = parseSong(bytes);
    expect(song.format).toBe(0);
    expect(new Set(song.notes.map((n) => n.channel))).toEqual(new Set([0, 1]));
  });
});

describe('classification inputs', () => {
  it('reads GS rhythm-part sysex into drumChannels', () => {
    const bytes = smf([[gsRhythm(10, 2), on(0, 36, 10), off(PPQ, 36, 10), end(PPQ)]]);
    const song = parseSong(bytes);
    expect(song.drumChannels).toEqual([10]);
  });

  it('reads XG bank MSB 127 into drumChannels', () => {
    const bytes = smf([[cc(0, 3, 0, 127), on(0, 36, 3), off(PPQ, 36, 3), end(PPQ)]]);
    expect(parseSong(bytes).drumChannels).toEqual([3]);
  });

  it('keeps program changes and track names', () => {
    const bytes = smf([[name('Lead Synth'), program(0, 2, 81), on(0, 60, 2), off(PPQ, 60, 2), end(PPQ)]]);
    const song = parseSong(bytes);
    expect(song.trackNames[0]).toBe('Lead Synth');
    expect(song.programs[0]).toMatchObject({ channel: 2, program: 81 });
  });
});

describe('time signatures and beat lines', () => {
  it('defaults to 4/4 and honours changes', () => {
    const bytes = smf([[tempo(0, 120), on(0, 60), timeSig(PPQ * 6, 3, 4), off(PPQ * 12, 60), end(PPQ * 12)]]);
    const song = parseSong(bytes);
    expect(song.timeSigs.map((s) => [s.tick, s.numerator])).toEqual([
      [0, 4],
      [PPQ * 6, 3],
    ]);
    const lines = beatLines(song, 6);
    const bars = lines.filter((l) => l.isBar).map((l) => l.time);
    // 4/4 bars at 0, 2 s (beats 0, 4); 3/4 from beat 6 (3 s): bars at 3, 4.5, 6
    expect(bars.map((t) => +t.toFixed(3))).toEqual([0, 2, 3, 4.5, 6]);
  });
});

describe('errors', () => {
  it('rejects SMPTE-timed files', () => {
    const bytes = smf([[on(0, 60), off(10, 60), end(10)]], { timeDivision: 0xe728 }); // -25 fps, 40 ticks/frame
    expect(() => parseSong(bytes)).toThrow(MidiParseError);
    expect(() => parseSong(bytes)).toThrow(/SMPTE/);
  });

  it('rejects garbage', () => {
    expect(() => parseSong(new Uint8Array([1, 2, 3, 4]))).toThrow(MidiParseError);
  });
});
