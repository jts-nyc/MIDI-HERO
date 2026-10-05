/**
 * Simple mode (/simple/): the teacher's defaults, baked in. Nothing here is a setting the
 * student can change except the one visible option, Easy or Normal.
 */
import { higherLevel, type Difficulty } from '../midi/difficulty.ts';
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
  { id: 'five-finger', title: 'Warm-up', blurb: 'Five fingers, one hand', color: '#11a36a' },
  { id: 'twinkle', title: 'Twinkle Twinkle', blurb: 'The first song', color: '#c77d00' },
  { id: 'ode-to-joy', title: 'Ode to Joy', blurb: 'Steady and calm', color: '#9b4dd6' },
  { id: 'saints', title: 'When the Saints', blurb: 'A marching tune', color: '#d6453d' },
  // One Rhythm Basics drill, not all five: The Pocket is the only one that keeps its rhythm on
  // Easy and needs no level talk; the others are for the full game (docs/SIMPLE-TEST.md).
  { id: 'rhythm-1-straight', title: 'Rhythm: The Pocket', blurb: 'Two drums, C and G, on the beat', color: '#0e8a8f' },
];

export const LEVEL_LABEL: Record<SimpleLevel, string> = { easy: 'Easy', normal: 'Normal' };

/** Easy is the game's Easy level (one note a beat at most); Normal is its Medium. */
export function difficultyFor(level: SimpleLevel): Difficulty {
  return level === 'easy' ? 'easy' : 'medium';
}

/**
 * The game level for a run: the card's Easy or Normal, raised to the song's own opening level
 * (the manifest's `difficulty`) when that is higher. A rhythm drill whose off-beats Easy would
 * strip opens at Medium even when Easy is picked, as it does in the full game's song list.
 */
export function runDifficulty(level: SimpleLevel, songDefault?: Difficulty): Difficulty {
  const wanted = difficultyFor(level);
  return songDefault ? higherLevel(wanted, songDefault) : wanted;
}

/** Device calibration is the one thing kept from the full game's saved settings on this machine. */
type Calibration = Pick<Settings, 'audioOffsetMs' | 'inputOffsetMs' | 'midiPortId'>;

/**
 * The settings for one simple-mode run. Teacher defaults: a 25-key window, relaxed timing,
 * note names on the keys and on the falling notes, the computer sounds the song's note on a
 * hit, no fail-out, no held-too-long penalty, calm feedback on Easy, the game's quiet cues on.
 * Easy also accepts the
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
  // First Lights is a listening trial: no cues are added to what it plays.
  if (song.trial) return { ...studentTrialSettings(calibration, 'press', 1), uiSounds: false };
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
    uiSounds: true,
  };
}

/**
 * The session's cue handler for a run (star power, milestones, level-ups; audio/sfx.ts), or
 * none when the run's settings turn cues off. Which cues a level hears is the session's call.
 */
export function cueFor<C>(settings: Pick<Settings, 'uiSounds'>, play: (cue: C) => void): ((cue: C) => void) | undefined {
  return settings.uiSounds ? play : undefined;
}
