import type { SongData } from '../types.ts';
import { tempoAt } from './parse.ts';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';

export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard', expert: 'Expert' };

export const isDifficulty = (v: unknown): v is Difficulty => v === 'easy' || v === 'medium' || v === 'hard' || v === 'expert';

/** What simplification needs to know about a note. SongNote and ChartNote both fit. */
export interface GridNote {
  tick: number;
  time: number;
  duration: number;
  pitch: number;
}

export type Timing = Pick<SongData, 'ppq' | 'tempoMap' | 'timeSigs'>;

const CHORD_WINDOW = 0.03; // s: onsets closer than this are one chord
const ON_GRID = 1 / 8; // beats: how far from a grid point still counts as on it
const EPS = 1e-6;
/** Shortest real-time distance between two notes, per level. Easy never exceeds two notes a second. */
const MIN_GAP: Record<Difficulty, number> = { easy: 0.5, medium: 0.2, hard: 0, expert: 0 };
const HARD_CHORD = 3;

interface Segment {
  tick: number;
  beatTicks: number;
  beatsPerBar: number;
  /** index of the first beat of this segment, counted from the song start */
  firstBeat: number;
}

/** The beat grid of a song: felt beats (dotted quarters in 6/8, 9/8, 12/8) and their strength in the bar. */
export class BeatGrid {
  private readonly segments: Segment[] = [];
  private readonly song: Timing;

  constructor(song: Timing) {
    this.song = song;
    const sigs = song.timeSigs.length ? song.timeSigs : [{ tick: 0, seconds: 0, numerator: 4, denominator: 4 }];
    for (const sig of sigs) {
      const compound = sig.denominator === 8 && sig.numerator % 3 === 0 && sig.numerator > 3;
      const beatTicks = compound ? song.ppq * 1.5 : (song.ppq * 4) / sig.denominator;
      const beatsPerBar = compound ? sig.numerator / 3 : sig.numerator;
      const prev = this.segments[this.segments.length - 1];
      const firstBeat = prev ? prev.firstBeat + Math.ceil((sig.tick - prev.tick) / prev.beatTicks - EPS) : 0;
      this.segments.push({ tick: sig.tick, beatTicks, beatsPerBar, firstBeat });
    }
  }

  private segmentAtTick(tick: number): Segment {
    let s = this.segments[0]!;
    for (const seg of this.segments) {
      if (seg.tick > tick) break;
      s = seg;
    }
    return s;
  }

  private segmentAtBeat(beat: number): Segment {
    let s = this.segments[0]!;
    for (const seg of this.segments) {
      if (seg.firstBeat > beat) break;
      s = seg;
    }
    return s;
  }

  /** Position of a tick in beats from the start of the song. */
  beatOf(tick: number): number {
    const s = this.segmentAtTick(tick);
    return s.firstBeat + (tick - s.tick) / s.beatTicks;
  }

  /** Tick of a (fractional) beat position. */
  tickOf(beat: number): number {
    const s = this.segmentAtBeat(beat);
    return s.tick + (beat - s.firstBeat) * s.beatTicks;
  }

  /** Length of one beat at this tick, in seconds. */
  beatSeconds(tick: number): number {
    const s = this.segmentAtTick(tick);
    return ((tempoAt(this.song.tempoMap, tick).usPerBeat / 1e6) * s.beatTicks) / this.song.ppq;
  }

  beatsPerBar(beat: number): number {
    return this.segmentAtBeat(beat).beatsPerBar;
  }

  /** Beat index inside its bar, 0-based. */
  beatInBar(beat: number): number {
    const s = this.segmentAtBeat(beat);
    const i = Math.floor(beat + EPS) - s.firstBeat;
    return ((i % s.beatsPerBar) + s.beatsPerBar) % s.beatsPerBar;
  }

  /** 3 = downbeat, 2 = the middle of an even bar, 1 = any other beat, 0 = between beats. */
  strength(beat: number): number {
    if (Math.abs(beat - Math.round(beat)) > ON_GRID) return 0;
    const s = this.segmentAtBeat(Math.round(beat));
    const i = this.beatInBar(Math.round(beat));
    if (i === 0) return 3;
    if (s.beatsPerBar >= 4 && s.beatsPerBar % 2 === 0 && i === s.beatsPerBar / 2) return 2;
    return 1;
  }
}

/** Groups notes (sorted by time) into chords: onsets within CHORD_WINDOW of the first. */
export function chordGroups<T extends GridNote>(notes: readonly T[]): T[][] {
  const out: T[][] = [];
  let group: T[] = [];
  for (const n of notes) {
    if (group.length && n.time - group[0]!.time > CHORD_WINDOW) {
      out.push(group);
      group = [];
    }
    group.push(n);
  }
  if (group.length) out.push(group);
  return out;
}

const topOf = <T extends GridNote>(group: readonly T[]): T => group.reduce((a, b) => (b.pitch > a.pitch ? b : a));

/**
 * Reduce a part to a difficulty level by removing notes (never by loosening timing).
 *
 *  - easy:   at most one note per beat, on the beat; the top note of a chord; no notes
 *            shorter than 1/8 beat; of two neighbouring beats with the same pitch the
 *            weaker beat goes; never more than two notes a second.
 *  - medium: at most one note per half-beat; the top note of a chord; off-grid notes
 *            (syncopations) stay when they last at least 1/4 beat.
 *  - hard:   the full part with chords cut to their top three notes.
 *  - expert: the full part.
 *
 * `notes` must be sorted by time. Returns the kept notes, same objects, same order.
 */
export function simplify<T extends GridNote>(notes: readonly T[], level: Difficulty, song: Timing): T[] {
  if (level === 'expert') return [...notes];
  if (level === 'hard') {
    const keep = new Set<T>();
    for (const g of chordGroups(notes)) {
      const top = g.length > HARD_CHORD ? [...g].sort((a, b) => b.pitch - a.pitch).slice(0, HARD_CHORD) : g;
      for (const n of top) keep.add(n);
    }
    return notes.filter((n) => keep.has(n));
  }

  const grid = new BeatGrid(song);
  const div = level === 'easy' ? 1 : 2;
  interface Pick_ { note: T; slot: number; dist: number; on: boolean }
  const slots = new Map<number, Pick_>();
  for (const g of chordGroups(notes)) {
    const first = g[0]!;
    const beatSec = grid.beatSeconds(first.tick);
    const pool = level === 'easy' ? g.filter((n) => n.duration >= beatSec / 8 - EPS) : g;
    if (pool.length === 0) continue;
    const note = topOf(pool);
    const pos = grid.beatOf(first.tick) * div;
    const slot = Math.round(pos);
    const dist = Math.abs(pos - slot) / div;
    const on = dist <= ON_GRID + EPS;
    if (!on && (level === 'easy' || note.duration < beatSec / 4 - EPS)) continue;
    const cur = slots.get(slot);
    if (!cur || (on && !cur.on) || (on === cur.on && dist < cur.dist - EPS)) slots.set(slot, { note, slot, dist, on });
  }
  let picks = [...slots.values()].sort((a, b) => a.note.time - b.note.time);

  const strengthOf = (p: Pick_): number => (p.on ? grid.strength(p.slot / div) : 0);
  /** Walk the picks; whenever `clash` says two neighbours cannot both stay, the weaker one goes (the later on a tie). */
  const thin = (clash: (a: Pick_, b: Pick_) => boolean): void => {
    const out: Pick_[] = [];
    for (const p of picks) {
      let cur: Pick_ | null = p;
      while (cur && out.length && clash(out[out.length - 1]!, cur)) {
        const prev: Pick_ = out[out.length - 1]!;
        if (strengthOf(cur) > strengthOf(prev)) out.pop();
        else cur = null;
      }
      if (cur) out.push(cur);
    }
    picks = out;
  };
  if (level === 'easy') thin((a, b) => a.note.pitch === b.note.pitch && b.slot - a.slot <= div);
  const gap = MIN_GAP[level];
  if (gap > 0) thin((a, b) => b.note.time - a.note.time < gap - EPS);

  const keep = new Set<T>(picks.map((p) => p.note));
  return notes.filter((n) => keep.has(n));
}

export interface LevelStats {
  level: Difficulty;
  noteCount: number;
  notesPerSec: number;
}

/** Note count and density of a part at every level. Density is over the span of the full part. */
export function levelStats(notes: readonly GridNote[], song: Timing): LevelStats[] {
  let end = 0;
  for (const n of notes) end = Math.max(end, n.time + n.duration);
  const span = Math.max(1, end - (notes[0]?.time ?? 0));
  return DIFFICULTIES.map((level) => {
    const noteCount = simplify(notes, level, song).length;
    return { level, noteCount, notesPerSec: noteCount / span };
  });
}
