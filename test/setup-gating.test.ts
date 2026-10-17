import { describe, expect, it } from 'vitest';
import { initialSetup, lowCVerdict, setupResult, setupStep, type SetupState } from '../src/game/setup.ts';

const ready = (over: Partial<SetupState> = {}): SetupState => ({ ...initialSetup('granted', true), ...over });

describe('first-run setup gating', () => {
  it('waits while MIDI access is pending or no keyboard is plugged in', () => {
    expect(setupStep(initialSetup('pending', false))).toBe('connect');
    expect(setupStep(initialSetup('granted', false))).toBe('connect');
  });

  it('with a keyboard connected, the only way past the key step is pressing a C on it', () => {
    expect(setupStep(ready())).toBe('press');
    // choosing a size or sound first changes nothing: the key press is still owed
    expect(setupStep(ready({ kb: 25, soundSelf: false }))).toBe('press');
    expect(setupStep(ready({ lowC: 48 }))).toBe('kb');
  });

  it('asks one question per screen, in order, then is done', () => {
    expect(setupStep(ready({ lowC: 48 }))).toBe('kb');
    expect(setupStep(ready({ lowC: 48, kb: 49 }))).toBe('sound');
    expect(setupStep(ready({ lowC: 48, kb: 49, soundSelf: true }))).toBe('done');
    expect(setupResult(ready({ lowC: 48, kb: 49, soundSelf: true }))).toEqual({ kb: 49, soundSelf: true });
  });

  it('unplugging during setup goes back to "plug in"', () => {
    expect(setupStep(ready({ hasPort: false }))).toBe('connect');
    expect(setupStep(ready({ hasPort: false, lowC: 48 }))).toBe('connect');
  });

  it('a blocked or missing Web MIDI says so instead of waiting forever', () => {
    expect(setupStep(initialSetup('denied', false))).toBe('blocked');
    expect(setupStep(initialSetup('unsupported', false))).toBe('blocked');
  });

  it('"I don\'t have a keyboard" finishes setup on the computer keyboard with computer sound', () => {
    for (const s of [initialSetup('pending', false), initialSetup('denied', false), initialSetup('unsupported', false), ready()]) {
      const st = { ...s, noKeyboard: true };
      expect(setupStep(st)).toBe('done');
      expect(setupResult(st)).toEqual({ kb: 25, soundSelf: false });
    }
  });
});

describe('the "press the C at the far left" check', () => {
  it('accepts any C and names it', () => {
    expect(lowCVerdict(48)).toEqual({ ok: true, name: 'C3', text: 'Got it! That was C3.' });
    expect(lowCVerdict(36).ok).toBe(true);
  });

  it('names a wrong key and says how to find a C', () => {
    const v = lowCVerdict(52);
    expect(v.ok).toBe(false);
    expect(v.name).toBe('E3');
    expect(v.text).toMatch(/^That was E3\. Find a C/);
    expect(lowCVerdict(49).name).toBe('C#3');
    expect(lowCVerdict(49).ok).toBe(false);
  });
});
