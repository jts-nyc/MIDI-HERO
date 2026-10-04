// Feedback scales with the level: Easy reads the notes, Hard gets the arcade.
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { capTier, FEEDBACK_BY_LEVEL, feedbackFor, FULL_FEEDBACK } from '../src/game/feedback.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { DEFAULT_SETTINGS, sanitize, urlOverrides } from '../src/ui/settings.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

function harness(over: Partial<SessionOptions> = {}) {
  const notes: [number, number][] = Array.from({ length: 14 }, (_, i) => [1 + i * 0.5, 60 + (i % 5)]);
  const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t + 0.2), p)]);
  const chart = buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(secs(9))]])), { parts: [{ track: 0, channel: 0 }] });
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
  return { session, goTo, press, notes };
}

describe('feedback profiles', () => {
  it('cap the timing words at what the level allows, and never raise them', () => {
    expect(capTier('all', FEEDBACK_BY_LEVEL.easy)).toBe('off');
    expect(capTier('all', FEEDBACK_BY_LEVEL.medium)).toBe('perfect');
    expect(capTier('off', FEEDBACK_BY_LEVEL.medium)).toBe('off');
    expect(capTier('all', FEEDBACK_BY_LEVEL.hard)).toBe('all');
    expect(capTier('perfect', FULL_FEEDBACK)).toBe('perfect');
  });

  it('follow the level only while the setting is on', () => {
    expect(feedbackFor('easy', true)).toBe(FEEDBACK_BY_LEVEL.easy);
    expect(feedbackFor('easy', false)).toBe(FULL_FEEDBACK);
    expect(DEFAULT_SETTINGS.feedbackByLevel).toBe(true);
    expect(sanitize({ feedbackByLevel: false }).feedbackByLevel).toBe(false);
    expect(sanitize({ feedbackByLevel: 'no' }).feedbackByLevel).toBe(true);
    expect(urlOverrides('?feedbackByLevel=0').feedbackByLevel).toBe(false);
  });

  it('on Easy show no words over hits or misses, no streak counter and fewer particles', () => {
    const { session, goTo, press, notes } = harness({ tierText: 'all', feedback: FEEDBACK_BY_LEVEL.easy });
    expect(session.fx.intensity).toBe(0.5);
    for (const [t, p] of notes.slice(0, 10)) { goTo(t); press(p); }
    goTo(6.4); // the eleventh note went by
    expect(session.judge.combo).toBe(0);
    expect(session.judge.counts.miss).toBe(1);
    expect(session.popups).toHaveLength(0);
    expect(session.fx.streak.value).toBe(0);
    expect(session.fx.streak.shatterLife).toBe(0);
    expect(session.fx.glow.life).toBe(0);
    expect(session.fx.callouts.some((c) => c.active)).toBe(false);
    // the key still flashes red and the particles still burst, only fewer of them
    expect(session.fx.flashes.some((f) => f.active)).toBe(true);
    expect(session.fx.particles.some((p) => p.active)).toBe(true);
  });

  it('on Medium keep Perfect and Miss words and the milestone, but not the counter behind the notes', () => {
    const { session, goTo, press, notes } = harness({ tierText: 'all', feedback: FEEDBACK_BY_LEVEL.medium });
    for (const [t, p] of notes.slice(0, 10)) { goTo(t); press(p); }
    goTo(5.6); // the frame after the tenth hit reports the multiplier
    expect(session.popups.every((p) => p.text === 'Perfect')).toBe(true);
    expect(session.popups.length).toBeGreaterThan(0);
    expect(session.fx.streak.value).toBe(0);
    expect(session.fx.meters.multiplier).toBe(2);
    expect(session.fx.glow.life).toBe(0); // the badge pulses, the edges stay dark
    expect(session.fx.meters.multiplierPulse).toBeGreaterThan(0);
    expect(session.fx.callouts.some((c) => c.active && c.text.includes('STREAK'))).toBe(true);
    goTo(6.4);
    expect(session.popups.at(-1)?.text).toBe('Miss');
    expect(session.fx.streak.shatterLife).toBe(0);
  });

  it('with the full profile show everything, as before', () => {
    const { session, goTo, press, notes } = harness({ tierText: 'all' });
    for (const [t, p] of notes.slice(0, 10)) { goTo(t); press(p); }
    goTo(5.6);
    expect(session.fx.streak.value).toBe(10);
    expect(session.fx.glow.life).toBeGreaterThan(0);
    goTo(6.4);
    expect(session.fx.streak.shatterLife).toBeGreaterThan(0);
    expect(session.fx.streak.shatterValue).toBe(10);
  });
});
