import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { FEEDBACK_CHANNEL, RecordingSynth } from '../src/audio/synth.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession } from '../src/game/session.ts';
import { buildChart, levelStats, simplify, splitNotes, type Difficulty } from '../src/midi/chart.ts';
import { BeatGrid } from '../src/midi/difficulty.ts';
import { parsePackJson, buildPack } from '../src/midi/pack.ts';
import { parseSong } from '../src/midi/parse.ts';
import { bestKey } from '../src/storage/db.ts';
import { end, off, on, smf, tempo, timeSig, type AbsEvent } from './helpers/smf.ts';

const PPQ = 480;
const PART = [{ track: 0, channel: 0 }];

/** Notes as [beat, pitch, beats long]; default length half a beat. */
type N = [number, number, number?];

function songOf(notes: N[], bpm = 120, extra: AbsEvent[] = []) {
  const evs = notes.flatMap(([b, p, len = 0.5]) => [on(Math.round(b * PPQ), p), off(Math.round((b + len) * PPQ), p)]);
  const last = Math.max(...notes.map(([b, , len = 0.5]) => b + len));
  return parseSong(smf([[tempo(0, bpm), ...extra, ...evs, end(Math.round(last * PPQ) + PPQ)]]));
}

/** [beat, pitch] of the notes kept at a level. */
function kept(notes: N[], level: Difficulty, bpm = 120, extra: AbsEvent[] = []): [number, number][] {
  const song = songOf(notes, bpm, extra);
  return simplify(splitNotes(song, { parts: PART }).player, level, song).map((n) => [n.tick / PPQ, n.pitch]);
}

// The rules of Easy are provisional (an open decision of the owner's): the
// Easy cases below pin down what it does today so that a change is a choice, not an accident.
describe('simplify', () => {
  const cases: { name: string; level: Difficulty; bpm?: number; notes: N[]; expected: [number, number][] }[] = [
    {
      name: 'easy keeps one note per beat, on the beat',
      level: 'easy',
      notes: [[0, 60], [0.5, 62], [1, 64], [1.5, 65], [2, 67], [2.25, 69, 0.25], [2.75, 71, 0.25]],
      expected: [[0, 60], [1, 64], [2, 67]],
    },
    {
      name: 'easy takes the note nearest the beat, within 1/8 beat',
      level: 'easy',
      notes: [[0.9, 60], [1.1, 62, 0.4], [2.2, 64], [3.05, 65]],
      expected: [[0.9, 60], [3.05, 65]],
    },
    {
      name: 'easy reduces a chord to its top note',
      level: 'easy',
      notes: [[0, 60], [0, 64], [0, 67], [1, 65], [1, 62]],
      expected: [[0, 67], [1, 65]],
    },
    {
      name: 'easy drops notes shorter than 1/8 beat, even on the beat',
      level: 'easy',
      notes: [[0, 60], [1, 62, 0.1], [2, 64, 0.125]],
      expected: [[0, 60], [2, 64]],
    },
    {
      name: 'easy keeps the long note of a chord whose top note is an ornament',
      level: 'easy',
      notes: [[0, 60, 1], [0, 72, 0.05]],
      expected: [[0, 60]],
    },
    {
      name: 'easy drops the weak beat of two neighbouring same-pitch notes (Ode to Joy bar 1-2)',
      level: 'easy',
      //      E  E  F  G  | G  F  E  D
      notes: [[0, 64, 1], [1, 64, 1], [2, 65, 1], [3, 67, 1], [4, 67, 1], [5, 65, 1], [6, 64, 1], [7, 62, 1]],
      expected: [[0, 64], [2, 65], [4, 67], [5, 65], [6, 64], [7, 62]],
    },
    {
      name: 'easy keeps same-pitch notes that are not neighbours',
      level: 'easy',
      notes: [[0, 60, 1], [2, 60, 1], [4, 60, 1]],
      expected: [[0, 60], [2, 60], [4, 60]],
    },
    {
      name: 'easy never asks for more than two notes a second: at 180 BPM only the strong beats stay',
      level: 'easy',
      bpm: 180,
      notes: [[0, 60], [1, 62], [2, 64], [3, 65], [4, 67], [5, 65], [6, 64], [7, 62]],
      expected: [[0, 60], [2, 64], [4, 67], [6, 64]],
    },
    {
      name: 'medium keeps one note per half-beat and the top of a chord',
      level: 'medium',
      notes: [[0, 60], [0, 67], [0.5, 62], [1, 64], [1.5, 65], [1.75, 66, 0.2], [2, 67]],
      expected: [[0, 67], [0.5, 62], [1, 64], [1.5, 65], [2, 67]],
    },
    {
      name: 'medium drops short off-grid notes (sixteenths) and keeps the grid',
      level: 'medium',
      notes: [[0, 60, 0.2], [0.25, 61, 0.2], [0.5, 62, 0.2], [0.75, 63, 0.2], [1, 64, 0.2]],
      expected: [[0, 60], [0.5, 62], [1, 64]],
    },
    {
      name: 'medium keeps a syncopation that lasts at least 1/4 beat',
      level: 'medium',
      notes: [[0, 60], [0.75, 62, 0.75], [2, 64], [2.75, 65, 0.2]],
      expected: [[0, 60], [0.75, 62], [2, 64]],
    },
    {
      name: 'medium prefers the on-grid note over a syncopation in the same half-beat',
      level: 'medium',
      notes: [[0.75, 62, 0.5], [1, 64]],
      expected: [[1, 64]],
    },
    {
      name: 'hard keeps the full part and cuts chords to their top three notes',
      level: 'hard',
      notes: [[0, 48], [0, 60], [0, 64], [0, 67], [0, 72], [0.25, 50, 0.1], [0.3, 52, 0.1]],
      expected: [[0, 64], [0, 67], [0, 72], [0.25, 50], [0.3, 52]],
    },
    {
      name: 'expert keeps everything',
      level: 'expert',
      notes: [[0, 48], [0, 60], [0, 64], [0, 67], [0, 72], [0.25, 50, 0.1]],
      expected: [[0, 48], [0, 60], [0, 64], [0, 67], [0, 72], [0.25, 50]],
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(kept(c.notes, c.level, c.bpm)).toEqual(c.expected);
    });
  }

  it('counts felt beats in compound time: 6/8 has two beats a bar', () => {
    // eighths 0..5 of a 6/8 bar are at quarter-beats 0, 0.5, 1, 1.5, 2, 2.5; felt beats at 0 and 1.5
    const notes: N[] = [[0, 60], [0.5, 62], [1, 64], [1.5, 65], [2, 67], [2.5, 69], [3, 71]];
    expect(kept(notes, 'easy', 90, [timeSig(0, 6, 8)])).toEqual([[0, 60], [1.5, 65], [3, 71]]);
  });

  it('follows a time-signature change', () => {
    const song = songOf([[0, 60]], 120, [timeSig(0, 3, 4), timeSig(3 * PPQ, 4, 4)]);
    const grid = new BeatGrid(song);
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((b) => grid.strength(b))).toEqual([3, 1, 1, 3, 1, 2, 1, 3]);
    expect(grid.beatOf(3 * PPQ + 240)).toBe(3.5);
    expect(grid.beatSeconds(0)).toBeCloseTo(0.5, 9);
  });

  it('levels are ordered and report density over the span of the full part', () => {
    const notes: N[] = [];
    for (let b = 0; b < 16; b += 0.25) notes.push([b, 60 + ((b * 4) % 5), 0.2], ...(b % 1 === 0 ? [[b, 48, 0.2] as N, [b, 52, 0.2] as N, [b, 55, 0.2] as N] : []));
    const song = songOf(notes);
    const stats = levelStats(splitNotes(song, { parts: PART }).player, song);
    expect(stats.map((s) => s.level)).toEqual(['easy', 'medium', 'hard', 'expert']);
    const counts = stats.map((s) => s.noteCount);
    expect(counts[0]!).toBeLessThan(counts[1]!);
    expect(counts[1]!).toBeLessThan(counts[2]!);
    expect(counts[2]!).toBeLessThan(counts[3]!);
    // one note per beat at 120 BPM: never closer than half a second
    const easy = simplify(splitNotes(song, { parts: PART }).player, 'easy', song);
    expect(Math.min(...easy.slice(1).map((n, i) => n.time - easy[i]!.time))).toBeCloseTo(0.5, 9);
    expect(stats[3]!.notesPerSec).toBeCloseTo(counts[3]! / (15.75 * 0.5 + 0.1), 6);
  });
});

describe('buildChart with a difficulty', () => {
  const notes: N[] = [[0.5, 59, 0.25], [1, 60], [1, 48], [1.5, 62], [1.75, 63, 0.2], [2, 64], [2.5, 65]];

  it('defaults to the full part', () => {
    const song = songOf(notes);
    expect(buildChart(song, { parts: PART }).notes).toHaveLength(7);
    expect(buildChart(song, { parts: PART }).notes.every((n) => n.carry === undefined)).toBe(true);
  });

  it('carries removed notes on the chart note before them; notes before the first go to the band', () => {
    const song = songOf(notes);
    const chart = buildChart(song, { parts: PART, difficulty: 'easy' });
    expect(chart.notes.map((n) => n.pitch)).toEqual([60, 64]);
    expect(chart.notes[0]!.carry!.map((c) => c.pitch)).toEqual([48, 62, 63]);
    expect(chart.notes[1]!.carry!.map((c) => c.pitch)).toEqual([65]);
    expect(chart.notes[0]!.carry![1]).toMatchObject({ time: 0.75, duration: 0.25, velocity: 80, partKey: '0:0' });
    expect(chart.backing.filter((e) => e.type === 'on').map((e) => e.pitch)).toEqual([59]);
  });

  it("'backing' hands every removed note to the band", () => {
    const song = songOf(notes);
    const chart = buildChart(song, { parts: PART, difficulty: 'easy', removed: 'backing' });
    expect(chart.notes.every((n) => n.carry === undefined)).toBe(true);
    expect(chart.backing.filter((e) => e.type === 'on').map((e) => e.pitch)).toEqual([59, 48, 62, 63, 65]);
  });

  it('simplifies by the written pitch, then folds', () => {
    const song = songOf([[0, 40], [0, 95], [1, 60]]);
    const chart = buildChart(song, { parts: PART, difficulty: 'easy', window: { low: 60, high: 84 } });
    expect(chart.notes.map((n) => [n.pitch, n.origPitch, n.folded])).toEqual([[83, 95, true], [60, 60, false]]);
  });
});

describe('carried notes in a session', () => {
  function harness(notes: N[]) {
    const t = { perfMs: 10_000 };
    const clock = new GameClock(() => t.perfMs);
    const synth = new RecordingSynth();
    const chart = buildChart(songOf(notes), { parts: PART, difficulty: 'easy' });
    const session = new PlaySession({
      chart, clock, judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth, relative: false,
      visibleSeconds: 1, barSeconds: 1, autoplay: null, hint: '', feedbackSound: 'chart',
    });
    const goTo = (songTime: number) => {
      t.perfMs += (songTime - session.now()) * 1000;
      session.update();
    };
    const down = (pitch: number) => session.handleInput({ type: 'on', pitch, velocity: 90, channel: 0, perfMs: t.perfMs, source: 'midi' });
    const ons = () => synth.calls.filter((c) => c.method === 'noteOn').map((c) => c.args.slice(0, 2).concat(c.args[3]));
    return { session, synth, goTo, down, ons };
  }
  // beats at 120 BPM: beat 2 = 1 s. Easy keeps 60 (1 s) and 64 (2 s); 48 is a chord mate, 62 (1.25 s) and 63 (1.75 s) follow.
  const notes: N[] = [[2, 60], [2, 48], [2.5, 62, 0.4], [3.5, 63, 0.4], [4, 64]];

  it('a hit sounds its chord mates at once and the following notes at their own time', () => {
    const { goTo, down, ons } = harness(notes);
    goTo(1.01);
    down(60);
    expect(ons()).toEqual([[FEEDBACK_CHANNEL, 60, 0], [FEEDBACK_CHANNEL, 48, 0]]);
    goTo(1.15);
    expect(ons()).toHaveLength(2);
    goTo(1.21); // inside the scheduling lookahead
    expect(ons()[2]).toEqual([FEEDBACK_CHANNEL, 62, 1.25]);
    goTo(1.72);
    expect(ons()[3]).toEqual([FEEDBACK_CHANNEL, 63, 1.75]);
  });

  it('a miss earns nothing: the phrase stays silent', () => {
    const { session, goTo, ons } = harness(notes);
    goTo(1.9);
    expect(session.judge.counts.miss).toBe(1);
    expect(ons()).toHaveLength(0);
  });

  it('a wrong key takes the rest of the phrase out of the mix', () => {
    const { goTo, down, ons, synth } = harness(notes);
    goTo(1);
    down(60);
    goTo(1.2);
    down(61);
    goTo(1.9);
    expect(ons()).toHaveLength(2);
    expect(synth.calls.filter((c) => c.method === 'clunk')).toHaveLength(1);
  });

  it('every sounded note is released', () => {
    const { session, goTo, down, synth } = harness(notes);
    goTo(1);
    down(60);
    for (let t = 1.02; t < 2; t += 0.02) goTo(t);
    goTo(2);
    down(64);
    for (let t = 2.02; session.status === 'playing' && t < 10; t += 0.02) goTo(t);
    const ons = synth.calls.filter((c) => c.method === 'noteOn').map((c) => c.args[1]);
    const offs = synth.calls.filter((c) => c.method === 'noteOff').map((c) => c.args[1]);
    expect(ons).toEqual([60, 48, 62, 63, 64]);
    expect([...offs].sort()).toEqual([...ons].sort());
  });
});

describe('difficulty in storage', () => {
  it('is part of the best-score key, except for the full part', () => {
    const base = bestKey('s', PART, undefined, 'normal', 1, false);
    expect(bestKey('s', PART, undefined, 'normal', 1, false, 'expert')).toBe(base);
    expect(bestKey('s', PART, undefined, 'normal', 1, false, 'easy')).toBe(`${base}|easy`);
    expect(new Set(['easy', 'medium', 'hard', 'expert'].map((d) => bestKey('s', PART, 60, 'normal', 1, false, d))).size).toBe(4);
  });

  it('travels in a song pack and is ignored when invalid', async () => {
    const bytes = smf([[on(0, 60), off(PPQ, 60), end(PPQ)]]);
    const pack = await buildPack('p', {}, [{ title: 'a', bytes, defaultParts: PART, difficulty: 'medium' }, { title: 'b', bytes, defaultParts: PART }]);
    const v = parsePackJson(JSON.stringify(pack));
    expect(v.ok && v.songs.map((s) => s.song.difficulty)).toEqual(['medium', undefined]);
    const bad = parsePackJson(JSON.stringify({ ...pack, songs: [{ ...pack.songs[0], difficulty: 'impossible' }] }));
    expect(bad.ok && bad.songs[0]!.song.difficulty).toBeUndefined();
  });
});
