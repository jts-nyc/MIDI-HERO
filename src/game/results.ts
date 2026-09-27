/** What the results screen says beyond the raw counts: sections, stars, and what to do next. Pure. */

import type { Difficulty } from '../midi/difficulty.ts';
import { DIFFICULTIES, DIFFICULTY_LABEL } from '../midi/difficulty.ts';
import { WEIGHTS, type Judgment } from './judge.ts';

export interface Section {
  /** first and last bar, 1-based */
  fromBar: number;
  toBar: number;
  start: number;
  end: number;
}

export interface SectionResult extends Section {
  label: string;
  total: number;
  /** notes hit with credit (perfect, great or good) */
  hit: number;
  /** weighted like the overall accuracy, 0..1 */
  accuracy: number;
}

export const SECTION_BARS = 8;
/** Playback speeds the game offers, slowest first. */
export const RATES = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1] as const;

/** Cut the song into windows of `bars` bars. `barTimes` are the bar-line times in seconds. */
export function buildSections(barTimes: readonly number[], duration: number, bars = SECTION_BARS): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < barTimes.length; i += bars) {
    const start = barTimes[i]!;
    if (start >= duration) break;
    const next = barTimes[i + bars];
    out.push({ fromBar: i + 1, toBar: Math.min(i + bars, barTimes.length), start, end: next ?? Math.max(duration, start) });
  }
  if (out.length === 0) out.push({ fromBar: 1, toBar: 1, start: 0, end: duration });
  return out;
}

/** Accuracy per section. Sections without notes are left out; unjudged notes (a failed song) do not count. */
export function sectionResults(sections: readonly Section[], notes: readonly { time: number }[], judgments: readonly (Judgment | null)[]): SectionResult[] {
  const out: SectionResult[] = [];
  let i = 0;
  for (const [k, s] of sections.entries()) {
    const last = k === sections.length - 1;
    let total = 0;
    let hit = 0;
    let weight = 0;
    while (i < notes.length && notes[i]!.time < s.start) i++; // before the first bar line
    for (; i < notes.length && (last || notes[i]!.time < s.end); i++) {
      const j = judgments[i];
      if (!j) continue;
      total++;
      weight += WEIGHTS[j];
      if (WEIGHTS[j] > 0) hit++;
    }
    if (total > 0) out.push({ ...s, label: s.fromBar === s.toBar ? `Bar ${s.fromBar}` : `Bars ${s.fromBar}–${s.toBar}`, total, hit, accuracy: weight / total });
  }
  return out;
}

export function starCount(accuracy: number): number {
  return accuracy >= 0.95 ? 5 : accuracy >= 0.85 ? 4 : accuracy >= 0.7 ? 3 : accuracy >= 0.5 ? 2 : accuracy > 0 ? 1 : 0;
}

export type SuggestionKind = 'harder' | 'faster' | 'slower' | 'easier' | 'section' | 'again' | 'mastered';

export interface Suggestion {
  kind: SuggestionKind;
  text: string;
  /** settings to play next with, when the suggestion changes them */
  difficulty?: Difficulty;
  rate?: number;
  /** kind 'section': the section to work on, which practice mode can loop */
  section?: Section;
}

export interface SuggestionInput {
  accuracy: number;
  difficulty: Difficulty;
  /** playback rate, 1 = full speed */
  rate: number;
  failed?: boolean;
  sections?: readonly SectionResult[];
  /** the levels this part has, lowest first; default all four */
  levels?: readonly Difficulty[];
}

export const MOVE_UP = 0.9;
export const SLOW_DOWN = 0.7;

const pct = (rate: number): string => `${Math.round(rate * 100)}%`;

/**
 * One clear next step.
 *  - 90% or better: move up. Below full speed that means faster first; at full speed the
 *    next difficulty the part has ("Try Medium"); on its top level at full speed the song
 *    is mastered.
 *  - below 70% (or a failed song): slow down one step ("Try 90% speed"); at the slowest
 *    speed, drop a difficulty level instead.
 *  - in between: play it again, and name the weakest section when one stands out.
 */
export function suggestNextStep(r: SuggestionInput): Suggestion {
  const levels = r.levels?.length ? r.levels : DIFFICULTIES;
  const level = levels.indexOf(r.difficulty);
  const rateIndex = RATES.findIndex((x) => x >= r.rate - 1e-9);
  if (!r.failed && r.accuracy >= MOVE_UP) {
    if (r.rate < 1 - 1e-9) {
      const rate = RATES[Math.min(RATES.length - 1, (rateIndex < 0 ? RATES.length - 1 : rateIndex) + 1)]!;
      return { kind: 'faster', text: rate >= 1 ? 'Try full speed' : `Try ${pct(rate)} speed`, rate };
    }
    const next = level >= 0 ? levels[level + 1] : undefined;
    if (next) return { kind: 'harder', text: `Try ${DIFFICULTY_LABEL[next]}`, difficulty: next };
    return { kind: 'mastered', text: 'Mastered! Pick a new song' };
  }
  if (r.failed || r.accuracy < SLOW_DOWN) {
    const slower = rateIndex > 0 ? RATES[rateIndex - 1] : rateIndex < 0 ? RATES[RATES.length - 2] : undefined;
    if (slower !== undefined) return { kind: 'slower', text: `Try ${pct(slower)} speed`, rate: slower };
    const easier = level > 0 ? levels[level - 1] : undefined;
    if (easier) return { kind: 'easier', text: `Try ${DIFFICULTY_LABEL[easier]}`, difficulty: easier };
    return { kind: 'again', text: 'Play it again: watch the keys light up as the notes land' };
  }
  const sections = r.sections ?? [];
  if (sections.length > 1) {
    const weakest = sections.reduce((a, b) => (b.accuracy < a.accuracy ? b : a));
    if (weakest.accuracy < r.accuracy - 0.1) {
      const { fromBar, toBar, start, end } = weakest;
      return { kind: 'section', text: `Play it again: work on ${weakest.label.toLowerCase()}`, section: { fromBar, toBar, start, end } };
    }
  }
  return { kind: 'again', text: `Play it again: ${Math.round(MOVE_UP * 100)}% unlocks the next step` };
}

/** "+4.0%" / "−2.5%" against the previous best accuracy, or null when there is none. */
export function bestDelta(accuracy: number, previousBest: number | null | undefined): string | null {
  if (previousBest === null || previousBest === undefined) return null;
  const d = Math.round((accuracy - previousBest) * 1000) / 10;
  if (d === 0) return '±0.0%';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`;
}
