/**
 * Simple mode's screens as a pure state machine: song cards → keyboard check (once per page
 * load, again after the keyboard is unplugged) → play → results → feedback → song cards.
 */
import type { SimpleLevel } from './config.ts';

export type Screen = 'songs' | 'check' | 'play' | 'results' | 'feedback';
export type InputKind = 'midi' | 'keyboard';

/** What the results screen and the feedback record need from a run. */
export interface RunSummary {
  song: string;
  level: SimpleLevel;
  /** false when the student pressed Stop before the end */
  finished: boolean;
  /** 0..1 */
  accuracy: number;
  /** notes played on time (Perfect, Great or Good) */
  hit: number;
  /** notes in the chart */
  total: number;
}

export interface FlowState {
  screen: Screen;
  song: string | null;
  level: SimpleLevel;
  /** the keyboard check passed on this page load */
  checked: boolean;
  input: InputKind | null;
  run: RunSummary | null;
  /** show "thanks" on the song cards after a feedback form */
  thanks: boolean;
}

export type FlowEvent =
  | { type: 'pick'; song: string }
  | { type: 'level'; level: SimpleLevel }
  | { type: 'checked'; input: InputKind }
  | { type: 'finished'; run: RunSummary }
  | { type: 'next' }
  | { type: 'submitted' }
  | { type: 'home' }
  | { type: 'disconnected' };

export function initialFlow(level: SimpleLevel = 'easy'): FlowState {
  return { screen: 'songs', song: null, level, checked: false, input: null, run: null, thanks: false };
}

/** The next state; an event that does not apply on the current screen leaves the state as it is. */
export function step(s: FlowState, e: FlowEvent): FlowState {
  switch (e.type) {
    case 'pick':
      if (s.screen !== 'songs') return s;
      return { ...s, song: e.song, screen: s.checked ? 'play' : 'check', thanks: false, run: null };
    case 'level':
      return s.screen === 'songs' ? { ...s, level: e.level } : s;
    case 'checked':
      return s.screen === 'check' ? { ...s, checked: true, input: e.input, screen: 'play' } : s;
    case 'finished':
      return s.screen === 'play' ? { ...s, run: e.run, screen: 'results' } : s;
    case 'next':
      return s.screen === 'results' ? { ...s, screen: 'feedback' } : s;
    case 'submitted':
      return s.screen === 'feedback' ? { ...s, screen: 'songs', thanks: true, run: null } : s;
    case 'home':
      // Stop during play goes through results ('finished'); home is Back, or a song that would not load.
      return { ...s, screen: 'songs', run: null };
    case 'disconnected':
      return { ...s, checked: s.input === 'keyboard' ? s.checked : false };
  }
}

/** Counts of a play result, as the results screen and the feedback record show them. */
export function summarizeRun(
  r: { accuracy: number; total: number; counts: { perfect: number; great: number; good: number } },
  song: string, level: SimpleLevel, finished: boolean,
): RunSummary {
  return {
    song, level, finished,
    accuracy: Math.max(0, Math.min(1, r.accuracy)),
    hit: r.counts.perfect + r.counts.great + r.counts.good,
    total: r.total,
  };
}

/** One encouraging line for the results screen, by stars earned (0..5). */
export function cheer(stars: number, finished: boolean): string {
  if (!finished) return 'You stopped early. That is fine!';
  if (stars >= 5) return 'Amazing!';
  if (stars >= 4) return 'Great playing!';
  if (stars >= 3) return 'Nice work!';
  if (stars >= 1) return 'Good start! It gets easier every time.';
  return 'Keep going! Try again and watch the notes land.';
}
