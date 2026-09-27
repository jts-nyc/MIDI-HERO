import { describe, expect, it } from 'vitest';
import { withChoice, type StoredSong } from '../src/storage/db.ts';

describe('withChoice', () => {
  it("keeps a pack song's order, unlocks and added time when a play stores the part choice", () => {
    const song: StoredSong = {
      id: 'abc', name: 'Minuet', bytes: new Uint8Array([1]), parts: [], addedAt: 100,
      packName: 'Class', packIndex: 3, unlocks: true,
    };
    const next = withChoice(song, { parts: [{ track: 1, channel: 0 }], split: 60, timingPreset: 'normal', difficulty: 'medium', keyLevel: 'medium' });
    expect(next).toMatchObject({ packName: 'Class', packIndex: 3, unlocks: true, addedAt: 100, name: 'Minuet', difficulty: 'medium', keyLevel: 'medium', split: 60 });
    expect(next.parts).toEqual([{ track: 1, channel: 0 }]);
  });
});
