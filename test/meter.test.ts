import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth, WebAudioSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG, Judge, multiplierProgress, type JudgeConfig } from '../src/game/judge.ts';
import { DEFAULT_METER, isMilestone, LOW_HEALTH, PerformanceMeter } from '../src/game/meter.ts';
import { PlaySession } from '../src/game/session.ts';
import { buildChart, type Chart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const secs = (s: number) => Math.round(s * 2 * PPQ);

/** `n` notes one second apart from t = 1, pitches cycling over three keys. */
function chart(n: number): Chart {
  const evs = Array.from({ length: n }, (_, i) => [on(secs(1 + i), 60 + (i % 3)), off(secs(1 + i) + PPQ / 2, 60 + (i % 3))]).flat();
  return buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(secs(n + 1))]])), { parts: [{ track: 0, channel: 0 }] });
}
const cfg = (over: Partial<JudgeConfig> = {}): JudgeConfig => ({ ...DEFAULT_JUDGE_CONFIG, ...over });
const hit = (j: Judge, i: number) => j.noteOn(60 + (i % 3), 1 + i);

describe('PerformanceMeter', () => {
  it('adds 0.03 per hit and takes 0.08 per miss and 0.04 per wrong note', () => {
    const m = new PerformanceMeter({ start: 0.5 });
    m.hit();
    expect(m.health).toBeCloseTo(0.53, 9);
    m.miss();
    expect(m.health).toBeCloseTo(0.45, 9);
    m.wrong();
    expect(m.health).toBeCloseTo(0.41, 9);
    m.late();
    expect(m.health).toBeCloseTo(0.37, 9);
  });

  it('is clamped to 0..1', () => {
    const m = new PerformanceMeter({ start: 0.99 });
    m.hit();
    m.hit();
    expect(m.health).toBe(1);
    for (let i = 0; i < 20; i++) m.miss();
    expect(m.health).toBe(0);
    expect(new PerformanceMeter({ start: 7 }).health).toBe(1);
  });

  it('never fails in class mode and fails at the threshold in arcade mode', () => {
    const cls = new PerformanceMeter({ start: 0.1 });
    cls.miss();
    cls.miss();
    expect(cls.health).toBe(0);
    expect(cls.failed).toBe(false);
    const arcade = new PerformanceMeter({ start: 0.2, failAt: 0 });
    arcade.miss();
    arcade.miss();
    expect(arcade.failed).toBe(false);
    arcade.miss();
    expect(arcade.failed).toBe(true);
    arcade.hit(); // no way back
    expect(arcade.failed).toBe(true);
    const early = new PerformanceMeter({ start: 0.5, failAt: 0.25 });
    for (let i = 0; i < 3; i++) early.miss();
    expect(early.failed).toBe(false);
    early.miss();
    expect(early.failed).toBe(true);
  });

  it('has traffic-light zones and thins the mix only when health is low', () => {
    const m = new PerformanceMeter({ start: DEFAULT_METER.start });
    expect(m.zone).toBe('green');
    expect(m.mixLevel).toBe(1);
    m.miss();
    expect(m.zone).toBe('yellow');
    expect(m.mixLevel).toBe(1);
    while (m.health >= LOW_HEALTH) m.miss();
    expect(m.zone).toBe('red');
    expect(m.low).toBe(true);
    expect(m.mixLevel).toBeLessThan(1);
    const before = m.mixLevel;
    m.miss();
    expect(m.mixLevel).toBeLessThan(before);
    while (m.health > 0) m.miss();
    expect(m.mixLevel).toBeCloseTo(0.15, 9);
  });

  it('calls out streaks of 10, 25, 50, 100 and every further 100', () => {
    const called = Array.from({ length: 320 }, (_, i) => i).filter(isMilestone);
    expect(called).toEqual([10, 25, 50, 100, 200, 300]);
  });
});

describe('Judge: streak, multiplier and health', () => {
  it('reports progress toward the next multiplier level', () => {
    expect([0, 5, 9, 10, 20, 29, 30, 40, 50, 80].map(multiplierProgress)).toEqual([0, 0.5, 0.9, 0, 0.5, 0.95, 0, 0.5, 1, 1]);
    const j = new Judge(chart(12), cfg());
    for (let i = 0; i < 5; i++) hit(j, i);
    expect(j.multiplier).toBe(1);
    expect(j.multiplierProgress).toBe(0.5);
  });

  it('emits a level event when the multiplier rises and a milestone at streak 10', () => {
    const j = new Judge(chart(12), cfg());
    for (let i = 0; i < 9; i++) hit(j, i);
    expect(j.takeEvents().every((e) => e.type === 'hit')).toBe(true);
    hit(j, 9);
    expect(j.takeEvents().map((e) => [e.type, e.streak])).toEqual([['hit', undefined], ['level', 2], ['milestone', 10]]);
  });

  it('emits milestones at 10, 25, 50 and 100', () => {
    const j = new Judge(chart(101), cfg());
    for (let i = 0; i < 101; i++) hit(j, i);
    expect(j.takeEvents().filter((e) => e.type === 'milestone').map((e) => e.streak)).toEqual([10, 25, 50, 100]);
  });

  it('a miss breaks the streak and says how long it was', () => {
    const j = new Judge(chart(6), cfg());
    for (let i = 0; i < 4; i++) hit(j, i);
    j.takeEvents();
    j.advance(5.5); // note 4 missed
    expect(j.takeEvents().map((e) => [e.type, e.streak])).toEqual([['miss', undefined], ['break', 4]]);
    j.advance(6.5); // note 5 missed: no streak to break
    expect(j.takeEvents().map((e) => e.type)).toEqual(['miss']);
  });

  it('a wrong note and a late hit break the streak too', () => {
    const j = new Judge(chart(6), cfg());
    hit(j, 0);
    hit(j, 1);
    j.noteOn(70, 2.5);
    expect(j.takeEvents().filter((e) => e.type === 'break').map((e) => e.streak)).toEqual([2]);
    hit(j, 2);
    j.noteOn(60, 4.13); // note 3, late
    expect(j.takeEvents().filter((e) => e.type === 'break').map((e) => e.streak)).toEqual([1]);
  });

  it('ignored wrong notes cost neither the streak nor health', () => {
    const j = new Judge(chart(3), cfg({ wrongNotePenalty: 'none' }));
    hit(j, 0);
    const health = j.meter.health;
    j.noteOn(70, 1.5);
    expect(j.combo).toBe(1);
    expect(j.meter.health).toBe(health);
    expect(j.takeEvents().map((e) => e.type)).toEqual(['hit', 'wrong']);
  });

  it('health follows hits, misses and wrong notes', () => {
    const j = new Judge(chart(4), cfg());
    hit(j, 0);
    j.noteOn(70, 1.5);
    j.advance(3); // note 1 missed
    expect(j.meter.health).toBeCloseTo(DEFAULT_METER.start + 0.03 - 0.04 - 0.08, 9);
  });

  it('fails once in arcade mode and never in class mode', () => {
    const arcade = new Judge(chart(12), cfg({ failAt: 0 }));
    arcade.advance(20);
    expect(arcade.failed).toBe(true);
    expect(arcade.takeEvents().filter((e) => e.type === 'fail')).toHaveLength(1);
    const cls = new Judge(chart(12), cfg());
    cls.advance(20);
    expect(cls.meter.health).toBe(0);
    expect(cls.failed).toBe(false);
  });
});

describe('PlaySession: health', () => {
  function harness(judgeConfig: JudgeConfig, n = 12) {
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart: chart(n), clock: new GameClock(() => t.perfMs), judgeConfig, rate: 1, inputOffsetMs: 0, synth: new RecordingSynth(), relative: false,
      visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '',
    });
    const goTo = (songTime: number) => {
      t.perfMs += (songTime - session.now()) * 1000;
      session.update();
    };
    return { session, goTo };
  }

  it('exposes mixLevel, which falls as notes are missed', () => {
    const { session, goTo } = harness(cfg());
    expect(session.mixLevel).toBe(1);
    goTo(4.5); // 4 misses: 0.6 - 0.32 = 0.28
    expect(session.mixLevel).toBeLessThan(1);
    expect(session.mixLevel).toBeGreaterThan(0.15);
    goTo(9.5);
    expect(session.mixLevel).toBeCloseTo(0.15, 9);
    expect(session.status).toBe('playing');
  });

  it('ends the song when the meter runs out in arcade mode', () => {
    const { session, goTo } = harness(cfg({ failAt: 0 }));
    let result = null as ReturnType<PlaySession['result']> | null;
    session.onFinished = (r) => (result = r);
    for (let t = 0.5; t < 12 && session.status === 'playing'; t += 0.5) goTo(t);
    expect(session.status).toBe('finished');
    expect(result).toMatchObject({ failed: true, judged: 8 });
    expect(result!.progress).toBeGreaterThan(0.4);
    expect(result!.progress).toBeLessThan(0.8);
  });

  it('a finished song is not a failed one', () => {
    const { session, goTo } = harness(cfg(), 3);
    goTo(30);
    expect(session.result()).toMatchObject({ failed: false, progress: 1 });
  });
});

describe('WebAudioSynth channel groups', () => {
  it('groups drum channels and pad programs; everything else, and the player, stays out', () => {
    const synth = new WebAudioSynth(new FakeAudioContext() as unknown as AudioContext);
    synth.setDrumChannels([10]);
    synth.program(1, 48); // strings
    synth.program(2, 0); // piano
    synth.program(3, 89); // synth pad
    synth.program(16, 89); // the player's feedback channel
    expect([9, 10, 1, 2, 3, 16].map((c) => synth.groupOf(c))).toEqual(['drums', 'drums', 'pads', null, 'pads', null]);
    synth.program(1, 0);
    expect(synth.groupOf(1)).toBeNull();
    expect(() => synth.setChannelGroupGain('drums', 0.2)).not.toThrow();
  });
});
