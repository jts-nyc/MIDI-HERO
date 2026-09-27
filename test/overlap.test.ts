// Keys held down over the notes that follow (finger legato, or a student who does not let go):
// in Ode to Joy, G F E D kept down until the C has landed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession, type FeedbackSound } from '../src/game/session.ts';
import { buildChart } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';

const G = 67, F = 65, E = 64, D = 62, C = 60;

function play(style: 'clean' | 'held', feedbackSound: FeedbackSound = 'chart') {
  const song = parseSong(new Uint8Array(readFileSync(join(process.cwd(), 'public/songs/ode-to-joy.mid'))));
  const chart = buildChart(song, { parts: [{ track: 1, channel: 0 }], difficulty: 'easy', window: { low: 48, high: 72 } });
  const start = chart.notes.findIndex((_, i) => [G, F, E, D, C].every((p, k) => chart.notes[i + k]?.pitch === p));
  const t = { perfMs: 0 };
  const synth = new RecordingSynth();
  const session = new PlaySession({
    chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
    visibleSeconds: 1, barSeconds: 2.4, autoplay: null, hint: '', feedbackSound,
  });
  const goTo = (songTime: number) => {
    while (session.now() < songTime - 1e-9 && session.status === 'playing') {
      t.perfMs += Math.min(1000 / 60, (songTime - session.now()) * 1000);
      session.update();
    }
  };
  const key = (type: 'on' | 'off', pitch: number) => session.handleInput({ type, pitch, velocity: type === 'on' ? 90 : 0, channel: 0, perfMs: t.perfMs, source: 'midi' });
  const lit: number[][] = [];
  for (let i = 0; i <= start + 4; i++) {
    const n = chart.notes[i]!;
    goTo(n.time);
    key('on', n.pitch);
    if (i >= start) lit.push([...session.keyVisuals.keys()]);
    if (style === 'held' && i >= start && i < start + 4) continue; // keep it down
    goTo(n.time + n.duration * 0.9);
    key('off', n.pitch);
  }
  if (style === 'held') for (const p of [G, F, E, D]) key('off', p);
  goTo(chart.notes[start + 4]!.time + 1);
  return { session, synth, lit, ids: [0, 1, 2, 3, 4].map((k) => start + k) };
}

describe('keys held down over the following notes', () => {
  it('every note of the descent is still a hit, and the score is the same as with clean releases', () => {
    const clean = play('clean');
    const held = play('held');
    expect(held.ids.map((i) => held.session.judge.judgments[i])).toEqual(['perfect', 'perfect', 'perfect', 'perfect', 'perfect']);
    expect(held.session.judge.counts).toEqual(clean.session.judge.counts);
    expect(held.session.judge.counts).toMatchObject({ miss: 0, wrong: 0, late: 0 });
    expect(held.session.judge.score).toBe(clean.session.judge.score);
    expect(held.session.judge.combo).toBe(clean.session.judge.combo);
    expect(held.session.judge.meter.health).toBe(clean.session.judge.meter.health);
  });

  it('a hold is paid to the written end of its note and no further', () => {
    const held = play('held');
    expect(held.ids.map((i) => held.session.noteVisuals[i]!.hold)).toEqual(['held', 'held', 'held', 'held', 'held']);
    expect(held.session.judge.holdScore).toBe(play('clean').session.judge.holdScore);
    expect(held.session.judge.holds).toHaveLength(0);
  });

  it('the keys stay lit for as long as they are down, and go dark when they are let go', () => {
    const held = play('held');
    expect(held.lit).toEqual([[G], [G, F], [G, F, E], [G, F, E, D], [G, F, E, D, C]]);
    expect([...held.session.keyVisuals.keys()]).toEqual([]);
    expect(play('clean').lit.at(-1)).toEqual([D, C]); // D is still fading out
  });

  it('with chart feedback the melody sounds as written; with free-play sound the held keys ring on', () => {
    const calls = (s: RecordingSynth) => s.calls.filter((c) => c.method === 'noteOn' || c.method === 'noteOff').map((c) => `${c.method}:${String(c.args[1])}`);
    expect(calls(play('held').synth)).toEqual(calls(play('clean').synth));
    const press = calls(play('held', 'press').synth);
    // G is switched on first and off only after C has started
    expect(press.indexOf(`noteOff:${G}`)).toBeGreaterThan(press.lastIndexOf(`noteOn:${C}`));
    expect(play('held', 'press').session.judge.score).toBe(play('clean').session.judge.score);
  });
});
