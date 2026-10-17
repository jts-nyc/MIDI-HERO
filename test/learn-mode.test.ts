import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { LEARNED_KEY, learnedSongs, markLearned, openingMode, PASS_ACCURACY, passesSong, type LearnStorage } from '../src/game/learn.ts';
import { PlaySession, type PracticeOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

function memoryStore(init: Record<string, string> = {}): LearnStorage & { data: Record<string, string> } {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe('the mode a song opens in', () => {
  it('a new song opens in learn mode', () => {
    expect(openingMode({ learned: false, bestAccuracy: null })).toBe('learn');
  });

  it('a song passed once opens for a score', () => {
    expect(openingMode({ learned: true, bestAccuracy: null })).toBe('score');
  });

  it('a song with a scored best of two stars or more was passed before learn mode existed', () => {
    expect(openingMode({ learned: false, bestAccuracy: PASS_ACCURACY })).toBe('score');
    expect(openingMode({ learned: false, bestAccuracy: 0.3 })).toBe('learn');
  });

  it('the URL choice wins either way', () => {
    expect(openingMode({ learned: true, bestAccuracy: 0.9, urlMode: 'learn' })).toBe('learn');
    expect(openingMode({ learned: false, bestAccuracy: null, urlMode: 'score' })).toBe('score');
  });
});

describe('passing a song', () => {
  const r = { total: 20, judged: 20, accuracy: 0.2, failed: false };

  it('learn mode passes when every note was played, whatever the timing', () => {
    expect(passesSong('learn', r)).toBe(true);
    expect(passesSong('learn', { ...r, judged: 12 })).toBe(false); // stopped early
  });

  it('a scored play passes at two stars, finished and not failed', () => {
    expect(passesSong('score', r)).toBe(false);
    expect(passesSong('score', { ...r, accuracy: 0.6 })).toBe(true);
    expect(passesSong('score', { ...r, accuracy: 0.6, failed: true })).toBe(false);
  });

  it('autoplay and empty charts never pass a song', () => {
    expect(passesSong('learn', r, true)).toBe(false);
    expect(passesSong('learn', { ...r, total: 0, judged: 0 })).toBe(false);
  });
});

describe('learned songs on this device', () => {
  it('remembers passed songs once each', () => {
    const store = memoryStore();
    expect(learnedSongs(store).size).toBe(0);
    markLearned(store, 'ode-to-joy');
    markLearned(store, 'ode-to-joy');
    markLearned(store, 'twinkle');
    expect([...learnedSongs(store)]).toEqual(['ode-to-joy', 'twinkle']);
  });

  it('survives junk or missing storage', () => {
    expect(learnedSongs(memoryStore({ [LEARNED_KEY]: '{not json' })).size).toBe(0);
    expect(learnedSongs(memoryStore({ [LEARNED_KEY]: '[1,"a"]' }))).toEqual(new Set(['a']));
    expect(learnedSongs(null).size).toBe(0);
    expect(() => markLearned(null, 'x')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The session: learn mode is wait mode, once through the whole song
// ---------------------------------------------------------------------------
const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ); // 120 BPM
const song = parseSong(smf([[tempo(0, 120), ...[0, 1, 2, 3].flatMap((i) => [on(secs(2 + i), 60 + 2 * i), off(secs(2.4 + i), 60 + 2 * i)]), end(secs(8))]]));
const chart = buildChart(song, { parts: [{ track: 0, channel: 0 }] });

function learnSession() {
  const t = { perfMs: 10_000 };
  const clock = new GameClock(() => t.perfMs);
  const practice: PracticeOptions = { loop: { start: 0, end: chart.duration }, sections: [], current: -1, label: 'Learn mode', wait: true, ladder: false, once: true, title: 'Learn mode' };
  const session = new PlaySession({
    chart: buildChart(song, { parts: [{ track: 0, channel: 0 }] }), clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
    visibleSeconds: 1, barSeconds: 2, countInBeats: 4, autoplay: null, hint: '', practice,
  });
  const advance = (sec: number) => {
    const until = t.perfMs + sec * 1000;
    while (t.perfMs < until) {
      t.perfMs = Math.min(until, t.perfMs + 16);
      session.update();
    }
  };
  const down = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const up = (pitch: number) => session.handleInput({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
  return { session, advance, down, up };
}

describe('PlaySession in learn mode', () => {
  it('starts with the normal lead-in, not a loop, and draws no loop markers', () => {
    const { session } = learnSession();
    expect(session.now()).toBeCloseTo(-(1 + 2), 9); // visibleSeconds + one bar, as a normal play
    expect(session.practice).toMatchObject({ loop: null, title: 'Learn mode', waiting: false });
  });

  it('waits at every note however long the student takes, then finishes once at the end', () => {
    const { session, advance, down, up } = learnSession();
    let finished: ReturnType<PlaySession['result']> | null = null;
    session.onFinished = (r) => (finished = r);
    for (const pitch of [60, 62, 64, 66]) {
      advance(8); // far longer than the note's window
      expect(session.practice!.waiting).toBe(true);
      expect(session.judge.counts.miss).toBe(0);
      down(pitch);
      advance(0.1);
      up(pitch);
    }
    advance(10);
    expect(session.status).toBe('finished');
    expect(finished).not.toBeNull();
    const r = finished!;
    expect(r.counts.miss).toBe(0);
    expect(passesSong('learn', r)).toBe(true);
    expect(session.practice!.passes).toBe(0); // no loop, no passes
  });

  it('Stop before the end does not pass the song', () => {
    const { session, advance, down } = learnSession();
    let finished: ReturnType<PlaySession['result']> | null = null;
    session.onFinished = (r) => (finished = r);
    advance(5);
    down(60);
    advance(1);
    session.stopPractice();
    expect(finished).not.toBeNull();
    expect(passesSong('learn', finished!)).toBe(false);
  });
});
