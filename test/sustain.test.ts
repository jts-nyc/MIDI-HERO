import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG, HOLD_POINTS_PER_BEAT, Judge } from '../src/game/judge.ts';
import { PlaySession } from '../src/game/session.ts';
import { buildChart, type Chart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { activeCount } from '../src/render/fx.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
/** Notes as [beat, pitch, beats long] at 120 BPM: a beat is 0.5 s. */
type N = [number, number, number];
function chartOf(notes: N[], bpm = 120): Chart {
  const evs = notes.flatMap(([b, p, len]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
  const last = Math.max(...notes.map(([b, , len]) => b + len));
  return buildChart(parseSong(smf([[tempo(0, bpm), ...evs, end(Math.round(last * PPQ) + PPQ)]])), { parts: [{ track: 0, channel: 0 }] });
}
const judge = (notes: N[], bpm = 120) => new Judge(chartOf(notes, bpm), DEFAULT_JUDGE_CONFIG);
const holdEvents = (j: Judge) => j.takeEvents().filter((e) => e.type === 'held' || e.type === 'released').map((e) => [e.type, e.noteId, e.streak]);

describe('hold accounting', () => {
  it('notes of a beat or more are sustains', () => {
    const j = judge([[0, 60, 0.5], [2, 62, 0.99], [4, 64, 1], [8, 65, 4]]);
    expect([0, 1, 2, 3].map((i) => j.isSustain(i))).toEqual([false, false, true, true]);
    expect(j.beatsOf(3)).toBeCloseTo(4, 9);
  });

  it('pays one point per 1/16 beat while the key is down, to the end of the note', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]); // note 0: 1.0 s to 2.0 s
    j.noteOn(60, 1);
    expect(j.score).toBe(100);
    expect(j.holds).toHaveLength(1);
    j.advance(1.25); // half a beat held
    expect(j.score).toBe(100 + 8);
    j.advance(1.5);
    expect(j.score).toBe(100 + 16);
    j.advance(2.5); // the note ended at 2.0
    expect(j.score).toBe(100 + 2 * HOLD_POINTS_PER_BEAT);
    expect(j.holdScore).toBe(32);
    expect(j.holds).toHaveLength(0);
    expect(holdEvents(j)).toEqual([['held', 0, 32]]);
    j.noteOff(60, 2.6); // letting go afterwards changes nothing
    expect(j.score).toBe(132);
  });

  it('an early release forfeits the rest of the tail', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]);
    j.noteOn(60, 1);
    j.advance(1.2);
    j.noteOff(60, 1.3); // 0.3 s = 0.6 beats: 9 sixteenths
    expect(j.holdScore).toBe(9);
    expect(holdEvents(j)).toEqual([['released', 0, 9]]);
    j.advance(3);
    expect(j.score).toBe(109);
    expect(j.holds).toHaveLength(0);
  });

  it('letting go within 1/8 beat of the end still counts as held', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]);
    j.noteOn(60, 1);
    j.noteOff(60, 1.95); // 0.1 beat before the end
    expect(j.holdScore).toBe(32);
    expect(holdEvents(j)).toEqual([['held', 0, 32]]);
  });

  it('the pedal holds the note after the key is up', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]);
    j.noteOn(60, 1);
    j.pedal(true, 1.1);
    j.noteOff(60, 1.2);
    expect(j.holds).toHaveLength(1);
    j.advance(1.5);
    expect(j.holdScore).toBe(16);
    j.advance(2.1);
    expect(j.holdScore).toBe(32);
    expect(holdEvents(j)).toEqual([['held', 0, 32]]);
  });

  it('lifting the pedal lets go of a note whose key is already up', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]);
    j.pedal(true, 0.5);
    j.noteOn(60, 1);
    j.noteOff(60, 1.1);
    j.pedal(false, 1.5);
    expect(j.holdScore).toBe(16);
    expect(holdEvents(j)).toEqual([['released', 0, 16]]);
  });

  it('lifting the pedal while the key is down changes nothing', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]]);
    j.noteOn(60, 1);
    j.pedal(true, 1.1);
    j.pedal(false, 1.4);
    j.advance(2.1);
    expect(j.holdScore).toBe(32);
  });

  it('counts from the start of the note, however early or late the hit was', () => {
    const late = judge([[2, 60, 2], [8, 62, 1]]);
    late.noteOn(60, 1.06);
    late.advance(2.1);
    expect(late.holdScore).toBe(32);
    const early = judge([[2, 60, 2], [8, 62, 1]]);
    early.noteOn(60, 0.95);
    early.advance(0.99);
    expect(early.holdScore).toBe(0);
    early.advance(2.1);
    expect(early.holdScore).toBe(32);
  });

  it('short notes and late hits start no hold', () => {
    const j = judge([[2, 60, 0.5], [4, 62, 2], [8, 64, 1]]);
    j.noteOn(60, 1);
    expect(j.holds).toHaveLength(0);
    j.noteOn(62, 2.13); // late: consumed, no credit
    expect(j.counts.late).toBe(1);
    expect(j.holds).toHaveLength(0);
    j.advance(4);
    expect(j.holdScore).toBe(0);
  });

  it('holds each note of a chord on its own', () => {
    const j = judge([[2, 60, 2], [2, 64, 2], [8, 62, 1]]);
    j.noteOn(60, 1);
    j.noteOn(64, 1);
    j.noteOff(64, 1.5);
    j.advance(2.1);
    expect(holdEvents(j)).toEqual([['released', 1, 16], ['held', 0, 32]]);
    expect(j.holdScore).toBe(48);
  });

  it('hold points take the multiplier, and the star multiplier', () => {
    const notes: N[] = [...Array.from({ length: 10 }, (_, i): N => [i, 60 + (i % 5), 0.5]), [10, 72, 2], [16, 60, 1]];
    const j = judge(notes);
    for (let i = 0; i < 10; i++) j.noteOn(60 + (i % 5), i * 0.5);
    expect(j.multiplier).toBe(2);
    const before = j.score;
    j.noteOn(72, 5);
    j.advance(5.5); // one beat at 2x
    expect(j.score - before).toBe(200 + 16 * 2);
    j.starGauge = 1;
    j.activateStar(5.5);
    j.advance(6); // one more beat at 2x times 2
    expect(j.score - before).toBe(200 + 16 * 2 + 16 * 4);
  });

  it('measures the hold in beats, not seconds', () => {
    const j = judge([[2, 60, 2], [8, 62, 1]], 60); // a beat is 1 s: the note runs from 2 s to 4 s
    j.noteOn(60, 2);
    j.advance(3);
    expect(j.holdScore).toBe(16);
    j.advance(4.1);
    expect(j.holdScore).toBe(32);
  });

  it('easy mode follows the key that played the note, in any octave', () => {
    const j = new Judge(chartOf([[2, 60, 2], [8, 62, 1]]), { ...DEFAULT_JUDGE_CONFIG, easy: true });
    j.noteOn(72, 1);
    j.advance(1.25);
    j.noteOff(72, 1.5);
    expect(j.holdScore).toBe(16);
  });
});

describe('PlaySession: sustains', () => {
  function harness(notes: N[], autoplay = false) {
    const chart = chartOf(notes);
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: autoplay ? { jitterMs: 0 } : null, hint: '',
    });
    const goTo = (songTime: number) => {
      t.perfMs += (songTime - session.now()) * 1000;
      session.update();
    };
    const key = (type: 'on' | 'off', pitch: number) => session.handleInput({ type, pitch, velocity: type === 'on' ? 90 : 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const pedal = (value: number) => session.handleInput({ type: 'pedal', pitch: -1, velocity: value, channel: 0, perfMs: t.perfMs, source: 'midi' });
    return { session, goTo, key, pedal };
  }
  const song: N[] = [[2, 60, 2], [6, 62, 0.5], [8, 64, 2]];

  it('marks the note as holding, then held', () => {
    const { session, goTo, key } = harness(song);
    goTo(1);
    key('on', 60);
    expect(session.noteVisuals[0]).toMatchObject({ state: 'hit', hold: 'holding', holdEnd: 2 });
    goTo(1.5);
    expect(session.noteVisuals[0]!.hold).toBe('holding');
    expect(activeCount(session.fx.particles)).toBeGreaterThan(14); // sparks on top of the hit burst
    goTo(2.05);
    expect(session.noteVisuals[0]).toMatchObject({ hold: 'held' });
    expect(session.judge.holdScore).toBe(32);
    key('off', 60);
    expect(session.noteVisuals[0]!.hold).toBe('held');
  });

  it('an early release cuts the trail where the key went up', () => {
    const { session, goTo, key } = harness(song);
    goTo(1);
    key('on', 60);
    goTo(1.4);
    key('off', 60);
    goTo(1.42);
    expect(session.noteVisuals[0]).toMatchObject({ state: 'hit', hold: 'released' });
    expect(session.noteVisuals[0]!.holdEnd).toBeCloseTo(1.4, 6);
    expect(session.judge.holdScore).toBe(12);
    expect(session.judge.combo).toBe(1); // the streak is not touched
  });

  it('the pedal holds through the tail', () => {
    const { session, goTo, key, pedal } = harness(song);
    goTo(1);
    key('on', 60);
    pedal(100);
    goTo(1.2);
    key('off', 60);
    goTo(2.1);
    expect(session.noteVisuals[0]!.hold).toBe('held');
    expect(session.judge.holdScore).toBe(32);
    pedal(0);
  });

  it('short notes have no hold', () => {
    const { session, goTo, key } = harness(song);
    goTo(3);
    key('on', 62);
    expect(session.noteVisuals[1]).toEqual({ state: 'hit', hitTime: 3, judgment: 'perfect' });
  });

  it('waits for a hold on the last note before the song ends', () => {
    const { session, goTo, key } = harness([[2, 60, 0.5], [4, 62, 4]]);
    goTo(1);
    key('on', 60);
    goTo(2);
    key('on', 62);
    goTo(3.9);
    expect(session.status).toBe('playing');
    goTo(4.7);
    expect(session.status).toBe('finished');
    expect(session.judge.holdScore).toBe(64);
  });

  it('autoplay holds every sustain to its end', () => {
    const { session, goTo } = harness(song, true);
    for (let t = -3; t < 12 && session.status === 'playing'; t += 1 / 60) goTo(t);
    expect(session.status).toBe('finished');
    expect(session.judge.holdScore).toBe(64);
    expect(session.noteVisuals.map((v) => v.hold)).toEqual(['held', undefined, 'held']);
  });
});
