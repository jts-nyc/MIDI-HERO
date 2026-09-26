import type { Part, PartId, SongData, SongNote } from '../types.ts';
import { partKey } from '../types.ts';

const CHORD_WINDOW = 0.03; // s: onsets closer than this count as one chord
const DUPLICATE_WINDOW = 0.01; // s
const DUPLICATE_RATIO = 0.9;

const MELODY_NAME = /vocal|melod|lead|piano|right|\bRH\b|sing|voice|solo|main|tune/i;
const DRUM_NAME = /drum|percus|kit/i;
const SFX_PROGRAM_MIN = 120;

export function isDrumChannel(song: SongData, channel: number): boolean {
  return channel === 9 || song.drumChannels.includes(channel);
}

/** Program in effect for a (track, channel) pair: first program change on that pair, else 0. */
export function programFor(song: SongData, id: PartId): number {
  const p = song.programs.find((x) => x.track === id.track && x.channel === id.channel);
  return p ? p.program : 0;
}

export function notesOf(song: SongData, id: PartId): SongNote[] {
  return song.notes.filter((n) => n.track === id.track && n.channel === id.channel);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i]!;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Groups onsets into chords (within CHORD_WINDOW). Returns [maxChord, monophonicRatio]. */
function chordStats(notes: SongNote[]): [number, number] {
  if (notes.length === 0) return [0, 1];
  let maxChord = 1;
  let mono = 0;
  let i = 0;
  while (i < notes.length) {
    const start = notes[i]!.time;
    let j = i + 1;
    while (j < notes.length && notes[j]!.time - start <= CHORD_WINDOW) j++;
    const size = j - i;
    if (size > maxChord) maxChord = size;
    if (size === 1) mono++;
    i = j;
  }
  // mono is chords-of-one; ratio over onsets
  return [maxChord, mono / notes.length];
}

export function buildParts(song: SongData): Part[] {
  const groups = new Map<string, SongNote[]>();
  for (const n of song.notes) {
    const key = `${n.track}:${n.channel}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(n);
  }
  const channelsPerTrack = new Map<number, Set<number>>();
  for (const key of groups.keys()) {
    const [t, c] = key.split(':').map(Number) as [number, number];
    let s = channelsPerTrack.get(t);
    if (!s) channelsPerTrack.set(t, (s = new Set()));
    s.add(c);
  }

  const parts: Part[] = [];
  for (const [key, notes] of groups) {
    const [track, channel] = key.split(':').map(Number) as [number, number];
    const id: PartId = { track, channel };
    const program = programFor(song, id);
    const trackName = song.trackNames[track] || '';
    const multi = (channelsPerTrack.get(track)?.size ?? 1) > 1;
    let name = trackName || `Track ${track + 1}`;
    if (multi) name += ` (ch ${channel + 1})`;
    const drums = isDrumChannel(song, channel) || (!trackName ? false : DRUM_NAME.test(trackName) && channel === 9);
    const kind: Part['kind'] = drums ? 'drums' : program >= SFX_PROGRAM_MIN ? 'sfx' : 'melodic';
    if (drums) name = trackName ? `${trackName} (Drums)` : 'Drums';

    const pitches = notes.map((n) => n.pitch).sort((a, b) => a - b);
    const firstNoteTime = notes[0]!.time;
    let lastNoteEnd = 0;
    for (const n of notes) lastNoteEnd = Math.max(lastNoteEnd, n.time + n.duration);
    const span = Math.max(1, lastNoteEnd - firstNoteTime);
    const [maxChord, monophonicRatio] = chordStats(notes);
    parts.push({
      ...id,
      key,
      name,
      program,
      kind,
      noteCount: notes.length,
      minPitch: pitches[0]!,
      maxPitch: pitches[pitches.length - 1]!,
      medianPitch: median(pitches),
      pitchSpread: percentile(pitches, 0.9) - percentile(pitches, 0.1),
      firstNoteTime,
      lastNoteEnd,
      notesPerSec: notes.length / span,
      maxChord,
      monophonicRatio,
      score: 0,
    });
  }

  parts.sort((a, b) => a.track - b.track || a.channel - b.channel);
  markDuplicates(song, parts, groups);
  const largest = Math.max(0, ...parts.filter((p) => p.kind === 'melodic').map((p) => p.noteCount));
  const length = songEnd(parts);
  for (const p of parts) p.score = scorePart(p, largest, length);
  return parts;
}

function markDuplicates(song: SongData, parts: Part[], groups: Map<string, SongNote[]>): void {
  const melodic = parts.filter((p) => p.kind === 'melodic');
  for (let i = 0; i < melodic.length; i++) {
    const a = melodic[i]!;
    if (a.duplicateOf) continue;
    const an = groups.get(a.key)!;
    for (let j = i + 1; j < melodic.length; j++) {
      const b = melodic[j]!;
      if (b.duplicateOf) continue;
      const bn = groups.get(b.key)!;
      if (matchRatio(an, bn) >= DUPLICATE_RATIO && matchRatio(bn, an) >= DUPLICATE_RATIO) {
        b.duplicateOf = a.key;
      }
    }
  }
  void song;
}

/** Fraction of onsets in `a` that have a same-pitch onset in `b` within DUPLICATE_WINDOW. */
export function matchRatio(a: SongNote[], b: SongNote[]): number {
  if (a.length === 0) return 0;
  let bi = 0;
  let matched = 0;
  for (const n of a) {
    while (bi < b.length && b[bi]!.time < n.time - DUPLICATE_WINDOW) bi++;
    for (let k = bi; k < b.length && b[k]!.time <= n.time + DUPLICATE_WINDOW; k++) {
      if (b[k]!.pitch === n.pitch) {
        matched++;
        break;
      }
    }
  }
  return matched / a.length;
}

/** GM programs that usually carry a melody: voices, brass, reeds, pipes, synth leads. */
const isMelodyProgram = (prg: number): boolean => (prg >= 52 && prg <= 55) || (prg >= 56 && prg <= 87);
const isKeysProgram = (prg: number): boolean => prg <= 7;

/**
 * Default-part heuristic: which part would a pianist want to play? Higher is better.
 * `largestCount` is the note count of the biggest melodic part in the song and
 * `songLength` the playable length in seconds; both give context for relative rules.
 */
export function scorePart(p: Part, largestCount: number, songLength: number): number {
  if (p.kind !== 'melodic') return Number.NEGATIVE_INFINITY;
  let s = 0;
  const keys = isKeysProgram(p.program);
  if (keys) s += 4;
  else if (isMelodyProgram(p.program)) s += 2;
  if (MELODY_NAME.test(p.name)) s += 3;
  s += 2 * p.monophonicRatio;
  if (p.medianPitch >= 60 && p.medianPitch <= 84) s += 2;
  else if ((p.medianPitch >= 52 && p.medianPitch < 60) || (p.medianPitch > 84 && p.medianPitch <= 92)) s += 1;
  if (p.medianPitch < 48) s -= 2;
  if (p.notesPerSec > 6) s -= p.notesPerSec - 6; // too dense to play
  if (p.notesPerSec < 1) s -= 1; // sparse stabs, not a melody
  if (p.maxChord >= 5 && !keys) s -= 1;
  if (p.noteCount < 10) s -= 3;
  if (largestCount > 0 && p.noteCount >= 0.25 * largestCount) s += 1; // substantial part
  if (songLength > 0 && p.firstNoteTime > 0.25 * songLength) s -= 1; // late entry: bridge or solo
  // Wide parts are hard on small keyboards. Keys parts get an extra octave because
  // a two-hand piano part is handled by the hand split.
  const allowance = keys ? 36 : 24;
  if (p.pitchSpread > allowance) s -= (p.pitchSpread - allowance) / 12;
  if (p.duplicateOf) s -= 5;
  return s;
}

export function defaultPart(parts: Part[]): Part | undefined {
  let best: Part | undefined;
  for (const p of parts) {
    if (p.kind !== 'melodic' || p.duplicateOf) continue;
    if (!best || p.score > best.score) best = p;
  }
  return best;
}

/** Where the music ends for playable purposes: last note end of melodic parts + 2 s. */
export function songEnd(parts: Part[]): number {
  let end = 0;
  for (const p of parts) if (p.kind === 'melodic') end = Math.max(end, p.lastNoteEnd);
  return end + 2;
}

export { partKey };
