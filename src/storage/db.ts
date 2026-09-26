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
  packName?: string;
  addedAt: number;
}

export interface BestScore {
  key: string;
  songId: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  at: number;
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
export const listSongs = (): Promise<StoredSong[]> => tx('songs', 'readonly', (s) => s.getAll());
export const deleteSong = (id: string): Promise<undefined> => tx('songs', 'readwrite', (s) => s.delete(id));

/** Best-score key: song plus everything that changes difficulty. */
export function bestKey(songId: string, parts: PartId[], split: number | undefined, preset: string, rate: number, easy: boolean): string {
  const rateBucket = Math.round(rate * 10) / 10;
  return [songId, parts.map((p) => `${p.track}:${p.channel}`).join('+'), split ?? '-', preset, rateBucket, easy ? 'easy' : 'exact'].join('|');
}

export const getBest = (key: string): Promise<BestScore | undefined> => tx('bests', 'readonly', (s) => s.get(key));

/** Store if better than the existing best. Returns the stored (or existing) best. */
export async function recordBest(b: BestScore): Promise<{ best: BestScore; isNew: boolean }> {
  const existing = await getBest(b.key).catch(() => undefined);
  if (existing && existing.score >= b.score) return { best: existing, isNew: false };
  await tx('bests', 'readwrite', (s) => s.put(b));
  return { best: b, isNew: true };
}
