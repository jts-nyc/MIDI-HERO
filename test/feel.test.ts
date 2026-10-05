// The feel layer: timing-word motion, beat pulses, light columns and flares, the badge dip,
// game cues, the frame-time fallback, and the results confetti.
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { CUE_TONES, Sfx, SFX_GAIN, STAR_STEPS } from '../src/audio/sfx.ts';
import { FEEDBACK_BY_LEVEL, FULL_FEEDBACK } from '../src/game/feedback.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type SessionOptions } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { beatPulse, chargeAlpha, countPulse, FEEL, FRAME_STAMP_TRUST_MS, FrameGovernor, frameStamp, GOVERNOR, popupPose, type PopupPose } from '../src/render/feel.ts';
import { activeCount, createFx, emitDrop, emitHit, emitLevel, emitMilestone, emitStar, POOL, stepFx, Tint } from '../src/render/fx.ts';
import { confetti } from '../src/ui/screens.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

describe('timing words', () => {
  const pose: PopupPose = { scale: 0, alpha: 0, rise: 0 };

  it('snap in large, settle to size within the pop-in, and stay fully visible until the fade', () => {
    expect(popupPose(0, pose).scale).toBeCloseTo(FEEL.popup.overshoot);
    expect(popupPose(FEEL.popup.popIn / 2, pose).scale).toBeGreaterThan(1);
    expect(popupPose(FEEL.popup.popIn, pose).scale).toBe(1);
    expect(popupPose(FEEL.popup.life * FEEL.popup.fadeFrom, pose).alpha).toBe(1);
    expect(popupPose(FEEL.popup.life, pose).alpha).toBe(0);
  });

  it('rise, slowing, to their full height at the end of their life', () => {
    const a = popupPose(0.1, pose).rise;
    const b = popupPose(0.2, pose).rise;
    const c = popupPose(0.3, pose).rise;
    expect(b - a).toBeGreaterThan(c - b);
    expect(popupPose(FEEL.popup.life, pose).rise).toBeCloseTo(FEEL.popup.rise);
  });

  it('keep still under reduced motion, and still fade', () => {
    popupPose(0, pose, true);
    expect(pose.scale).toBe(1);
    expect(pose.rise).toBe(0);
    expect(popupPose(FEEL.popup.life, pose, true).alpha).toBe(0);
  });

  it('allocate nothing: the pose is written into the object passed in', () => {
    expect(popupPose(0.2, pose)).toBe(pose);
  });
});

describe('beat pulse', () => {
  const lines = [{ time: 0, isBar: true }, { time: 0.5, isBar: false }, { time: 1, isBar: false }];

  it('is full on a bar line, lighter on a beat, and gone after FEEL.beatPulse', () => {
    expect(beatPulse(lines, 0, 0)).toBe(1);
    expect(beatPulse(lines, 0, 0.5)).toBeCloseTo(FEEL.beatWeight);
    expect(beatPulse(lines, 0, FEEL.beatPulse / 2)).toBeCloseTo(0.5);
    expect(beatPulse(lines, 0, FEEL.beatPulse + 0.001)).toBe(0);
  });

  it('ignores lines that have not reached the hit line yet', () => {
    expect(beatPulse(lines, 0, 0.49)).toBe(0);
    expect(beatPulse([], 0, 1)).toBe(0);
  });

  it('pulses on each click of the count-in, decaying through the first third of the beat', () => {
    expect(countPulse(0)).toBe(1);
    expect(countPulse(1 / 3)).toBe(0);
  });

  it('charge light grows with the multiplier and is brightest in star power', () => {
    expect(chargeAlpha(1, false)).toBe(0);
    expect(chargeAlpha(2, false)).toBeLessThan(chargeAlpha(3, false));
    expect(chargeAlpha(3, false)).toBeLessThan(chargeAlpha(4, false));
    expect(chargeAlpha(4, false)).toBeLessThan(chargeAlpha(4, true));
    expect(chargeAlpha(9, false)).toBe(chargeAlpha(4, false));
  });
});

describe('light columns, flares and the badge dip', () => {
  it('a hit lights a column by judgment; an early/late miss does not', () => {
    const fx = createFx(() => 0.5);
    emitHit(fx, 60, 'perfect');
    emitHit(fx, 62, 'good');
    emitHit(fx, 64, 'late');
    const beams = fx.beams.filter((b) => b.active);
    expect(beams.map((b) => b.pitch)).toEqual([60, 62]);
    expect(beams[0]!.strength).toBeGreaterThan(beams[1]!.strength);
    expect(beams[0]!.life).toBe(FEEL.beamLife.perfect);
  });

  it('columns expire after their life and the pool never grows', () => {
    const fx = createFx(() => 0.5);
    for (let i = 0; i < POOL.beams * 3; i++) emitHit(fx, 60 + (i % 12), 'great');
    expect(fx.beams.length).toBe(POOL.beams);
    expect(activeCount(fx.beams)).toBe(POOL.beams);
    stepFx(fx, FEEL.beamLife.great + 0.001);
    expect(activeCount(fx.beams)).toBe(0);
  });

  it('effects off: no columns or flares, the meters still move', () => {
    const fx = createFx();
    fx.enabled = false;
    emitHit(fx, 60, 'perfect');
    emitMilestone(fx, 25);
    emitStar(fx);
    expect(activeCount(fx.beams)).toBe(0);
    expect(fx.surge.life).toBe(0);
    emitDrop(fx, 12);
    expect(fx.meters.multiplierDrop).toBe(1);
  });

  it('a milestone, a level-up with glow and star power flare along the hit line, and the flare ends', () => {
    const fx = createFx();
    emitMilestone(fx, 25);
    expect(fx.surge.life).toBe(FEEL.surgeLife);
    stepFx(fx, FEEL.surgeLife + 0.01);
    expect(fx.surge.life).toBe(0);
    emitLevel(fx, 2, false);
    expect(fx.surge.life).toBe(0);
    emitLevel(fx, 4, true);
    expect(fx.surge.tint).toBe(Tint.perfect);
    emitStar(fx);
    expect(fx.surge.tint).toBe(Tint.gold);
  });

  it('the badge dips only when a streak that carried a multiplier breaks, and recovers', () => {
    const fx = createFx();
    emitDrop(fx, 9);
    expect(fx.meters.multiplierDrop).toBe(0);
    emitDrop(fx, 10);
    expect(fx.meters.multiplierDrop).toBe(1);
    stepFx(fx, FEEL.dropLife / 2);
    expect(fx.meters.multiplierDrop).toBeCloseTo(0.5);
    stepFx(fx, FEEL.dropLife);
    expect(fx.meters.multiplierDrop).toBe(0);
    emitDrop(fx, 30);
    emitLevel(fx, 2, false); // climbing back cancels the dip
    expect(fx.meters.multiplierDrop).toBe(0);
  });
});

describe('game cues', () => {
  const PPQ = 480;
  const secs = (s: number) => Math.round(s * 2 * PPQ);

  function harness(over: Partial<SessionOptions> = {}) {
    const notes: [number, number][] = Array.from({ length: 14 }, (_, i) => [1 + i * 0.5, 60 + (i % 5)]);
    const evs = notes.flatMap(([t, p]) => [on(secs(t), p), off(secs(t + 0.2), p)]);
    const chart = buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(secs(9))]])), { parts: [{ track: 0, channel: 0 }] });
    const t = { perfMs: 10_000 };
    const cues: string[] = [];
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', cue: (c) => cues.push(c), ...over,
    });
    const goTo = (songTime: number) => {
      t.perfMs += (songTime - session.now()) * 1000;
      session.update();
    };
    const press = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const release = (pitch: number) => session.handleInput({ type: 'off', pitch, velocity: 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
    /** play the first `n` notes on time */
    const play = (n: number) => notes.slice(0, n).forEach(([time, pitch]) => { goTo(time); press(pitch); release(pitch); });
    return { session, goTo, play, cues };
  }

  it('a streak of 10 rings the level-up and the milestone', () => {
    const { play, cues } = harness({ feedback: FULL_FEEDBACK });
    play(10);
    expect(cues).toContain('level');
    expect(cues).toContain('milestone');
  });

  it('breaking a streak of 10+ sounds on Hard and is silent on Easy, where only the badge dips', () => {
    for (const [profile, sound] of [[FULL_FEEDBACK, true], [FEEDBACK_BY_LEVEL.easy, false]] as const) {
      const { play, goTo, session, cues } = harness({ feedback: profile });
      play(11);
      goTo(7.5); // note 12 goes by unplayed
      expect(cues.includes('break')).toBe(sound);
      expect(session.fx.meters.multiplierDrop).toBeGreaterThan(0);
    }
  });

  it('Easy hears no milestone, because it shows none', () => {
    const { play, cues } = harness({ feedback: FEEDBACK_BY_LEVEL.easy });
    play(10);
    expect(cues).not.toContain('milestone');
  });
});

describe('cue sounds', () => {
  it('are short and quiet: every tone under half a second, the bus well under the synth', () => {
    for (const tones of Object.values(CUE_TONES)) {
      for (const t of tones) {
        expect(t.at + t.len).toBeLessThan(0.8);
        expect(t.peak).toBeLessThanOrEqual(0.25);
      }
    }
    expect(SFX_GAIN).toBeLessThanOrEqual(0.4);
  });

  it('start oscillators that stop themselves, and a burst of the same cue makes one sound', () => {
    const ctx = new FakeAudioContext();
    const sfx = new Sfx(ctx as unknown as AudioContext);
    sfx.play('milestone');
    sfx.play('milestone');
    expect(ctx.oscillators.length).toBe(CUE_TONES.milestone.length);
    expect(ctx.oscillators.every((o) => o.stopped !== null && o.stopped > o.started!)).toBe(true);
    sfx.play('star', 4);
    expect(ctx.oscillators.at(-2)!.frequency.value).toBeCloseTo(440 * 2 ** (STAR_STEPS[4] / 12));
    sfx.enabled = false;
    sfx.play('fanfare');
    expect(ctx.oscillators.length).toBe(CUE_TONES.milestone.length + 2);
  });
});

describe('frame-time fallback', () => {
  const feed = (g: FrameGovernor, ms: number, frames: number) => {
    const changes: number[] = [];
    for (let i = 0; i < frames; i++) {
      const c = g.sample(ms);
      if (c !== null) changes.push(c);
    }
    return changes;
  };

  it('holds full effects at 60 fps, and ignores the warm-up', () => {
    const g = new FrameGovernor();
    expect(feed(g, 40, GOVERNOR.warmup)).toEqual([]);
    expect(feed(g, 16.7, GOVERNOR.window * 20)).toEqual([]);
    expect(g.level).toBe(0);
  });

  it('steps down one level per slow window, to the floor of 2', () => {
    const g = new FrameGovernor();
    feed(g, 16.7, GOVERNOR.warmup);
    expect(feed(g, 28, GOVERNOR.window)).toEqual([1]);
    expect(feed(g, 28, GOVERNOR.window * 3)).toEqual([2]);
    expect(g.level).toBe(2);
  });

  it('does not count hitches (a paused or hidden tab) as slow frames', () => {
    const g = new FrameGovernor();
    feed(g, 16.7, GOVERNOR.warmup);
    for (let i = 0; i < GOVERNOR.window * 3; i++) g.sample(i % 2 ? 16.7 : 900);
    expect(g.level).toBe(0);
  });

  it('a quarter of the frames slow is enough; a few are not', () => {
    const run = (every: number) => {
      const g = new FrameGovernor();
      feed(g, 16.7, GOVERNOR.warmup);
      for (let i = 0; i < GOVERNOR.window; i++) g.sample(i % every === 0 ? 34 : 16.7);
      return g.level;
    };
    expect(run(3)).toBe(1); // a third of frames slow
    expect(run(20)).toBe(0); // 5% slow
  });

  it('steps back up after a long good run, only once a song, never below its floor', () => {
    const g = new FrameGovernor();
    feed(g, 16.7, GOVERNOR.warmup);
    feed(g, 28, GOVERNOR.window);
    expect(g.level).toBe(1);
    expect(feed(g, 16.7, GOVERNOR.window * GOVERNOR.recoverWindows)).toEqual([0]);
    feed(g, 28, GOVERNOR.window);
    expect(g.level).toBe(1);
    expect(feed(g, 16.7, GOVERNOR.window * GOVERNOR.recoverWindows * 3)).toEqual([]);
    const floor = new FrameGovernor(2);
    expect(floor.level).toBe(2);
    feed(floor, 16.7, GOVERNOR.warmup + GOVERNOR.window * GOVERNOR.recoverWindows * 2);
    expect(floor.level).toBe(2);
  });

  it('a new song keeps the level but judges afresh', () => {
    const g = new FrameGovernor();
    feed(g, 16.7, GOVERNOR.warmup);
    feed(g, 28, GOVERNOR.window);
    g.reset();
    expect(g.level).toBe(1);
    expect(feed(g, 28, GOVERNOR.warmup)).toEqual([]);
  });
});

describe('results confetti', () => {
  it('is a fixed set of pieces, the same every time', () => {
    const html = confetti(12);
    expect(html.match(/<i /g)!.length).toBe(12);
    expect(confetti(12)).toBe(html);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('frameStamp: the instant a frame is drawn at (full game and simple mode)', () => {
  it('uses the frame timestamp when it is from the last few frames', () => {
    expect(frameStamp(1000, 1004)).toBe(1000);
    expect(frameStamp(1004, 1004)).toBe(1004);
  });

  it('falls back to now for a stale or future timestamp', () => {
    expect(frameStamp(1000 - FRAME_STAMP_TRUST_MS, 1000)).toBe(1000);
    expect(frameStamp(1010, 1004)).toBe(1004);
    expect(frameStamp(0, 5000)).toBe(5000);
  });
});
