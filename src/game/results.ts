/** What the results screen says beyond the raw counts: sections, stars, and what to do next. Pure. */

import type { Difficulty } from '../midi/difficulty.ts';
import { DIFFICULTIES, DIFFICULTY_LABEL, resolveLevel } from '../midi/difficulty.ts';
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

// ---------------------------------------------------------------------------
// Which best-score key a level is kept under
// ---------------------------------------------------------------------------
/**
 * The level that is played for a wanted one (the nearest the part has at or below it), and its
 * name in the best-score key: the part's top level keeps the key it had before levels existed
 * ('expert', no suffix), whatever it is called for this song.
 */
export function keyLevelOf(wanted: Difficulty, offered: readonly Difficulty[]): { level: Difficulty; keyLevel: Difficulty } {
  const level = resolveLevel(wanted, offered);
  return { level, keyLevel: offered.length > 1 && level === offered[offered.length - 1] ? 'expert' : level };
}

/**
 * The key level a song's best is looked up under on the song list, the way the play path
 * stores it. A stored `keyLevel` is that already. A level alone (a pack's choice) is resolved
 * against the levels the part has; `offered` is asked for only then. With neither (a choice
 * saved before levels existed) the best is where v0.1 kept it: the no-suffix key.
 */
export function listKeyLevel(choice: { keyLevel?: string; difficulty?: Difficulty }, offered: () => readonly Difficulty[]): string {
  if (choice.keyLevel) return choice.keyLevel;
  if (!choice.difficulty) return 'expert';
  const levels = offered();
  return levels.length ? keyLevelOf(choice.difficulty, levels).keyLevel : 'expert';
}

// ---------------------------------------------------------------------------
// Pack progress: stars per song and levels unlocked in order (WP10)
// ---------------------------------------------------------------------------
/** Stars on the level below that offer the next level up, when a pack unlocks levels in order. */
export const UNLOCK_STARS = 4;
/** The level of a best recorded before levels were stored and kept under the no-suffix key: the part's top level. */
export const TOP_LEVEL = 'top';

export interface LevelBest {
  accuracy: number;
  /** playback rate the best was set at */
  rate: number;
  /** level name, or TOP_LEVEL */
  level: string;
}

/**
 * Stars per level from a song's bests, best across parts and timing. Only full-speed plays
 * count: a level is not earned at half speed.
 */
export function starsByLevel(bests: readonly LevelBest[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of bests) {
    if (!(b.rate >= 1 - 1e-9)) continue;
    const n = starCount(b.accuracy);
    if (n > (out.get(b.level) ?? 0)) out.set(b.level, n);
  }
  return out;
}

/** The most stars a song has, and the level they were earned on (the higher level on a tie); null when none. */
export function songStars(bests: readonly LevelBest[]): { stars: number; level: string } | null {
  let best: { stars: number; level: string } | null = null;
  const rank = (l: string) => (l === TOP_LEVEL ? DIFFICULTIES.length : DIFFICULTIES.indexOf(l as Difficulty));
  for (const [level, stars] of starsByLevel(bests)) {
    if (stars === 0) continue;
    if (!best || stars > best.stars || (stars === best.stars && rank(level) > rank(best.level))) best = { stars, level };
  }
  return best;
}

/**
 * The levels a player may pick, lowest first. Without unlocks, all of them. With unlocks, the
 * lowest always, and each one above once the level below has UNLOCK_STARS stars. `stars` is
 * keyed by level name; TOP_LEVEL counts as the last of `levels`.
 */
export function unlockedLevels(levels: readonly Difficulty[], stars: ReadonlyMap<string, number>, unlocks: boolean): Difficulty[] {
  if (!unlocks) return [...levels];
  const starsOf = (l: Difficulty, i: number) => Math.max(stars.get(l) ?? 0, i === levels.length - 1 ? stars.get(TOP_LEVEL) ?? 0 : 0);
  const out: Difficulty[] = [];
  for (let i = 0; i < levels.length; i++) {
    if (i > 0 && starsOf(levels[i - 1]!, i - 1) < UNLOCK_STARS) break;
    out.push(levels[i]!);
  }
  return out;
}

/** "+4.0%" / "−2.5%" against the previous best accuracy, or null when there is none. */
export function bestDelta(accuracy: number, previousBest: number | null | undefined): string | null {
  if (previousBest === null || previousBest === undefined) return null;
  const d = Math.round((accuracy - previousBest) * 1000) / 10;
  if (d === 0) return '±0.0%';
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}%`;
}
