import { describe, expect, it } from 'vitest';
import { studentTrialSettings } from '../src/game/studentTrial.ts';
import { DEFAULT_SETTINGS, effectiveFeedback } from '../src/ui/settings.ts';

describe('student trial conditions', () => {
  it('isolates the trial from conflicting saved preferences while retaining device calibration', () => {
    const saved = { ...DEFAULT_SETTINGS, easy: true, arcade: true, letGo: true, practiceWait: true,
      practiceLadder: true, rate: 1.5, speed: 800, backingVolume: 0, inputOffsetMs: 25, audioOffsetMs: -15,
      keyboardBase: 84, feedbackSound: 'chart' as const, highway: 'perspective' as const };
    const snapshot = { ...saved };
    const s = studentTrialSettings(saved, 'press', 1);
    expect(effectiveFeedback(s)).toBe('press');
    expect(s).toMatchObject({ easy: false, arcade: false, letGo: false, practiceWait: false,
      practiceLadder: false, rate: 1, backingVolume: 0.65, keyboardBase: 48, foldMode: 'drop',
      timing: 'normal', highway: 'flat', speed: 300, inputOffsetMs: 25, audioOffsetMs: -15 });
    expect(saved).toEqual(snapshot);
  });

  it('external sound disables the player synth without silencing accompaniment', () => {
    const s = studentTrialSettings(DEFAULT_SETTINGS, 'off', 0.75);
    expect(s.synth).toBe(false);
    expect(effectiveFeedback(s)).toBe('off');
    expect(s.rate).toBe(0.75);
    expect(s.backingVolume).toBeGreaterThan(0);
  });
});
