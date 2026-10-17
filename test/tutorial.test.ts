import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canSkip, initialTutorial, keyboardWindow, keysDone, KEYS_TO_TRY, shouldShowTutorial, TUTORIAL_SONG_FILE, tutorialStep, type TutorialEvent, type TutorialState,
} from '../src/game/tutorial.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { DEFAULT_SETTINGS, sanitize } from '../src/ui/settings.ts';

const run = (events: TutorialEvent[], s: TutorialState = initialTutorial()) => events.reduce(tutorialStep, s);
const keys = (...pitches: number[]): TutorialEvent[] => pitches.map((pitch) => ({ type: 'key', pitch }));

describe('tutorial gating', () => {
  it('the first step cannot be skipped or passed without pressing keys', () => {
    const s = initialTutorial();
    expect(canSkip(s)).toBe(false);
    expect(run([{ type: 'skip' }]).step).toBe('keys');
    expect(run([{ type: 'next' }]).step).toBe('keys');
    expect(run([{ type: 'played' }]).step).toBe('keys');
  });

  it(`needs ${KEYS_TO_TRY} different keys; pressing the same key again does not count`, () => {
    const s = run(keys(60, 60, 60, 62));
    expect(s.pressed).toEqual([60, 62]);
    expect(keysDone(s)).toBe(false);
    expect(run([{ type: 'next' }], s).step).toBe('keys');
    const done = run(keys(64), s);
    expect(keysDone(done)).toBe(true);
    expect(run([{ type: 'next' }], done).step).toBe('notes');
  });

  it('after the first step it can be skipped at any point', () => {
    const notes = run([...keys(60, 62, 64), { type: 'next' }]);
    expect(canSkip(notes)).toBe(true);
    expect(run([{ type: 'skip' }], notes).step).toBe('done');
    const play = run([{ type: 'next' }], notes);
    expect(play.step).toBe('play');
    expect(run([{ type: 'skip' }], play).step).toBe('done');
  });

  it('runs keys → notes → play → first song → done', () => {
    const s = run([...keys(48, 50, 52), { type: 'next' }, { type: 'next' }, { type: 'played' }]);
    expect(s.step).toBe('first-song');
    expect(run([{ type: 'next' }], s).step).toBe('done');
    // keys pressed after step 1 are ignored
    expect(run(keys(70), s).pressed).toEqual([48, 50, 52]);
  });

  it('opens by itself once per browser, never on a direct song link', () => {
    expect(shouldShowTutorial({ tutorialDone: false, directLink: false })).toBe(true);
    expect(shouldShowTutorial({ tutorialDone: true, directLink: false })).toBe(false);
    expect(shouldShowTutorial({ tutorialDone: false, directLink: true })).toBe(false);
  });

  it('the setting is saved and survives a reload; older saves start with it off', () => {
    expect(DEFAULT_SETTINGS.tutorialDone).toBe(false);
    expect(sanitize({ tutorialDone: true }).tutorialDone).toBe(true);
    expect(sanitize({ firstRunDone: true }).tutorialDone).toBe(false);
  });
});

describe("the screen's keyboard in step 1", () => {
  it('shows two octaves from the keyboard base, and moves to the octave of a key outside it', () => {
    expect(keyboardWindow(null)).toEqual({ low: 48, high: 72 });
    expect(keyboardWindow(64, 48)).toEqual({ low: 48, high: 72 });
    expect(keyboardWindow(80, 48)).toEqual({ low: 72, high: 96 });
    expect(keyboardWindow(37, 48)).toEqual({ low: 36, high: 60 });
  });
});

describe('the tutorial song', () => {
  const song = parseSong(new Uint8Array(readFileSync(new URL(`../public/songs/${TUTORIAL_SONG_FILE}`, import.meta.url))));
  const chart = buildChart(song, { parts: [{ track: 1, channel: 0 }], difficulty: 'easy' });

  it('is four slow notes, C4 E4 G4 C4, kept whole on Easy', () => {
    expect(chart.notes.map((n) => n.pitch)).toEqual([60, 64, 67, 60]);
    for (let i = 1; i < chart.notes.length; i++) expect(chart.notes[i]!.time - chart.notes[i - 1]!.time).toBeGreaterThan(1.5);
  });

  it('fits a 25-key window', () => {
    const pitches = chart.notes.map((n) => n.pitch);
    expect(Math.max(...pitches) - Math.min(...pitches)).toBeLessThanOrEqual(24);
  });
});
