/**
 * What a renderer draws for practice mode. The session fills it; both renderers draw it.
 * Pure types.
 */

export interface PracticeSection {
  /** song seconds, as in `Section` from game/results.ts */
  start: number;
  end: number;
  /** "Bars 9–16" */
  label: string;
}

export interface PracticeView {
  /** sections of the song, in order; empty when practice mode is off */
  sections: readonly PracticeSection[];
  /** index into `sections` being practised, -1 for none */
  current: number;
  /** A–B loop in song seconds, or null; the renderer marks both ends on the highway */
  loop: { start: number; end: number } | null;
  /** completed passes through the loop in this session */
  passes: number;
  /** wait mode: the song is held until the pending notes at the hit line are played */
  waiting: boolean;
  /** pitches the player still has to press while `waiting`; empty otherwise */
  waitingFor: readonly number[];
}

export const NO_PRACTICE: PracticeView = {
  sections: [],
  current: -1,
  loop: null,
  passes: 0,
  waiting: false,
  waitingFor: [],
};
