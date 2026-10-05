import { describe, expect, it } from 'vitest';
import { cueFor, difficultyFor, runDifficulty, SIMPLE_SONGS, simpleSettings } from '../src/simple/config.ts';
import { cheer, initialFlow, step, summarizeRun, type FlowState, type RunSummary } from '../src/simple/flow.ts';
import { STUDENT_TRIAL_ID, studentTrialSettings } from '../src/game/studentTrial.ts';
import { DEFAULT_SETTINGS } from '../src/ui/settings.ts';
import manifest from '../public/songs/manifest.json';

const run: RunSummary = { song: 'twinkle', level: 'easy', finished: true, accuracy: 0.9, hit: 9, total: 10 };

describe('simple-mode flow', () => {
  it('goes cards → check → play → results → feedback → cards', () => {
    let s: FlowState = initialFlow();
    expect(s.screen).toBe('songs');
    s = step(s, { type: 'pick', song: 'twinkle' });
    expect(s).toMatchObject({ screen: 'check', song: 'twinkle' });
    s = step(s, { type: 'checked', input: 'midi' });
    expect(s).toMatchObject({ screen: 'play', checked: true, input: 'midi' });
    s = step(s, { type: 'finished', run });
    expect(s).toMatchObject({ screen: 'results', run });
    s = step(s, { type: 'next' });
    expect(s.screen).toBe('feedback');
    s = step(s, { type: 'submitted' });
    expect(s).toMatchObject({ screen: 'songs', thanks: true, run: null });
  });

  it('checks the keyboard once per page load, and again after it is unplugged', () => {
    let s = step(step(initialFlow(), { type: 'pick', song: 'twinkle' }), { type: 'checked', input: 'midi' });
    s = step(step(step(s, { type: 'finished', run }), { type: 'next' }), { type: 'submitted' });
    s = step(s, { type: 'pick', song: 'saints' });
    expect(s).toMatchObject({ screen: 'play', song: 'saints', thanks: false });
    s = step(step(s, { type: 'finished', run }), { type: 'home' });
    s = step(s, { type: 'disconnected' });
    expect(step(s, { type: 'pick', song: 'saints' }).screen).toBe('check');
  });

  it('keeps a computer-keyboard check when a music keyboard is unplugged', () => {
    const s = step(step(initialFlow(), { type: 'pick', song: 'twinkle' }), { type: 'checked', input: 'keyboard' });
    expect(step(s, { type: 'disconnected' }).checked).toBe(true);
  });

  it('changes the level only on the song cards', () => {
    let s = step(initialFlow(), { type: 'level', level: 'normal' });
    expect(s.level).toBe('normal');
    s = step(s, { type: 'pick', song: 'twinkle' });
    expect(step(s, { type: 'level', level: 'easy' }).level).toBe('normal');
  });

  it('ignores events that do not belong to the current screen', () => {
    const s = initialFlow();
    for (const e of [{ type: 'checked', input: 'midi' }, { type: 'finished', run }, { type: 'next' }, { type: 'submitted' }] as const) {
      expect(step(s, e)).toBe(s);
    }
    const playing = step(step(s, { type: 'pick', song: 'twinkle' }), { type: 'checked', input: 'midi' });
    expect(step(playing, { type: 'pick', song: 'saints' })).toBe(playing);
    expect(step(playing, { type: 'next' })).toBe(playing);
  });

  it('Back from the check and a song that fails to load return to the cards', () => {
    const check = step(initialFlow(), { type: 'pick', song: 'twinkle' });
    expect(step(check, { type: 'home' }).screen).toBe('songs');
    const playing = step(check, { type: 'checked', input: 'keyboard' });
    expect(step(playing, { type: 'home' })).toMatchObject({ screen: 'songs', checked: true });
  });

  it('summarizes a play: on-time notes are Perfect, Great and Good', () => {
    const r = summarizeRun({ accuracy: 0.71, total: 20, counts: { perfect: 5, great: 4, good: 3 } }, 'saints', 'normal', false);
    expect(r).toEqual({ song: 'saints', level: 'normal', finished: false, accuracy: 0.71, hit: 12, total: 20 });
    expect(summarizeRun({ accuracy: 1.2, total: 1, counts: { perfect: 1, great: 0, good: 0 } }, 'x', 'easy', true).accuracy).toBe(1);
  });

  it('cheers every result, and says stopping early is fine', () => {
    for (let n = 0; n <= 5; n++) expect(cheer(n, true).length).toBeGreaterThan(0);
    expect(cheer(5, false)).toMatch(/stopped early/);
  });
});

describe('simple-mode songs and defaults', () => {
  it('lists bundled songs only, First Lights first', () => {
    const ids = new Set(manifest.map((m) => m.id));
    for (const s of SIMPLE_SONGS) expect(ids.has(s.id)).toBe(true);
    expect(SIMPLE_SONGS[0]).toMatchObject({ id: STUDENT_TRIAL_ID, trial: true });
    expect(SIMPLE_SONGS.filter((s) => s.trial)).toHaveLength(1);
    expect(SIMPLE_SONGS.length).toBeLessThanOrEqual(6);
  });

  it('offers one Rhythm Basics card, The Pocket, which keeps its rhythm on Easy', () => {
    const rhythm = SIMPLE_SONGS.filter((s) => s.id.startsWith('rhythm-'));
    expect(rhythm.map((s) => s.id)).toEqual(['rhythm-1-straight']);
    expect(rhythm[0]!.title).toBe('Rhythm: The Pocket');
    const entry = manifest.find((m) => m.id === 'rhythm-1-straight') as { difficulty?: string } | undefined;
    expect(entry).toBeDefined();
    expect(entry!.difficulty).toBeUndefined(); // no opening level above Easy, so the Easy/Normal toggle means what it says
  });

  it('maps Easy and Normal to the game levels', () => {
    expect(difficultyFor('easy')).toBe('easy');
    expect(difficultyFor('normal')).toBe('medium');
  });

  it("raises a run to the song's own opening level, never lowers it", () => {
    expect(runDifficulty('easy')).toBe('easy');
    expect(runDifficulty('normal')).toBe('medium');
    expect(runDifficulty('easy', 'medium')).toBe('medium');
    expect(runDifficulty('normal', 'easy')).toBe('medium');
    expect(runDifficulty('normal', 'hard')).toBe('hard');
  });

  const saved = { ...DEFAULT_SETTINGS, audioOffsetMs: 40, inputOffsetMs: -25, midiPortId: 'port-1', timing: 'strict' as const, arcade: true, rate: 0.5, kb: 88 as const };

  it('bakes in the teacher defaults and keeps only device calibration from saved settings', () => {
    const s = simpleSettings(saved, 'easy', {});
    expect(s).toMatchObject({
      kb: 25, timing: 'relaxed', names: true, noteNames: true, synth: true, feedbackSound: 'chart', rate: 1,
      arcade: false, letGo: false, easy: true, feedbackByLevel: true, foldMode: 'fold',
      audioOffsetMs: 40, inputOffsetMs: -25, midiPortId: 'port-1',
    });
    expect(simpleSettings(saved, 'normal', {}).easy).toBe(false);
  });

  it('plays the game cues on the songs, never on the First Lights listening trial', () => {
    const play = () => undefined;
    const quiet = { ...saved, uiSounds: false };
    expect(simpleSettings(quiet, 'easy', {}).uiSounds).toBe(true); // a teacher default, not the saved setting
    expect(cueFor(simpleSettings(saved, 'easy', {}), play)).toBe(play);
    expect(cueFor(simpleSettings(saved, 'normal', {}), play)).toBe(play);
    expect(simpleSettings(saved, 'easy', { trial: true }).uiSounds).toBe(false);
    expect(cueFor(simpleSettings(saved, 'easy', { trial: true }), play)).toBeUndefined();
  });

  it('runs First Lights under the student trial conditions', () => {
    const s = simpleSettings(saved, 'normal', { trial: true });
    expect(s).toEqual({ ...studentTrialSettings({ ...DEFAULT_SETTINGS, audioOffsetMs: 40, inputOffsetMs: -25, midiPortId: 'port-1', firstRunDone: true }, 'press', 1), uiSounds: false });
    expect(s).toMatchObject({ timing: 'normal', kb: 25, highway: 'flat', synth: true, feedbackSound: 'press' });
  });
});
