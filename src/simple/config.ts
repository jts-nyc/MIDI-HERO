/**
 * Simple mode (/simple/): the teacher's defaults, baked in. Nothing here is a setting the
 * student can change except the one visible option, Easy or Normal.
 */
import type { Difficulty } from '../midi/difficulty.ts';
import { STUDENT_TRIAL_ID, studentTrialSettings } from '../game/studentTrial.ts';
import { DEFAULT_SETTINGS, type Settings } from '../ui/settings.ts';

export type SimpleLevel = 'easy' | 'normal';

export interface SimpleSong {
  id: string;
  /** short title for the card */
  title: string;
  /** one line under the title */
  blurb: string;
  /** card colour */
  color: string;
  /** the First Lights student trial: absolute pitches, its own fixed conditions, no Easy/Normal */
  trial?: boolean;
}

/** The curated list, easiest first. Ids are the bundled manifest's. */
export const SIMPLE_SONGS: readonly SimpleSong[] = [
  { id: STUDENT_TRIAL_ID, title: 'First Lights', blurb: 'Three notes: C, E and G', color: '#2f7cf6', trial: true },
  { id: 'five-finger', title: 'Five-Finger Warm-up', blurb: 'Five notes, one hand', color: '#11a36a' },
  { id: 'twinkle', title: 'Twinkle Twinkle', blurb: 'The first song', color: '#c77d00' },
  { id: 'ode-to-joy', title: 'Ode to Joy', blurb: 'Steady and calm', color: '#9b4dd6' },
  { id: 'saints', title: 'When the Saints', blurb: 'A marching tune', color: '#d6453d' },
];

export const LEVEL_LABEL: Record<SimpleLevel, string> = { easy: 'Easy', normal: 'Normal' };

/** Easy is the game's Easy level (one note a beat at most); Normal is its Medium. */
export function difficultyFor(level: SimpleLevel): Difficulty {
  return level === 'easy' ? 'easy' : 'medium';
}

/** Device calibration is the one thing kept from the full game's saved settings on this machine. */
type Calibration = Pick<Settings, 'audioOffsetMs' | 'inputOffsetMs' | 'midiPortId'>;

/**
 * The settings for one simple-mode run. Teacher defaults: a 25-key window, relaxed timing,
 * note names on the keys and on the falling notes, the computer sounds the song's note on a
 * hit, no fail-out, no held-too-long penalty, calm feedback on Easy. Easy also accepts the
 * right note in any octave, so a bumped octave button does not stop a beginner.
 * First Lights keeps the student trial's own conditions (exact pitches, normal timing).
 */
export function simpleSettings(saved: Calibration, level: SimpleLevel, song: Pick<SimpleSong, 'trial'>): Settings {
  const calibration: Settings = {
    ...DEFAULT_SETTINGS,
    audioOffsetMs: saved.audioOffsetMs,
    inputOffsetMs: saved.inputOffsetMs,
    midiPortId: saved.midiPortId,
    firstRunDone: true,
  };
  if (song.trial) return studentTrialSettings(calibration, 'press', 1);
  return {
    ...calibration,
    kb: 25,
    keyboardBase: 48,
    timing: 'relaxed',
    names: true,
    noteNames: true,
    synth: true,
    feedbackSound: 'chart',
    hitSound: false,
    rate: 1,
    easy: level === 'easy',
    arcade: false,
    letGo: false,
    effects: true,
    tierText: 'perfect',
    feedbackByLevel: true,
    foldMode: 'fold',
    wrongNotePenalty: 'combo',
    practiceWait: false,
    practiceLadder: false,
  };
}
