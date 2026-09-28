import type { Settings } from '../ui/settings.ts';

export const STUDENT_TRIAL_ID = 'first-lights';
export type TrialSound = 'press' | 'off';
export type TrialRate = 1 | 0.75 | 0.5;

/** Explicit trial conditions, independent of saved game preferences; retain device calibration. */
export function studentTrialSettings(saved: Settings, sound: TrialSound, rate: TrialRate): Settings {
  return {
    ...saved,
    kb: 25, keyboardBase: 48, highway: 'flat', timing: 'normal',
    synth: sound === 'press', feedbackSound: sound,
    easy: false, arcade: false, letGo: false, hitSound: false,
    practiceWait: false, practiceLadder: false, rate,
    foldMode: 'drop', wrongNotePenalty: 'combo',
    names: true, noteNames: true, tierText: 'off', backingVolume: 0.65, speed: 300,
  };
}
