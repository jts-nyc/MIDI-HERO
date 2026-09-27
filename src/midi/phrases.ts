/** Phrases of a part, and which of them are star phrases. Pure. */

import type { BeatGrid } from './difficulty.ts';

/** A stretch of the song, in ticks: [startTick, endTick). Spans follow each other without gaps. */
export interface PhraseSpan {
  startTick: number;
  endTick: number;
}

export interface Phrase {
  /** time of the first and the last chart note, in seconds */
  start: number;
  end: number;
  /** ids of the first and the last chart note */
  first: number;
  last: number;
  star: boolean;
}

const EPS = 1e-6;
const REST_BEATS = 1; // a rest this long ends a phrase
const LONG_RUN_BARS = 4; // a run without rests longer than this is cut ...
const WINDOW_BARS = 2; // ... into windows of this many bars
const MIN_NOTES = 3; // a phrase the player is asked fewer notes of joins its neighbour

/**
 * Split a part into phrases: runs of notes between rests of a beat or more. A run
 * that goes on for more than four bars without a rest (a part with no rests at all
 * is one such run) is cut into two-bar windows on the bar lines.
 * `notes` is the full part, sorted by tick.
 */
export function phraseSpans(notes: readonly { tick: number; endTick: number }[], grid: BeatGrid): PhraseSpan[] {
  if (notes.length === 0) return [];
  const starts: number[] = [notes[0]!.tick];
  let runStart = notes[0]!.tick;
  let runEnd = notes[0]!.endTick;
  const closeRun = (endTick: number): void => {
    // cut a long run on every second bar line
    const from = grid.beatOf(runStart);
    const to = grid.beatOf(endTick);
    const perBar = grid.beatsPerBar(from);
    if (to - from <= LONG_RUN_BARS * perBar + EPS) return;
    const barStart = Math.floor(from + EPS) - grid.beatInBar(from);
    for (let b = barStart + WINDOW_BARS * perBar; b < to - EPS; b += WINDOW_BARS * perBar) {
      if (b > from + EPS) starts.push(Math.round(grid.tickOf(b)));
    }
  };
  for (let i = 1; i < notes.length; i++) {
    const n = notes[i]!;
    if (grid.beatOf(n.tick) - grid.beatOf(runEnd) >= REST_BEATS - EPS) {
      closeRun(runEnd);
      starts.push(n.tick);
      runStart = n.tick;
      runEnd = n.endTick;
    } else if (n.endTick > runEnd) runEnd = n.endTick;
  }
  closeRun(runEnd);
  starts.sort((a, b) => a - b);
  return starts.map((startTick, i) => ({ startTick, endTick: starts[i + 1] ?? Number.POSITIVE_INFINITY }));
}

/**
 * How often a phrase is a star phrase. Every 4th in a song of normal length; more often
 * in a short one, so that star power (two clean star phrases) can be reached at all.
 */
export function starEvery(phraseCount: number): number {
  return phraseCount >= 16 ? 4 : phraseCount >= 9 ? 3 : 2;
}

/**
 * Assign chart notes to phrases and mark the star phrases. Sets `phrase` and `star`
 * on the notes. Phrases with fewer than three chart notes join the phrase before them.
 */
export function markPhrases(
  notes: { id: number; tick: number; time: number; phrase?: number; star?: boolean }[],
  spans: readonly PhraseSpan[],
): Phrase[] {
  const groups: number[][] = [];
  let s = 0;
  let current: number[] | null = null;
  let currentSpan = -1;
  for (const n of notes) {
    while (s + 1 < spans.length && n.tick >= spans[s]!.endTick) s++;
    if (s !== currentSpan || !current) {
      current = [];
      groups.push(current);
      currentSpan = s;
    }
    current.push(n.id);
  }
  // short phrases join the one before (the first joins the one after)
  const merged: number[][] = [];
  for (const g of groups) {
    const prev = merged[merged.length - 1];
    if (prev && (g.length < MIN_NOTES || prev.length < MIN_NOTES)) prev.push(...g);
    else merged.push(g);
  }
  const every = starEvery(merged.length);
  return merged.map((ids, i) => {
    const star = ids.length >= MIN_NOTES && (i + 1) % every === 0;
    for (const id of ids) {
      const n = notes[id]!;
      n.phrase = i;
      if (star) n.star = true;
    }
    const first = ids[0]!;
    const last = ids[ids.length - 1]!;
    return { start: notes[first]!.time, end: notes[last]!.time, first, last, star };
  });
}
