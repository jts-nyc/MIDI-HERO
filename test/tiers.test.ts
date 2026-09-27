// WP11: hit or miss first, tier words second (assessment #15).
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, tierWord, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { DEFAULT_SETTINGS, sanitize, urlOverrides } from '../src/ui/settings.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

function harness(over: Partial<SessionOptions> = {}) {
  const notes: [number, number][] = [[1, 60], [2, 62], [3, 64], [4, 65]];
  const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t + 0.25), p)]);
  const chart = buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(secs(5))]])), { parts: [{ track: 0, channel: 0 }] });
  const t = { perfMs: 10_000 };
  const session = new PlaySession({
    chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
    visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', ...over,
  });
  const goTo = (songTime: number) => {
    t.perfMs += (songTime - session.now()) * 1000;
    session.update();
  };
  const press = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
  return { session, goTo, press };
}

/** Perfect at 1, Great at 2 (+50 ms), Good at 3 (+90 ms), and 4 missed. */
function playSome(over: Partial<SessionOptions>) {
  const h = harness(over);
  const shown: string[] = [];
  const seen = new Set<object>();
  const collect = () => {
    for (const p of h.session.popups) if (!seen.has(p)) (seen.add(p), shown.push(p.text));
  };
  h.goTo(1); h.press(60); collect();
  h.goTo(2.05); h.press(62); collect();
  h.goTo(3.09); h.press(64); collect();
  h.goTo(4.6); collect();
  return { session: h.session, shown };
}

describe('tier words', () => {
  it('tierWord: misses always, Perfect (and Late) by default, every tier on "all", none on "off"', () => {
    expect(tierWord('miss', 'off')).toBe('Miss');
    expect(tierWord('perfect', 'perfect')).toBe('Perfect');
    expect(tierWord('great', 'perfect')).toBeNull();
    expect(tierWord('good', 'perfect')).toBeNull();
    expect(tierWord('late', 'perfect')).toBe('Late');
    expect(tierWord('great', 'all')).toBe('Great');
    expect(tierWord('perfect', 'off')).toBeNull();
  });

  it('the default floats Perfect only; Great and Good hit silently; the miss shows', () => {
    const { session, shown } = playSome({});
    expect(session.judge.counts).toMatchObject({ perfect: 1, great: 1, good: 1, miss: 1 });
    expect(shown).toEqual(['Perfect', 'Miss']);
  });

  it('"all" shows every tier, "off" only the miss; the score is the same', () => {
    const all = playSome({ tierText: 'all' });
    expect(all.shown).toEqual(['Perfect', 'Great', 'Good', 'Miss']);
    const none = playSome({ tierText: 'off' });
    expect(none.shown).toEqual(['Miss']);
    expect(none.session.judge.score).toBe(all.session.judge.score);
  });

  it('is a setting, default "perfect", from storage and the URL', () => {
    expect(DEFAULT_SETTINGS.tierText).toBe('perfect');
    expect(sanitize({ tierText: 'all' }).tierText).toBe('all');
    expect(sanitize({ tierText: 'loud' }).tierText).toBe('perfect');
    expect(urlOverrides('?tiers=off').tierText).toBe('off');
  });
});
