import { describe, expect, it } from 'vitest';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts, defaultPart, matchRatio, songEnd } from '../src/midi/parts.ts';
import { cc, end, gsRhythm, name, off, on, program, smf } from './helpers/smf.ts';
import type { AbsEvent } from './helpers/smf.ts';

const PPQ = 480;

/** A simple line of quarter notes on one channel, starting at `startTick`. */
function line(pitches: number[], channel = 0, startTick = 0, step = PPQ): AbsEvent[] {
  const evs: AbsEvent[] = [];
  pitches.forEach((p, i) => {
    evs.push(on(startTick + i * step, p, channel));
    evs.push(off(startTick + i * step + step - 10, p, channel));
  });
  return evs;
}

const melody = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65];

describe('classification', () => {
  it('labels channel 9 as drums regardless of program', () => {
    const song = parseSong(smf([[name('Kit'), program(0, 9, 0), ...line([36, 38, 42, 46], 9), end(PPQ * 4)]]));
    const parts = buildParts(song);
    expect(parts[0]).toMatchObject({ kind: 'drums', name: 'Kit (Drums)' });
  });

  it('labels a GS rhythm channel as drums', () => {
    const song = parseSong(smf([[gsRhythm(10, 2), program(0, 10, 25), ...line([36, 38, 42, 46], 10), end(PPQ * 4)]]));
    expect(buildParts(song)[0]!.kind).toBe('drums');
  });

  it('labels an XG bank-127 channel as drums', () => {
    const song = parseSong(smf([[cc(0, 3, 0, 127), ...line([36, 38], 3), end(PPQ * 2)]]));
    expect(buildParts(song)[0]!.kind).toBe('drums');
  });

  it('labels programs 120-127 as sound effects', () => {
    const song = parseSong(smf([[program(0, 2, 122), ...line([2, 5, 9], 2), end(PPQ * 3)]]));
    expect(buildParts(song)[0]!.kind).toBe('sfx');
  });

  it('hides empty tracks and splits format 0 by channel', () => {
    const song = parseSong(smf([
      [name('conductor'), end(0)],
      [name('two channels'), ...line(melody, 0), ...line([48, 50, 52], 1, 0, PPQ * 4), end(PPQ * 12)],
      [name('empty'), end(0)],
    ]));
    const parts = buildParts(song);
    expect(parts.map((p) => [p.key, p.name])).toEqual([
      ['1:0', 'two channels (ch 1)'],
      ['1:1', 'two channels (ch 2)'],
    ]);
  });
});

describe('duplicates', () => {
  it('groups parts whose note-ons match at 90% or more', () => {
    const song = parseSong(smf([
      [name('a'), ...line(melody, 0), end(PPQ * 12)],
      [name('b'), ...line(melody, 1), end(PPQ * 12)],
      [name('c'), ...line(melody.map((p) => p + 12), 2), end(PPQ * 12)],
    ]));
    const parts = buildParts(song);
    expect(parts[1]!.duplicateOf).toBe('0:0');
    expect(parts[2]!.duplicateOf).toBeUndefined();
    expect(defaultPart(parts)!.key).not.toBe('1:1');
  });

  it('matchRatio tolerates 10 ms and requires the same pitch', () => {
    const a = parseSong(smf([[...line([60, 62], 0), end(PPQ * 2)]])).notes;
    const b = parseSong(smf([[...line([60, 64], 0), end(PPQ * 2)]])).notes;
    expect(matchRatio(a, b)).toBe(0.5);
  });
});

describe('default part', () => {
  it('prefers a mid-register single-note piano line over a bass or a dense arpeggio', () => {
    const arp = Array.from({ length: 96 }, (_, i) => 48 + (i % 4) * 4);
    const song = parseSong(smf([
      [name('conductor'), end(0)],
      [name('Bass'), program(0, 1, 33), ...line([36, 36, 38, 38, 40, 40, 41, 41, 43, 43, 41, 41], 1), end(PPQ * 12)],
      [name('Arp'), program(0, 2, 25), ...line(arp, 2, 0, PPQ / 8), end(PPQ * 12)],
      [name('Lead'), program(0, 0, 0), ...line(melody, 0), end(PPQ * 12)],
      [name('Kit'), ...line([36, 38, 42, 46, 36, 38, 42, 46, 36, 38, 42, 46], 9), end(PPQ * 12)],
    ]));
    const parts = buildParts(song);
    expect(defaultPart(parts)!.name).toBe('Lead');
    expect(parts.find((p) => p.name === 'Arp')!.score).toBeLessThan(parts.find((p) => p.name === 'Bass')!.score + 5);
  });

  it('returns undefined when only drums exist', () => {
    const song = parseSong(smf([[...line([36, 38], 9), end(PPQ * 2)]]));
    expect(defaultPart(buildParts(song))).toBeUndefined();
  });

  it('reports summaries and song end', () => {
    const song = parseSong(smf([[program(0, 0, 0), ...line(melody, 0, PPQ * 4), end(PPQ * 16)]]));
    const [p] = buildParts(song);
    expect(p).toMatchObject({ noteCount: 12, minPitch: 60, maxPitch: 72, maxChord: 1, monophonicRatio: 1 });
    expect(p!.firstNoteTime).toBeCloseTo(2, 6);
    expect(songEnd([p!])).toBeCloseTo(p!.lastNoteEnd + 2, 6);
  });
});
