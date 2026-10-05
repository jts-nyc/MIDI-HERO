/**
 * How much the highway says besides the notes, per difficulty level. A beginner on Easy reads
 * the notes and the keys; words, counters and flashes on top of them hide where the next note
 * lands. Hard and Expert get the whole arcade. The player can switch the scaling off in Settings
 * (`feedbackByLevel`), which gives every level the full profile.
 */
import type { Difficulty } from '../midi/difficulty.ts';
import type { TierText } from './session.ts';

export interface FeedbackProfile {
  /** the most verbose timing words this level shows; the Settings choice is capped by it */
  tierCap: TierText;
  /** "Miss" over a note that went by (the key still flashes red and the note still falls through grey) */
  missWord: boolean;
  /** share of the particles a hit bursts into, 0..1 */
  intensity: number;
  /** the big streak counter behind the notes */
  streakCounter: boolean;
  /** "25 NOTE STREAK!" call-outs */
  milestones: boolean;
  /** light at the screen edges when the multiplier rises or a streak breaks */
  edgeGlow: boolean;
  /** the old streak falling apart in red */
  shatter: boolean;
  /** the perspective highway rocks a little on every bar line */
  sway: boolean;
}

export const FULL_FEEDBACK: FeedbackProfile = {
  tierCap: 'all', missWord: true, intensity: 1, streakCounter: true, milestones: true, edgeGlow: true, shatter: true, sway: true,
};

export const FEEDBACK_BY_LEVEL: Record<Difficulty, FeedbackProfile> = {
  easy: { tierCap: 'off', missWord: false, intensity: 0.5, streakCounter: false, milestones: false, edgeGlow: false, shatter: false, sway: false },
  medium: { tierCap: 'perfect', missWord: true, intensity: 0.75, streakCounter: false, milestones: true, edgeGlow: false, shatter: false, sway: false },
  hard: FULL_FEEDBACK,
  expert: FULL_FEEDBACK,
};

const TIER_RANK: Record<TierText, number> = { off: 0, perfect: 1, all: 2 };

/** The timing words to show: what Settings asks for, but never more than the level allows. */
export function capTier(wanted: TierText, profile: FeedbackProfile): TierText {
  return TIER_RANK[wanted] <= TIER_RANK[profile.tierCap] ? wanted : profile.tierCap;
}

/** The profile for a play: by level when the setting is on, otherwise everything. */
export function feedbackFor(level: Difficulty, byLevel: boolean): FeedbackProfile {
  return byLevel ? FEEDBACK_BY_LEVEL[level] : FULL_FEEDBACK;
}
