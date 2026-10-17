/**
 * First-run setup as a pure state machine, one question per screen, for a student who clicks
 * whatever is biggest: plug in, press the key at the far left (the game learns where the
 * keyboard's octave buttons are), how many keys, does it make its own sound. With a keyboard
 * connected the only way forward is pressing a key on it; "I don't have a keyboard" is a small
 * link that switches to the computer keyboard.
 */
import type { MidiStatus } from '../input/midiInput.ts';
import { noteName } from '../render/layout.ts';
import type { KeyboardSize } from '../ui/settings.ts';

export type SetupStep = 'blocked' | 'connect' | 'press' | 'kb' | 'sound' | 'done';

export interface SetupState {
  midi: MidiStatus;
  /** a MIDI keyboard is connected and selected */
  hasPort: boolean;
  /** the pitch of the C pressed at the far left, once pressed */
  lowC: number | null;
  /** the student chose the computer keyboard */
  noKeyboard: boolean;
  kb: KeyboardSize | null;
  soundSelf: boolean | null;
}

export const initialSetup = (midi: MidiStatus, hasPort: boolean): SetupState => ({
  midi, hasPort, lowC: null, noKeyboard: false, kb: null, soundSelf: null,
});

/**
 * The MIDI state changed. A keyboard that went away takes its learned C with it: a reconnect may
 * have reset its octave buttons, or it may be a different keyboard.
 */
export function withMidi(s: SetupState, midi: MidiStatus, hasPort: boolean): SetupState {
  return { ...s, midi, hasPort, lowC: hasPort ? s.lowC : null };
}

export function setupStep(s: SetupState): SetupStep {
  if (!s.noKeyboard) {
    if (s.midi === 'unsupported' || s.midi === 'denied') return 'blocked';
    if (s.midi === 'pending' || !s.hasPort) return 'connect';
    if (s.lowC === null) return 'press';
    if (s.kb === null) return 'kb';
    if (s.soundSelf === null) return 'sound';
  }
  return 'done';
}

/** The settings a finished setup gives: the computer keyboard plays on a 25-key window with computer sound. */
export function setupResult(s: SetupState): { kb: KeyboardSize; soundSelf: boolean } {
  return s.noKeyboard ? { kb: 25, soundSelf: false } : { kb: s.kb ?? 25, soundSelf: s.soundSelf ?? false };
}

export interface KeyVerdict {
  /** the key is a C: the game can line the keyboard up from it */
  ok: boolean;
  /** "C3" */
  name: string;
  /** what to show, in a few words */
  text: string;
}

/** What to tell a student who pressed `pitch` when asked for the C at the far left. */
export function lowCVerdict(pitch: number): KeyVerdict {
  const name = noteName(pitch);
  if (pitch % 12 === 0) return { ok: true, name, text: `Got it! That was ${name}.` };
  return { ok: false, name, text: `That was ${name}. Find a C: the white key just left of the two black keys.` };
}
