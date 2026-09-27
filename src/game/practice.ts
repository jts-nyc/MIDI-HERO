/**
 * Practice mode, the pure part (docs/HANDOFF-next.md, WP9): sections to pick from, the chart
 * trimmed to an A–B loop, the pass counter with its speed ladder, and the wait-mode gate.
 * The session drives it; nothing here touches the DOM or the clock.
 */

import type { Chart, ChartNote, Phrase } from '../midi/chart.ts';
import type { PracticeSection } from '../render/practice.ts';
import type { Counts, NoteState } from './judge.ts';
import { buildSections, RATES } from './results.ts';

export interface Loop {
  start: number;
  end: number;
}

export interface PracticeSectionInfo extends PracticeSection {
  fromBar: number;
  toBar: number;
  /** chart notes that start in the section */
  notes: number;
  notesPerSec: number;
}

/** In the loop: starts at or after A and before B. The last section runs to the end of the song. */
export const inLoop = (time: number, loop: Loop): boolean => time >= loop.start && time < loop.end;

/** The 8-bar sections of a song that have notes to play, with their note counts, in song order. */
export function practiceSections(barTimes: readonly number[], duration: number, notes: readonly { time: number }[]): PracticeSectionInfo[] {
  const sections = buildSections(barTimes, duration);
  const out: PracticeSectionInfo[] = [];
  sections.forEach((s, i) => {
    const end = i === sections.length - 1 ? Math.max(s.end, duration) + 1 : s.end;
    let count = 0;
    for (const n of notes) if (n.time >= s.start && n.time < end) count++;
    if (count === 0) return;
    const label = s.fromBar === s.toBar ? `Bar ${s.fromBar}` : `Bars ${s.fromBar}–${s.toBar}`;
    out.push({ start: s.start, end: s.end, label, fromBar: s.fromBar, toBar: s.toBar, notes: count, notesPerSec: s.end > s.start ? count / (s.end - s.start) : 0 });
  });
  return out;
}

/** The A–B loop over a run of adjacent sections, `from` to `to` inclusive (either order). */
export function loopOf(sections: readonly PracticeSection[], from: number, to: number): Loop {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(sections.length - 1, Math.max(from, to));
  return { start: sections[a]!.start, end: sections[b]!.end };
}

/** "Bars 9–16" for one section, "Bars 9–24" for a run. */
export function loopLabel(sections: readonly PracticeSectionInfo[], from: number, to: number): string {
  const a = Math.max(0, Math.min(from, to));
  const b = Math.min(sections.length - 1, Math.max(from, to));
  if (a === b) return sections[a]!.label;
  return `Bars ${sections[a]!.fromBar}–${sections[b]!.toBar}`;
}

/**
 * The chart with only the notes of the loop, re-indexed, phrases cut to fit. Backing, beats and
 * duration are kept, so the band and the highway are the song's; the judge sees the loop only.
 */
export function trimChart(chart: Chart, loop: Loop): Chart {
  const lo = chart.notes.findIndex((n) => inLoop(n.time, loop));
  if (lo < 0) return { ...chart, notes: [], phrases: [] };
  let hi = lo;
  while (hi + 1 < chart.notes.length && inLoop(chart.notes[hi + 1]!.time, loop)) hi++;
  const phrases: Phrase[] = [];
  const phraseIndex = new Map<number, number>();
  chart.phrases.forEach((p, i) => {
    const first = Math.max(p.first, lo) - lo;
    const last = Math.min(p.last, hi) - lo;
    if (first > last) return;
    phraseIndex.set(i, phrases.length);
    phrases.push({ ...p, first, last });
  });
  const notes: ChartNote[] = [];
  for (let i = lo; i <= hi; i++) {
    const n = chart.notes[i]!;
    const copy: ChartNote = { ...n, id: i - lo };
    if (n.phrase !== undefined) {
      const p = phraseIndex.get(n.phrase);
      if (p === undefined) delete copy.phrase;
      else copy.phrase = p;
    }
    if (n.carry) copy.carry = n.carry.filter((c) => inLoop(c.time, loop));
    notes.push(copy);
  }
  return { ...chart, notes, phrases, firstNoteTime: notes[0]!.time };
}

// ---------------------------------------------------------------------------
// Passes and the speed ladder
// ---------------------------------------------------------------------------
/** Clean passes in a row before the ladder steps up one entry of RATES. */
export const CLEAN_TO_STEP_UP = 2;
/** Failed passes in a row before it steps down. */
export const FAILED_TO_STEP_DOWN = 2;

export interface PracticeRun {
  passes: number;
  cleanPasses: number;
  /** index into RATES */
  rateIndex: number;
  /** clean and failed passes in a row, for the ladder */
  cleanRun: number;
  failedRun: number;
  ladder: boolean;
}

/** The RATES entry nearest at or below `rate` (the top entry for anything faster). */
export function rateIndexOf(rate: number): number {
  let i = 0;
  for (let k = 0; k < RATES.length; k++) if (RATES[k]! <= rate + 1e-9) i = k;
  return i;
}

export function startRun(rate: number, ladder: boolean): PracticeRun {
  return { passes: 0, cleanPasses: 0, rateIndex: rateIndexOf(rate), cleanRun: 0, failedRun: 0, ladder };
}

export const runRate = (run: PracticeRun): number => RATES[run.rateIndex]!;

/**
 * A pass is clean when nothing was missed, played late, or wrong. In wait mode there is no
 * timing judgment (`hitOnly`), so only misses and wrong notes count against it.
 */
export const isCleanPass = (c: Pick<Counts, 'miss' | 'late' | 'wrong'>, hitOnly = false): boolean => c.miss + (hitOnly ? 0 : c.late) + c.wrong === 0;

/**
 * Count a finished pass. With the ladder on, two clean passes in a row step the rate up one
 * entry, two failed passes in a row step it down; a step resets both runs.
 */
export function endPass(run: PracticeRun, clean: boolean): PracticeRun {
  const next: PracticeRun = { ...run, passes: run.passes + 1, cleanPasses: run.cleanPasses + (clean ? 1 : 0) };
  if (clean) {
    next.cleanRun = run.cleanRun + 1;
    next.failedRun = 0;
  } else {
    next.failedRun = run.failedRun + 1;
    next.cleanRun = 0;
  }
  if (!run.ladder) return next;
  if (next.cleanRun >= CLEAN_TO_STEP_UP) {
    next.cleanRun = 0;
    next.rateIndex = Math.min(RATES.length - 1, run.rateIndex + 1);
  } else if (next.failedRun >= FAILED_TO_STEP_DOWN) {
    next.failedRun = 0;
    next.rateIndex = Math.max(0, run.rateIndex - 1);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Wait mode
// ---------------------------------------------------------------------------
/** Notes closer than this in time are one onset (a chord). */
export const ONSET_EPS = 1e-3;

/**
 * Index of the first pending note that has reached the hit line (time <= now), searching from
 * `from`; -1 when none has. Notes are in time order.
 */
export function nextHold(notes: readonly { time: number }[], states: readonly NoteState[], now: number, from = 0): number {
  for (let i = Math.max(0, from); i < notes.length; i++) {
    if (states[i] !== 'pending') continue;
    return notes[i]!.time <= now ? i : -1;
  }
  return -1;
}

/** Pitches still owed at the onset `at`: the pending notes of that onset, in chart pitch (folded). */
export function owedPitches(notes: readonly { time: number; pitch: number }[], states: readonly NoteState[], at: number, out: number[] = []): number[] {
  out.length = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i]!;
    if (n.time < at - ONSET_EPS) continue;
    if (n.time > at + ONSET_EPS) break;
    if (states[i] === 'pending' && !out.includes(n.pitch)) out.push(n.pitch);
  }
  return out;
}
