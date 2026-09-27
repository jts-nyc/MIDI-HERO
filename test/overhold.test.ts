import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth, WebAudioSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG, Judge, OVERHOLD_COST, type JudgeConfig } from '../src/game/judge.ts';
import { PlaySession, type FeedbackSound } from '../src/game/session.ts';
import { buildChart, type Chart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { activeCount } from '../src/render/fx.ts';
import { DEFAULT_SETTINGS, sanitize } from '../src/ui/settings.ts';
import { FakeAudioContext } from './helpers/fakeAudio.ts';
import { end, off, on, smf, tempo } from './helpers/smf.ts';

const PPQ = 480;
const ON: JudgeConfig = { ...DEFAULT_JUDGE_CONFIG, overhold: OVERHOLD_COST.medium };
const at = (level: 'easy' | 'medium' | 'hard' | 'expert'): JudgeConfig => ({ ...DEFAULT_JUDGE_CONFIG, overhold: OVERHOLD_COST[level] });
/** Notes as [beat, pitch, beats long]. At 120 BPM a beat is 0.5 s. */
type N = [number, number, number];
function chartOf(notes: N[], bpm = 120): Chart {
  const evs = notes.flatMap(([b, p, len]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
  const last = Math.max(...notes.map(([b, , len]) => b + len));
  return buildChart(parseSong(smf([[tempo(0, bpm), ...evs, end(Math.round(last * PPQ) + 4 * PPQ)]])), { parts: [{ track: 0, channel: 0 }] });
}
const overheld = (j: Judge) => j.takeEvents().filter((e) => e.type === 'overheld').map((e) => [e.noteId, e.pitch, +e.time.toFixed(3)]);
// two half-beat notes: 60 from 1.0 s to 1.25 s, 62 from 1.5 s to 1.75 s, and a late one
const song: N[] = [[2, 60, 0.5], [3, 62, 0.5], [12, 64, 0.5]];

describe('holding a key too long', () => {
  it('is not noticed unless it is switched on (Easy)', () => {
    const j = new Judge(chartOf(song), DEFAULT_JUDGE_CONFIG);
    j.noteOn(60, 1);
    j.advance(5);
    expect(j.counts.overheld).toBe(0);
    expect(overheld(j)).toEqual([]);
  });

  it('letting go by the end of the note, or a little after, is fine', () => {
    for (const release of [1.1, 1.25, 1.3, 1.39]) {
      const j = new Judge(chartOf(song), ON);
      j.noteOn(60, 1);
      j.advance(release);
      j.noteOff(60, release);
      j.advance(5);
      expect(j.counts.overheld, `released at ${release}`).toBe(0);
    }
  });

  it('a key still down 150 ms after the note is held too long: one event, once', () => {
    const j = new Judge(chartOf(song), ON);
    j.noteOn(60, 1);
    j.advance(1.39);
    expect(j.counts.overheld).toBe(0);
    j.advance(1.41);
    expect(j.counts.overheld).toBe(1);
    expect(overheld(j)).toEqual([[0, 60, 1.4]]);
    j.advance(3);
    j.noteOff(60, 3.2);
    expect(j.counts.overheld).toBe(1);
    expect(overheld(j)).toEqual([]);
  });

  it('is noticed when the key comes up late, even if no frame came in between', () => {
    const j = new Judge(chartOf(song), ON);
    j.noteOn(60, 1);
    j.noteOff(60, 1.6);
    expect(overheld(j)).toEqual([[0, 60, 1.4]]);
  });

  it('legato is not a mistake: the next note may start while the last key is coming up', () => {
    const j = new Judge(chartOf([[2, 60, 1], [3, 62, 1], [4, 64, 1], [12, 65, 1]]), ON);
    j.noteOn(60, 1);
    j.advance(1.5);
    j.noteOn(62, 1.5); // 60 is still down
    j.advance(1.6);
    j.noteOff(60, 1.6); // 100 ms of overlap
    j.advance(2);
    j.noteOn(64, 2);
    j.noteOff(62, 2.12);
    j.advance(2.5);
    j.noteOff(64, 2.5);
    j.advance(3);
    expect(j.counts.overheld).toBe(0);
    expect(j.counts.perfect).toBe(3);
  });

  // two notes hit perfectly, both keys left down
  const play = (config: JudgeConfig) => {
    const j = new Judge(chartOf(song), config);
    j.noteOn(60, 1);
    j.advance(1.5);
    j.noteOn(62, 1.5);
    j.advance(3);
    return j;
  };

  it('costs nothing on Easy, a little on Medium, more on Hard', () => {
    const clean = play(DEFAULT_JUDGE_CONFIG);
    expect([clean.score, clean.combo]).toEqual([200, 2]);
    const rows = (['easy', 'medium', 'hard'] as const).map((level) => {
      const j = play(at(level));
      return [j.counts.overheld, j.score, j.overholdLoss, j.combo, +(clean.meter.health - j.meter.health).toFixed(2), j.accuracy];
    });
    expect(rows).toEqual([
      [0, 200, 0, 2, 0, 1],
      [2, 180, 20, 2, 0.04, 1],
      [2, 150, 50, 2, 0.08, 1],
    ]);
  });

  it('on Expert it also ends the streak, like a wrong note', () => {
    const j = play(at('expert'));
    // the first key bonks before the second note is played, so the streak never gets past 1
    expect([j.counts.overheld, j.score, j.combo, j.maxCombo, j.accuracy]).toEqual([2, 100, 0, 1, 1]);
    expect(j.takeEvents().filter((e) => e.type === 'break').map((e) => e.streak)).toEqual([1, 1]);
  });

  it('on Medium the cost is a tenth of a Perfect and a quarter of what a miss takes from the meter', () => {
    expect(OVERHOLD_COST.easy).toBeNull();
    expect(OVERHOLD_COST.medium).toEqual({ points: 10, health: 0.02, breaksStreak: false });
    expect(OVERHOLD_COST.medium!.points).toBeLessThan(OVERHOLD_COST.hard!.points);
    expect(OVERHOLD_COST.hard!.points).toBeLessThan(OVERHOLD_COST.expert!.points);
  });

  it('never takes the score below zero, and reports what it took', () => {
    const j = new Judge(chartOf(song), at('expert'));
    j.noteOn(60, 1.1); // good: 40 points
    j.advance(3);
    expect(j.score).toBe(0);
    expect(j.overholdLoss).toBe(40);
    expect(j.takeEvents().filter((e) => e.type === 'overheld').map((e) => e.streak)).toEqual([40]);
  });

  it('spoils a star phrase on Expert only', () => {
    const phrases: N[] = Array.from({ length: 4 }, (_, p) => [0, 1, 2, 3].map((i): N => [p * 8 + i, 60 + i, 0.5])).flat();
    const run = (level: 'medium' | 'expert') => {
      const j = new Judge(chartOf(phrases), at(level));
      for (let i = 0; i < 4; i++) {
        const t = 4 + i * 0.5; // phrase 1 is a star phrase
        j.advance(t);
        j.noteOn(60 + i, t);
        if (i > 0) j.noteOff(60 + i, t + 0.2); // the first key stays down
      }
      j.advance(7);
      return j;
    };
    expect(run('medium').starGauge).toBe(0.25);
    expect(run('expert').starGauge).toBe(0);
  });

  it('can fail the song in arcade mode', () => {
    const j = new Judge(chartOf(song), { ...at('hard'), failAt: 0 });
    j.meter.health = 0.03;
    j.noteOn(60, 1); // +0.03
    j.advance(1.3);
    expect(j.failed).toBe(false);
    j.meter.health = 0.04;
    j.advance(1.5);
    expect(j.failed).toBe(true);
  });

  it('the leniency is the longer of 150 ms and a quarter of a beat', () => {
    const grace = (bpm: number, rate = 1) => {
      const j = new Judge(chartOf([[2, 60, 0.5], [12, 62, 0.5]], bpm), ON, rate);
      const end = j.chart.notes[0]!.time + j.chart.notes[0]!.duration;
      return +(j.overholdDeadline(0, j.chart.notes[0]!.time) - end).toFixed(3);
    };
    expect(grace(120)).toBe(0.15); // a quarter of a beat is 125 ms
    expect(grace(60)).toBe(0.25);
    expect(grace(200)).toBe(0.15);
    expect(grace(120, 0.5)).toBe(0.125); // at half speed 150 ms of real time is 75 ms of the song
  });

  it('counts from the hit when a short note was hit late', () => {
    const j = new Judge(chartOf([[2, 60, 0.1], [12, 62, 0.5]]), ON); // 1.0 s to 1.05 s
    expect(j.noteOn(60, 1.1)).toMatchObject({ kind: 'hit', judgment: 'good' });
    expect(j.overholdDeadline(0, 1.1)).toBeCloseTo(1.25, 9);
  });

  it('a sustain held to its end and let go is fine; held on, it is too long', () => {
    const j = new Judge(chartOf([[2, 60, 2], [12, 62, 0.5]]), ON); // 1 s to 2 s
    j.noteOn(60, 1);
    j.advance(2.1);
    expect(j.holdScore).toBe(32);
    expect(j.counts.overheld).toBe(0);
    j.advance(2.2);
    expect(j.counts.overheld).toBe(1);
  });

  it('the pedal does not excuse a key that stays down', () => {
    const j = new Judge(chartOf(song), ON);
    j.pedal(true, 0.9);
    j.noteOn(60, 1);
    j.advance(2);
    expect(j.counts.overheld).toBe(1);
  });

  it('easy mode (any octave) follows the key that was pressed', () => {
    const j = new Judge(chartOf(song), { ...ON, easy: true });
    j.noteOn(72, 1);
    j.noteOff(72, 1.2);
    j.advance(3);
    expect(j.counts.overheld).toBe(0);
  });
});

describe('PlaySession: held too long', () => {
  function harness(notes: N[], feedbackSound: FeedbackSound = 'chart', judgeConfig = ON, window: { low: number; high: number } | null = null) {
    const evs = notes.flatMap(([b, p, len]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
    const chart = buildChart(parseSong(smf([[tempo(0, 120), ...evs, end(40 * PPQ)]])), { parts: [{ track: 0, channel: 0 }], window });
    const t = { perfMs: 0 };
    const synth = new RecordingSynth();
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig, rate: 1, inputOffsetMs: 0, synth, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: null, hint: '', feedbackSound,
    });
    const goTo = (songTime: number) => {
      while (session.now() < songTime - 1e-9 && session.status === 'playing') {
        t.perfMs += Math.min(1000 / 60, (songTime - session.now()) * 1000);
        session.update();
      }
    };
    const key = (type: 'on' | 'off', pitch: number) => session.handleInput({ type, pitch, velocity: type === 'on' ? 90 : 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const bonks = () => synth.calls.filter((c) => c.method === 'bonk').map((c) => c.args);
    return { session, synth, goTo, key, bonks };
  }

  it('bonks the note, turns the key red and says "Let go"', () => {
    const { session, goTo, key, bonks } = harness(song);
    goTo(1);
    key('on', 60);
    goTo(1.38);
    expect(bonks()).toEqual([]);
    expect(session.keyVisuals.get(60)?.kind).toBe('perfect');
    goTo(1.45);
    expect(bonks()).toEqual([[60, 80, 0]]); // the chart note: its pitch and its velocity
    expect(session.keyVisuals.get(60)?.kind).toBe('wrong');
    expect(session.popups.at(-1)).toMatchObject({ text: 'Let go −10', pitch: 60 });
    expect(activeCount(session.fx.flashes)).toBe(1);
    goTo(3);
    expect(bonks()).toHaveLength(1);
    key('off', 60);
    goTo(3.5);
    expect(session.keyVisuals.has(60)).toBe(false);
    expect(session.result().counts.overheld).toBe(1);
    expect(session.result()).toMatchObject({ overholdLoss: 10, score: 90 });
  });

  it('bonks the written pitch of a folded note', () => {
    const { goTo, key, bonks, session } = harness([[2, 40, 0.5], [12, 62, 0.5]], 'chart', ON, { low: 60, high: 84 });
    expect(session.chart.notes[0]).toMatchObject({ pitch: 64, origPitch: 40 });
    goTo(1);
    key('on', 64);
    goTo(1.5);
    expect(bonks()).toEqual([[40, 80, 0]]);
  });

  it('with free-play sound it bonks too; with the sound off it only shows', () => {
    const press = harness(song, 'press');
    press.goTo(1);
    press.key('on', 60);
    press.goTo(1.5);
    expect(press.bonks()).toHaveLength(1);
    const silent = harness(song, 'off');
    silent.goTo(1);
    silent.key('on', 60);
    silent.goTo(1.5);
    expect(silent.synth.calls).toEqual([]);
    expect(silent.session.keyVisuals.get(60)?.kind).toBe('wrong');
  });

  it('a pause lets go of everything', () => {
    const { session, goTo, key, bonks } = harness(song);
    goTo(1);
    key('on', 60);
    goTo(1.2);
    session.pause();
    session.resume();
    goTo(3);
    expect(bonks()).toEqual([]);
    expect(session.judge.counts.overheld).toBe(0);
  });

  it('autoplay never holds too long', () => {
    const chart = chartOf([[2, 60, 0.5], [3, 62, 1], [4, 64, 2], [6, 65, 0.1], [7, 67, 0.5]]);
    const t = { perfMs: 0 };
    const session = new PlaySession({
      chart, clock: new GameClock(() => t.perfMs), judgeConfig: ON, rate: 1, inputOffsetMs: 0, synth: null, relative: false,
      visibleSeconds: 1, barSeconds: 2, autoplay: { jitterMs: 0 }, hint: '',
    });
    while (session.status === 'playing') {
      t.perfMs += 1000 / 60;
      session.update();
    }
    expect(session.result().counts).toMatchObject({ perfect: 5, overheld: 0 });
  });
});

describe('Ode to Joy on Medium: G F E D held down until C', () => {
  it('each of the four bonks a moment after its note is over and costs 10 points; the streak goes on', () => {
    const song = parseSong(new Uint8Array(readFileSync(join(process.cwd(), 'public/songs/ode-to-joy.mid'))));
    const chart = buildChart(song, { parts: [{ track: 1, channel: 0 }], difficulty: 'medium', window: { low: 48, high: 72 } });
    const start = chart.notes.findIndex((_, i) => [67, 65, 64, 62, 60].every((p, k) => chart.notes[i + k]?.pitch === p));
    const run = (held: boolean) => {
      const t = { perfMs: 0 };
      const synth = new RecordingSynth();
      const session = new PlaySession({
        chart: buildChart(song, { parts: [{ track: 1, channel: 0 }], difficulty: 'medium', window: { low: 48, high: 72 } }),
        clock: new GameClock(() => t.perfMs), judgeConfig: ON, rate: 1, inputOffsetMs: 0, synth, relative: false,
        visibleSeconds: 1, barSeconds: 2.4, autoplay: null, hint: '', feedbackSound: 'chart',
      });
      const goTo = (songTime: number) => {
        while (session.now() < songTime - 1e-9) {
          t.perfMs += Math.min(1000 / 60, (songTime - session.now()) * 1000);
          session.update();
        }
      };
      const key = (type: 'on' | 'off', pitch: number) => session.handleInput({ type, pitch, velocity: type === 'on' ? 90 : 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
      for (let i = 0; i <= start + 4; i++) {
        const n = chart.notes[i]!;
        goTo(n.time);
        key('on', n.pitch);
        if (held && i >= start && i < start + 4) continue;
        goTo(n.time + n.duration * 0.9);
        key('off', n.pitch);
      }
      goTo(chart.notes[start + 4]!.time + 0.5);
      return { session, bonks: synth.calls.filter((c) => c.method === 'bonk').map((c) => c.args[0]) };
    };
    const held = run(true);
    const clean = run(false);
    expect(held.bonks).toEqual([67, 65, 64, 62]);
    expect(clean.bonks).toEqual([]);
    expect(held.session.judge.counts.overheld).toBe(4);
    expect(held.session.judge.score).toBe(clean.session.judge.score - 40);
    expect(held.session.judge.combo).toBe(clean.session.judge.combo);
    expect(held.session.judge.accuracy).toBe(1);
    expect(clean.session.judge.meter.health - held.session.judge.meter.health).toBeCloseTo(0.08, 9);
  });
});

describe('the bonk', () => {
  it('is a short cluster of the note and its two neighbours above, sagging as it dies', () => {
    const ctx = new FakeAudioContext();
    const synth = new WebAudioSynth(ctx as unknown as AudioContext);
    synth.bonk(69, 100, 0);
    expect(ctx.oscillators.map((o) => Math.round(o.frequency.value))).toEqual([440, 466, 494]);
    expect(ctx.oscillators.every((o) => o.type === 'square' && o.started === ctx.currentTime)).toBe(true);
    expect(ctx.oscillators.every((o) => o.stopped! - o.started! < 0.35)).toBe(true);
  });

  it('can be switched off in the settings', () => {
    expect(DEFAULT_SETTINGS.letGo).toBe(true);
    expect(sanitize({ letGo: false }).letGo).toBe(false);
  });
});
