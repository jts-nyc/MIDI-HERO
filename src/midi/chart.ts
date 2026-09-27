import type { PartId, SongData, SongNote } from '../types.ts';
import { partKey } from '../types.ts';
import { simplify, type Difficulty } from './difficulty.ts';

export { DIFFICULTIES, DIFFICULTY_LABEL, isDifficulty, levelStats, simplify, type Difficulty, type LevelStats } from './difficulty.ts';

export type Hand = 'L' | 'R';

/** A note of the player's part that the difficulty level removed; it sounds when its carrier is hit. */
export interface CarriedNote {
  time: number;
  duration: number;
  /** pitch in the file */
  pitch: number;
  velocity: number;
  partKey: string;
}

export interface ChartNote {
  /** index in Chart.notes */
  id: number;
  time: number;
  duration: number;
  tick: number;
  /** pitch the player must play (after folding) */
  pitch: number;
  /** pitch in the file */
  origPitch: number;
  folded: boolean;
  hand: Hand;
  partKey: string;
  velocity: number;
  /** removed notes between this note and the next one; the player earns them by hitting this note */
  carry?: CarriedNote[];
}

export interface PitchWindow {
  low: number;
  high: number;
}

export type FoldMode = 'fold' | 'drop';

export interface ChartOptions {
  parts: PartId[];
  /** For a single two-hand part: notes at or above this pitch are the right hand. */
  split?: number;
  /** Which hands to include. Default both. */
  hands?: Hand[];
  /** Physical or virtual window notes must land in. null = no folding. */
  window?: PitchWindow | null;
  foldMode?: FoldMode;
  /** Default 'expert': the full part. */
  difficulty?: Difficulty;
  /**
   * Where the notes removed by the difficulty level go. 'carry' (default) attaches them to the
   * chart notes so they sound when the player hits; 'backing' lets the band play them always
   * (for feedback modes that do not sound chart notes).
   */
  removed?: 'carry' | 'backing';
}

export type BackingEventType = 'on' | 'off' | 'cc' | 'bend' | 'program';

export interface BackingEvent {
  time: number;
  type: BackingEventType;
  track: number;
  channel: number;
  partKey: string;
  pitch: number;
  velocity: number;
  controller: number;
  value: number;
}

export interface Chart {
  notes: ChartNote[];
  minPitch: number;
  maxPitch: number;
  window: PitchWindow | null;
  /** fraction of chart notes that were folded */
  foldedRatio: number;
  /** notes dropped or merged away */
  droppedCount: number;
  backing: BackingEvent[];
  /** playable end in seconds (last player or backing melodic note end + 2) */
  duration: number;
  firstNoteTime: number;
  maxDuration: number;
}

const COLLISION_WINDOW = 0.03; // s

/** Pick the C-aligned window of `span` semitones (e.g. 24 for 25 keys) covering the most notes. */
export function chooseWindow(pitches: number[], span: number): PitchWindow {
  if (pitches.length === 0) return { low: 60 - 12, high: 60 - 12 + span };
  const sorted = [...pitches].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  let best: PitchWindow | null = null;
  let bestCount = -1;
  let bestDist = Infinity;
  for (let low = 0; low + span <= 127; low += 12) {
    const high = low + span;
    let count = 0;
    for (const p of sorted) if (p >= low && p <= high) count++;
    const dist = Math.abs((low + high) / 2 - median);
    if (count > bestCount || (count === bestCount && dist < bestDist)) {
      best = { low, high };
      bestCount = count;
      bestDist = dist;
    }
  }
  return best!;
}

/** Fold a pitch by octaves into the window. Returns null if the window is narrower than an octave and the pitch cannot fit. */
export function foldPitch(pitch: number, w: PitchWindow): number | null {
  if (pitch >= w.low && pitch <= w.high) return pitch;
  if (w.high - w.low < 11) return null;
  let p = pitch;
  while (p < w.low) p += 12;
  while (p > w.high) p -= 12;
  return p >= w.low ? p : null;
}

const handOf = (n: SongNote, split: number | undefined): Hand => (split === undefined ? 'R' : n.pitch >= split ? 'R' : 'L');

/** The notes the player is asked to play, before difficulty and folding, and everything else. */
export function splitNotes(song: SongData, opts: Pick<ChartOptions, 'parts' | 'split' | 'hands'>): { player: SongNote[]; backing: SongNote[] } {
  const selected = new Set(opts.parts.map(partKey));
  const hands = new Set<Hand>(opts.hands ?? ['L', 'R']);
  const player: SongNote[] = [];
  const backing: SongNote[] = [];
  for (const n of song.notes) {
    const key = `${n.track}:${n.channel}`;
    if (selected.has(key) && hands.has(handOf(n, opts.split))) player.push(n);
    else backing.push(n);
  }
  return { player, backing };
}

export function buildChart(song: SongData, opts: ChartOptions): Chart {
  const split = opts.split;
  const window = opts.window ?? null;
  const foldMode = opts.foldMode ?? 'fold';

  const { player: fullPart, backing: backingNotes } = splitNotes(song, opts);
  const playerNotes = simplify(fullPart, opts.difficulty ?? 'expert', song);
  const kept = new Set(playerNotes);
  const removed = playerNotes.length === fullPart.length ? [] : fullPart.filter((n) => !kept.has(n));

  // Fold / drop
  let dropped = 0;
  let foldedCount = 0;
  const raw: ChartNote[] = [];
  for (const n of playerNotes) {
    let pitch = n.pitch;
    let folded = false;
    if (window) {
      const f = foldPitch(n.pitch, window);
      if (f === null || (foldMode === 'drop' && f !== n.pitch)) {
        dropped++;
        continue;
      }
      folded = f !== n.pitch;
      if (folded) foldedCount++;
      pitch = f;
    }
    raw.push({
      id: 0, time: n.time, duration: n.duration, tick: n.tick, pitch, origPitch: n.pitch, folded,
      hand: handOf(n, split), partKey: `${n.track}:${n.channel}`, velocity: n.velocity,
    });
  }
  raw.sort((a, b) => a.time - b.time || a.pitch - b.pitch);

  // Merge collisions: same (folded) pitch within COLLISION_WINDOW → one note.
  const notes: ChartNote[] = [];
  const lastByPitch = new Map<number, ChartNote>();
  for (const n of raw) {
    const prev = lastByPitch.get(n.pitch);
    if (prev && n.time - prev.time <= COLLISION_WINDOW) {
      prev.duration = Math.max(prev.duration, n.time + n.duration - prev.time);
      prev.folded = prev.folded && n.folded;
      dropped++;
      continue;
    }
    notes.push(n);
    lastByPitch.set(n.pitch, n);
  }
  notes.forEach((n, i) => (n.id = i));

  // Removed notes ride on the chart note before them (chord mates on the one they belong to).
  if (removed.length) {
    if (opts.removed === 'backing' || notes.length === 0) backingNotes.push(...removed);
    else {
      let carrier = -1;
      for (const r of removed) {
        while (carrier + 1 < notes.length && notes[carrier + 1]!.time <= r.time + COLLISION_WINDOW) carrier++;
        if (carrier < 0) {
          backingNotes.push(r); // before the player's first note: the band plays it
          continue;
        }
        const c = notes[carrier]!;
        (c.carry ??= []).push({ time: r.time, duration: r.duration, pitch: r.pitch, velocity: r.velocity, partKey: `${r.track}:${r.channel}` });
      }
    }
  }

  let minPitch = 127;
  let maxPitch = 0;
  let maxDuration = 0;
  let lastEnd = 0;
  for (const n of notes) {
    if (n.pitch < minPitch) minPitch = n.pitch;
    if (n.pitch > maxPitch) maxPitch = n.pitch;
    if (n.duration > maxDuration) maxDuration = n.duration;
    lastEnd = Math.max(lastEnd, n.time + n.duration);
  }
  if (notes.length === 0) {
    minPitch = window?.low ?? 60;
    maxPitch = window?.high ?? 72;
  }

  const backing = buildBacking(song, backingNotes);
  for (const n of backingNotes) if (!(n.channel === 9 || song.drumChannels.includes(n.channel))) lastEnd = Math.max(lastEnd, n.time + n.duration);

  return {
    notes,
    minPitch,
    maxPitch,
    window,
    foldedRatio: notes.length ? foldedCount / (notes.length + dropped) : 0,
    droppedCount: dropped,
    backing,
    duration: lastEnd + 2,
    firstNoteTime: notes[0]?.time ?? 0,
    maxDuration,
  };
}

function buildBacking(song: SongData, notes: SongNote[]): BackingEvent[] {
  const ev: BackingEvent[] = [];
  const base = (n: { track: number; channel: number }) => ({ track: n.track, channel: n.channel, partKey: `${n.track}:${n.channel}` });
  for (const n of notes) {
    ev.push({ time: n.time, type: 'on', ...base(n), pitch: n.pitch, velocity: n.velocity, controller: -1, value: 0 });
    ev.push({ time: n.time + n.duration, type: 'off', ...base(n), pitch: n.pitch, velocity: 0, controller: -1, value: 0 });
  }
  for (const p of song.programs) ev.push({ time: p.time, type: 'program', ...base(p), pitch: -1, velocity: 0, controller: -1, value: p.program });
  for (const c of song.controls) {
    ev.push({ time: c.time, type: c.kind === 'cc' ? 'cc' : 'bend', ...base(c), pitch: -1, velocity: 0, controller: c.controller, value: c.value });
  }
  const order: Record<BackingEventType, number> = { off: 0, program: 1, cc: 2, bend: 3, on: 4 };
  ev.sort((a, b) => a.time - b.time || order[a.type] - order[b.type]);
  return ev;
}
