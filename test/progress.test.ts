// WP10: a pack as a setlist, stars per song, and levels unlocked in order.
import { describe, expect, it } from 'vitest';
import { songStars, starsByLevel, TOP_LEVEL, unlockedLevels, UNLOCK_STARS, type LevelBest } from '../src/game/results.ts';
import { bestKey, parseBestKey, selectionKey } from '../src/storage/db.ts';

const parts = [{ track: 1, channel: 0 }];

describe('best keys', () => {
  it('parse back to the song, the rate bucket and the level suffix', () => {
    expect(parseBestKey(bestKey('song', parts, undefined, 'normal', 0.75, false, 'medium'))).toEqual({ songId: 'song', selection: '1:0|-', rate: 0.8, level: 'medium' });
    expect(parseBestKey(bestKey('song', parts, 60, 'strict', 1, true))).toEqual({ songId: 'song', selection: '1:0|60', rate: 1, level: null });
    expect(parseBestKey(bestKey('song', parts, 60, 'strict', 1, true)).selection).toBe(selectionKey(parts, 60));
  });
});

describe('stars per song', () => {
  const b = (level: string, accuracy: number, rate = 1): LevelBest => ({ level, accuracy, rate });

  it('keeps the best per level, at full speed only', () => {
    const m = starsByLevel([b('easy', 0.8), b('easy', 0.9), b('medium', 0.99, 0.5), b(TOP_LEVEL, 0.6)]);
    expect([...m]).toEqual([['easy', 4], [TOP_LEVEL, 2]]);
  });

  it('names the level with the most stars, the higher one on a tie', () => {
    expect(songStars([b('easy', 0.96), b('medium', 0.9)])).toEqual({ stars: 5, level: 'easy' });
    expect(songStars([b('easy', 0.9), b('medium', 0.88)])).toEqual({ stars: 4, level: 'medium' });
    expect(songStars([b('easy', 0.9, 0.7)])).toBeNull();
    expect(songStars([])).toBeNull();
  });
});

describe('unlocks', () => {
  const levels = ['easy', 'medium', 'hard'] as const;
  it('offers everything when the pack does not unlock in order', () => {
    expect(unlockedLevels(levels, new Map(), false)).toEqual(['easy', 'medium', 'hard']);
  });

  it('offers the lowest, then each level once the one below has 4 stars', () => {
    expect(UNLOCK_STARS).toBe(4);
    expect(unlockedLevels(levels, new Map(), true)).toEqual(['easy']);
    expect(unlockedLevels(levels, new Map([['easy', 3]]), true)).toEqual(['easy']);
    expect(unlockedLevels(levels, new Map([['easy', 4]]), true)).toEqual(['easy', 'medium']);
    expect(unlockedLevels(levels, new Map([['easy', 5], ['medium', 4]]), true)).toEqual(['easy', 'medium', 'hard']);
    // stars on a higher level do not skip the one below
    expect(unlockedLevels(levels, new Map([['medium', 5]]), true)).toEqual(['easy']);
  });

  it('counts an old top-level best (no level stored) as the last level', () => {
    expect(unlockedLevels(['easy', 'medium'], new Map([[TOP_LEVEL, 5]]), true)).toEqual(['easy']);
    expect(unlockedLevels(['easy', 'medium', 'hard'], new Map([['easy', 4], [TOP_LEVEL, 5]]), true)).toEqual(['easy', 'medium']);
  });

  // Round 3: bests were pooled across parts, so 4 stars on the left hand opened Medium on the right.
  it('matches a best on the same parts picked in another order, and keeps stored keys as they were', () => {
    const a = { track: 1, channel: 0 }, b = { track: 2, channel: 0 };
    const stored = bestKey('song', [b, a], undefined, 'normal', 1, false, 'easy');
    expect(stored).toBe('song|2:0+1:0|-|normal|1|exact|easy'); // the key format bests are saved under
    const bests: LevelBest[] = [{ level: 'easy', accuracy: 0.9, rate: 1, selection: parseBestKey(stored).selection }];
    expect(unlockedLevels(levels, starsByLevel(bests, selectionKey([a, b], undefined)), true)).toEqual(['easy', 'medium']);
  });

  it('counts only the bests on the selected parts', () => {
    const left = selectionKey([{ track: 1, channel: 0 }], undefined);
    const right = selectionKey([{ track: 2, channel: 0 }], undefined);
    const bests: LevelBest[] = [
      { level: 'easy', accuracy: 0.9, rate: 1, selection: left },
      { level: 'easy', accuracy: 0.6, rate: 1, selection: right },
    ];
    expect(unlockedLevels(levels, starsByLevel(bests, right), true)).toEqual(['easy']);
    expect(unlockedLevels(levels, starsByLevel(bests, left), true)).toEqual(['easy', 'medium']);
    // the song list's stars still take the song's best across its parts
    expect(songStars(bests)).toEqual({ stars: 4, level: 'easy' });
  });
});
