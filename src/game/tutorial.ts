/**
 * The first-run tutorial, about a minute: (1) press keys and see them light up on the screen's
 * keyboard; (2) four slow notes in learn mode, where the song waits for each one; (3) straight
 * into the first song. Step 1 has no way past it except pressing keys; from step 2 on it can be
 * skipped. Pure: the screens and the play are in main.ts and ui/screens.ts.
 */

export const TUTORIAL_SONG_ID = 'tutorial';
export const TUTORIAL_SONG_FILE = 'tutorial.mid';
/** the song the tutorial drops the student into, if the library has it */
export const FIRST_SONG_ID = 'twinkle';
/** keys to press in step 1 before it lets the student go on */
export const KEYS_TO_TRY = 3;

export type TutorialStep = 'keys' | 'notes' | 'play' | 'first-song' | 'done';

export interface TutorialState {
  step: TutorialStep;
  /** different keys pressed in step 1 */
  pressed: number[];
}

export const initialTutorial = (): TutorialState => ({ step: 'keys', pressed: [] });

export type TutorialEvent =
  | { type: 'key'; pitch: number }
  | { type: 'next' }
  | { type: 'skip' }
  /** the four-note play ended, played through or stopped */
  | { type: 'played' };

/** Skip only after the first step: every student presses a key and sees it light up first. */
export const canSkip = (s: TutorialState): boolean => s.step !== 'keys' && s.step !== 'done';

/** Step 1 is done once KEYS_TO_TRY different keys have lit up. */
export const keysDone = (s: TutorialState): boolean => s.pressed.length >= KEYS_TO_TRY;

export function tutorialStep(s: TutorialState, e: TutorialEvent): TutorialState {
  switch (e.type) {
    case 'key':
      if (s.step !== 'keys' || s.pressed.includes(e.pitch)) return s;
      return { ...s, pressed: [...s.pressed, e.pitch] };
    case 'next':
      if (s.step === 'keys') return keysDone(s) ? { ...s, step: 'notes' } : s;
      if (s.step === 'notes') return { ...s, step: 'play' };
      if (s.step === 'first-song') return { ...s, step: 'done' };
      return s;
    case 'played':
      return s.step === 'play' ? { ...s, step: 'first-song' } : s;
    case 'skip':
      return canSkip(s) ? { ...s, step: 'done' } : s;
  }
}

/** The tutorial opens by itself once per browser, unless the link is a direct song or file link. */
export function shouldShowTutorial(o: { tutorialDone: boolean; directLink: boolean }): boolean {
  return !o.tutorialDone && !o.directLink;
}

/** Two octaves of the screen's keyboard, from the C at or below `pitch` (C3–C5 before any key). */
export function keyboardWindow(pitch: number | null, low = 48): { low: number; high: number } {
  if (pitch === null) return { low, high: low + 24 };
  if (pitch >= low && pitch <= low + 24) return { low, high: low + 24 };
  const c = pitch - (((pitch % 12) + 12) % 12);
  return { low: c, high: c + 24 };
}
