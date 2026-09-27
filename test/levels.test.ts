// Which difficulty levels a part has. Levels are relative to the song: Easy is always the
// lowest rung, and a level above exists only if it asks for more than the one below.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { suggestNextStep } from '../src/game/results.ts';
import { buildChart, offeredLevels, resolveLevel, splitNotes, type Difficulty } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts, defaultPart } from '../src/midi/parts.ts';
import { bestKey } from '../src/storage/db.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const PART = [{ track: 0, channel: 0 }];
type N = [number, number, number?];
function levelsOf(notes: N[]): [Difficulty, number][] {
  const evs = notes.flatMap(([b, p, len = 0.5]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
  const last = Math.max(...notes.map(([b, , len = 0.5]) => b + len));
  const song = parseSong(smf([[tempo(0, 100), ...evs, end(Math.round(last * PPQ) + PPQ)]]));
  return offeredLevels(splitNotes(song, { parts: PART }).player, song).map((l) => [l.level, l.noteCount]);
}
function bundled(file: string) {
  const song = parseSong(new Uint8Array(readFileSync(join(process.cwd(), 'public/songs', file))));
  const def = defaultPart(buildParts(song))!;
  return { song, def, levels: offeredLevels(splitNotes(song, { parts: [def] }).player, song) };
}

describe('offered levels', () => {
  it('a five-finger exercise stops at Medium: the same notes, but the keys have to be let go', () => {
    expect(levelsOf([0, 1, 2, 3, 4, 5, 6, 7, 8].map((b, i): N => [b, 60 + (i < 5 ? i : 8 - i) * 2, 1]))).toEqual([['easy', 9], ['medium', 9]]);
    expect(bundled('five-finger.mid').levels.map((l) => [l.level, l.noteCount])).toEqual([['easy', 9], ['medium', 9]]);
  });

  it('a melody in quarters and eighths has Easy and Medium', () => {
    expect(bundled('ode-to-joy.mid').levels.map((l) => [l.level, l.noteCount])).toEqual([['easy', 44], ['medium', 62]]);
    expect(bundled('twinkle.mid').levels.map((l) => l.level)).toEqual(['easy', 'medium']);
    expect(bundled('minuet-in-g.mid').levels.map((l) => l.level)).toEqual(['easy', 'medium']);
  });

  it('sixteenths add Hard', () => {
    const notes: N[] = Array.from({ length: 32 }, (_, i) => [i / 4, 60 + (i % 5), 0.2]);
    expect(levelsOf(notes)).toEqual([['easy', 8], ['medium', 16], ['hard', 32]]);
  });

  it('chords of more than three notes add Expert: a two-handed part has all four, and an Easy', () => {
    const notes: N[] = [];
    for (let b = 0; b < 8; b += 0.25) {
      notes.push([b, 72 + ((b * 4) % 5), 0.2]);
      if (b % 1 === 0) notes.push([b, 36, 1], [b, 48, 1], [b, 55, 1], [b, 60, 1]);
    }
    const levels = levelsOf(notes);
    expect(levels.map(([l]) => l)).toEqual(['easy', 'medium', 'hard', 'expert']);
    expect(levels[0]).toEqual(['easy', 8]); // one note a beat, whatever the part is
    expect(levels[3]![1]).toBe(notes.length);
  });

  it('chords alone add Hard (up to three notes) and Expert (more than three)', () => {
    const chords = (size: number): N[] => [0, 1, 2, 3].flatMap((b): N[] => [48, 55, 60, 64, 67 + b].slice(5 - size).map((p): N => [b, p, 1]));
    expect(levelsOf(chords(5))).toEqual([['easy', 4], ['medium', 4], ['hard', 12], ['expert', 20]]);
    expect(levelsOf(chords(2))).toEqual([['easy', 4], ['medium', 4], ['hard', 8]]);
    expect(levelsOf(chords(1))).toEqual([['easy', 4], ['medium', 4]]);
  });

  it('the levels of a part are always the first two, three or four: none is skipped', () => {
    const names = ['easy', 'medium', 'hard', 'expert'];
    for (const file of ['five-finger.mid', 'ode-to-joy.mid', 'twinkle.mid', 'minuet-in-g.mid']) {
      const got = bundled(file).levels.map((l) => l.level);
      expect(got).toEqual(names.slice(0, got.length));
      expect(got.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('the top level is always the full part, and the levels never shrink on the way up', () => {
    for (const file of ['five-finger.mid', 'ode-to-joy.mid', 'twinkle.mid', 'minuet-in-g.mid']) {
      const { song, def, levels } = bundled(file);
      expect(levels[0]!.level).toBe('easy');
      expect(levels.at(-1)!.noteCount).toBe(splitNotes(song, { parts: [def] }).player.length);
      expect(buildChart(song, { parts: [def], difficulty: levels.at(-1)!.level }).notes.length).toBe(buildChart(song, { parts: [def] }).notes.length);
      for (let i = 1; i < levels.length; i++) expect(levels[i]!.noteCount).toBeGreaterThanOrEqual(levels[i - 1]!.noteCount);
    }
  });
});

describe('resolveLevel', () => {
  it('plays the chosen level, or the nearest one below it that the part has', () => {
    const two: Difficulty[] = ['easy', 'medium'];
    expect((['easy', 'medium', 'hard', 'expert'] as const).map((d) => resolveLevel(d, two))).toEqual(['easy', 'medium', 'medium', 'medium']);
    const skip: Difficulty[] = ['easy', 'medium', 'expert'];
    expect(resolveLevel('hard', skip)).toBe('medium');
    expect(resolveLevel('expert', skip)).toBe('expert');
    expect(resolveLevel('hard', [])).toBe('hard');
  });
});

describe('levels in the results and the best scores', () => {
  it('the next step never names a level the part does not have', () => {
    const levels: Difficulty[] = ['easy', 'medium'];
    expect(suggestNextStep({ accuracy: 0.95, difficulty: 'easy', rate: 1, levels })).toMatchObject({ kind: 'harder', text: 'Try Medium' });
    expect(suggestNextStep({ accuracy: 0.95, difficulty: 'medium', rate: 1, levels })).toEqual({ kind: 'mastered', text: 'Mastered! Pick a new song' });
    expect(suggestNextStep({ accuracy: 0.3, difficulty: 'medium', rate: 0.5, levels })).toMatchObject({ kind: 'easier', difficulty: 'easy' });
    expect(suggestNextStep({ accuracy: 0.95, difficulty: 'medium', rate: 1, levels: ['easy', 'medium', 'expert'] })).toMatchObject({ text: 'Try Expert', difficulty: 'expert' });
  });

  it('the full part keeps the best-score key it always had, whatever its level is called', () => {
    const old = bestKey('ode', PART, undefined, 'normal', 1, false);
    expect(bestKey('ode', PART, undefined, 'normal', 1, false, 'expert')).toBe(old);
    expect(bestKey('ode', PART, undefined, 'normal', 1, false, 'easy')).not.toBe(old);
  });
});

const dir = process.env.MIDI_FIXTURES_DIR ?? join(process.cwd(), 'fixtures');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.midi?$/i.test(f)) : [];

describe.skipIf(files.length === 0)('golden: levels of every local file', () => {
  for (const file of files) {
    it(file, () => {
      const song = parseSong(new Uint8Array(readFileSync(join(dir, file))));
      const def = defaultPart(buildParts(song))!;
      const full = splitNotes(song, { parts: [def] }).player;
      const levels = offeredLevels(full, song);
      expect(levels.map((l) => l.level)).toEqual(['easy', 'medium', 'hard', 'expert'].slice(0, levels.length));
      expect(levels.length).toBeGreaterThanOrEqual(2);
      expect(levels.at(-1)!.noteCount).toBe(full.length);
      expect(levels[0]!.notesPerSec).toBeLessThanOrEqual(2);
      // above Medium every level adds notes
      for (let i = 2; i < levels.length; i++) expect(levels[i]!.noteCount).toBeGreaterThan(levels[i - 1]!.noteCount);
    });
  }
});
