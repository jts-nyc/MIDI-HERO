import type { PartId } from '../types.ts';

export interface StoredSong {
  /** sha256 of the bytes */
  id: string;
  name: string;
  bytes: Uint8Array;
  parts: PartId[];
  split?: number;
  rate?: number;
  timingPreset?: string;
  difficulty?: string;
  /** level name in the best-score key: 'expert' for the full part, whatever that level is called for this song */
  keyLevel?: string;
  packName?: string;
  /** position in its pack, for the setlist order */
  packIndex?: number;
  /** the pack asks for levels to be unlocked in order (PackSettings.unlocks) */
  unlocks?: boolean;
  addedAt: number;
}

export interface BestScore {
  key: string;
  songId: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  at: number;
  /** the level played, by its own name (the key names the top level 'expert'); absent in older records */
  level?: string;
}

const DB_NAME = 'midihero';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('bests')) db.createObjectStore('bests', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export const putSong = (song: StoredSong): Promise<IDBValidKey> => tx('songs', 'readwrite', (s) => s.put(song));
export const getSong = (id: string): Promise<StoredSong | undefined> => tx('songs', 'readonly', (s) => s.get(id));
/** What a play changes on a stored song: the part choice. Everything else (pack order, unlocks, when it was added) stays. */
export type SongChoice = Pick<StoredSong, 'parts' | 'split' | 'timingPreset' | 'difficulty' | 'keyLevel'>;

export function withChoice(song: StoredSong, choice: SongChoice): StoredSong {
  return { ...song, ...choice };
}

/** Store the part choice on an imported song without touching its pack fields. */
export async function saveChoice(id: string, choice: SongChoice): Promise<void> {
  const song = await getSong(id);
  if (song) await putSong(withChoice(song, choice));
}
export const listSongs = (): Promise<StoredSong[]> => tx('songs', 'readonly', (s) => s.getAll());
export const deleteSong = (id: string): Promise<undefined> => tx('songs', 'readwrite', (s) => s.delete(id));

/**
 * Best-score key: song plus everything that changes difficulty. The full part keeps the key
 * it had before difficulty levels existed, so earlier bests still count: pass 'expert' for
 * the top level of a part, whatever it is called for that song.
 */
export function bestKey(songId: string, parts: PartId[], split: number | undefined, preset: string, rate: number, easy: boolean, difficulty = 'expert'): string {
  const rateBucket = Math.round(rate * 10) / 10;
  const key = [songId, parts.map((p) => `${p.track}:${p.channel}`).join('+'), split ?? '-', preset, rateBucket, easy ? 'easy' : 'exact'];
  if (difficulty !== 'expert') key.push(difficulty);
  return key.join('|');
}

/** What a best-score key says: the song, the playback-rate bucket, and the level suffix (null for the top level). */
export function parseBestKey(key: string): { songId: string; rate: number; level: string | null } {
  const parts = key.split('|');
  return { songId: parts[0] ?? '', rate: Number(parts[4]), level: parts[6] ?? null };
}

/** Every best score of a song, across parts, levels and settings. */
export const bestsForSong = (songId: string): Promise<BestScore[]> =>
  tx<BestScore[]>('bests', 'readonly', (s) => s.getAll()).then((all) => all.filter((b) => b.songId === songId));

export const getBest = (key: string): Promise<BestScore | undefined> => tx('bests', 'readonly', (s) => s.get(key));

/** Store if better than the existing best. Returns the stored (or existing) best. */
export async function recordBest(b: BestScore): Promise<{ best: BestScore; isNew: boolean }> {
  const existing = await getBest(b.key).catch(() => undefined);
  if (existing && existing.score >= b.score) return { best: existing, isNew: false };
  await tx('bests', 'readwrite', (s) => s.put(b));
  return { best: b, isNew: true };
}
