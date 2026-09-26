import type { TimingPreset } from '../game/judge.ts';
import type { PartId } from '../types.ts';
import { parseSong } from './parse.ts';

export const PACK_FORMAT = 'midihero-pack';
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 10 * 1024 * 1024;

export interface PackSettings {
  kb?: 25 | 49 | 61 | 88;
  timing?: TimingPreset;
  names?: boolean;
  synth?: boolean;
}

export interface PackSong {
  /** sha256 of the MIDI bytes */
  id: string;
  title: string;
  midiBase64: string;
  defaultParts: PartId[];
  split?: number;
  timingPreset?: TimingPreset;
}

export interface Pack {
  format: typeof PACK_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  settings: PackSettings;
  songs: PackSong[];
}

export function encodeBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

export function decodeBase64(s: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('invalid base64');
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(bytes).buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface PackSongInput {
  title: string;
  bytes: Uint8Array;
  defaultParts: PartId[];
  split?: number;
  timingPreset?: TimingPreset;
}

export async function buildPack(name: string, settings: PackSettings, songs: PackSongInput[]): Promise<Pack> {
  const out: PackSong[] = [];
  for (const s of songs) {
    out.push({
      id: await sha256Hex(s.bytes),
      title: s.title,
      midiBase64: encodeBase64(s.bytes),
      defaultParts: s.defaultParts,
      ...(s.split !== undefined ? { split: s.split } : {}),
      ...(s.timingPreset ? { timingPreset: s.timingPreset } : {}),
    });
  }
  return { format: PACK_FORMAT, version: PACK_VERSION, name, createdAt: new Date().toISOString(), settings, songs: out };
}

export interface ValidatedSong {
  song: PackSong;
  bytes: Uint8Array;
}

export type PackValidation = { ok: true; pack: Pack; songs: ValidatedSong[] } | { ok: false; error: string };

const isPartId = (p: unknown): p is PartId =>
  !!p && typeof p === 'object' && Number.isInteger((p as PartId).track) && Number.isInteger((p as PartId).channel);

/** Validate a parsed pack object. Every song is decoded and parsed before any is accepted. */
export function validatePack(raw: unknown, jsonBytes = 0, maxBytes = PACK_MAX_BYTES): PackValidation {
  if (jsonBytes > maxBytes) return { ok: false, error: `Pack is too large (${(jsonBytes / 1048576).toFixed(1)} MB, limit ${maxBytes / 1048576} MB)` };
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a song pack' };
  const r = raw as Record<string, unknown>;
  if (r.format !== PACK_FORMAT) return { ok: false, error: 'Not a MIDI Hero song pack' };
  if (typeof r.version !== 'number' || Math.floor(r.version) !== PACK_VERSION) {
    return { ok: false, error: `Unsupported pack version ${String(r.version)} (this app reads version ${PACK_VERSION})` };
  }
  if (!Array.isArray(r.songs) || r.songs.length === 0) return { ok: false, error: 'Pack has no songs' };
  const settings: PackSettings = {};
  const rs = (r.settings ?? {}) as Record<string, unknown>;
  if ([25, 49, 61, 88].includes(Number(rs.kb))) settings.kb = Number(rs.kb) as PackSettings['kb'];
  if (rs.timing === 'strict' || rs.timing === 'normal' || rs.timing === 'relaxed') settings.timing = rs.timing;
  if (typeof rs.names === 'boolean') settings.names = rs.names;
  if (typeof rs.synth === 'boolean') settings.synth = rs.synth;

  const songs: ValidatedSong[] = [];
  for (let i = 0; i < r.songs.length; i++) {
    const s = r.songs[i] as Record<string, unknown>;
    const title = typeof s?.title === 'string' && s.title.trim() ? s.title : `Song ${i + 1}`;
    if (typeof s?.midiBase64 !== 'string') return { ok: false, error: `"${title}" has no MIDI data` };
    let bytes: Uint8Array;
    try {
      bytes = decodeBase64(s.midiBase64);
    } catch {
      return { ok: false, error: `"${title}" has corrupt MIDI data` };
    }
    try {
      parseSong(bytes);
    } catch (e) {
      return { ok: false, error: `"${title}" is not a valid MIDI file: ${e instanceof Error ? e.message : String(e)}` };
    }
    const defaultParts = Array.isArray(s.defaultParts) ? s.defaultParts.filter(isPartId) : [];
    const song: PackSong = {
      id: typeof s.id === 'string' ? s.id : '',
      title,
      midiBase64: s.midiBase64,
      defaultParts,
      ...(typeof s.split === 'number' ? { split: s.split } : {}),
      ...(s.timingPreset === 'strict' || s.timingPreset === 'normal' || s.timingPreset === 'relaxed' ? { timingPreset: s.timingPreset } : {}),
    };
    songs.push({ song, bytes });
  }
  const pack: Pack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    name: typeof r.name === 'string' && r.name.trim() ? r.name : 'Song pack',
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
    settings,
    songs: songs.map((s) => s.song),
  };
  return { ok: true, pack, songs };
}

export function parsePackJson(text: string): PackValidation {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Pack file is not valid JSON' };
  }
  return validatePack(raw, text.length);
}
