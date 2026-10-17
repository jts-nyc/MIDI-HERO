/**
 * Learn mode: a new song opens with the song waiting at every note (practice.ts wait mode),
 * once through the whole song, until the student has passed it once. Scoring is one tap away.
 * Pure: the storage is passed in.
 */

export type PlayMode = 'learn' | 'score';

/** A scored play at this accuracy or better (two stars) also counts as passing the song. */
export const PASS_ACCURACY = 0.5;

export const LEARNED_KEY = 'midihero.learned.v1';

export interface LearnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const isPlayMode = (v: unknown): v is PlayMode => v === 'learn' || v === 'score';

/** The song ids passed on this device. */
export function learnedSongs(store: LearnStorage | null): Set<string> {
  try {
    const raw = JSON.parse(store?.getItem(LEARNED_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function markLearned(store: LearnStorage | null, songId: string): void {
  const all = learnedSongs(store);
  if (all.has(songId)) return;
  all.add(songId);
  try {
    store?.setItem(LEARNED_KEY, JSON.stringify([...all]));
  } catch {
    /* storage unavailable */
  }
}

/**
 * The mode a song opens in: the URL's choice, else learn until the song is passed. A song with
 * a scored best of PASS_ACCURACY or more was passed before learn mode existed.
 */
export function openingMode(o: { learned: boolean; bestAccuracy: number | null; urlMode?: PlayMode | null }): PlayMode {
  if (o.urlMode) return o.urlMode;
  if (o.learned || (o.bestAccuracy !== null && o.bestAccuracy >= PASS_ACCURACY)) return 'score';
  return 'learn';
}

/**
 * Whether a finished play passes the song. Learn mode: every note played, which in wait mode
 * means reaching the end, or pressing Stop only after the last note. Score mode: a whole-song
 * play, not failed, at PASS_ACCURACY.
 */
export function passesSong(mode: PlayMode, r: { total: number; judged: number; accuracy: number; failed: boolean; practice?: unknown }, autoplay = false): boolean {
  if (autoplay || r.total === 0) return false;
  if (mode === 'learn') return r.judged >= r.total;
  // A practice loop is a few bars of the song: it never passes the whole song.
  return !r.practice && !r.failed && r.judged >= r.total && r.accuracy >= PASS_ACCURACY;
}
