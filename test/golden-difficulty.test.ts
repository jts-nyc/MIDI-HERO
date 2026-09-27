// Golden difficulty checks against local-only MIDI files (see golden.test.ts). Only derived values are asserted.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameClock } from '../src/audio/clock.ts';
import { DEFAULT_JUDGE_CONFIG } from '../src/game/judge.ts';
import { PlaySession } from '../src/game/session.ts';
import { buildChart, chooseWindow, DIFFICULTIES, levelStats, splitNotes } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts, defaultPart } from '../src/midi/parts.ts';

const dir = process.env.MIDI_FIXTURES_DIR ?? join(process.cwd(), 'fixtures');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.midi?$/i.test(f)) : [];
const bundled = join(process.cwd(), 'public', 'songs');
const all = [...files.map((f) => join(dir, f)), ...readdirSync(bundled).filter((f) => /\.mid$/.test(f)).map((f) => join(bundled, f))];

function load(path: string) {
  const song = parseSong(new Uint8Array(readFileSync(path)));
  const def = defaultPart(buildParts(song))!;
  return { song, def };
}

/** Highest number of notes in any 4-second stretch, per second. */
function peakDensity(times: number[]): number {
  let peak = 0;
  for (let i = 0, j = 0; i < times.length; i++) {
    while (j < times.length && times[j]! < times[i]! + 4) j++;
    peak = Math.max(peak, (j - i) / 4);
  }
  return peak;
}

describe('difficulty levels of every default part', () => {
  for (const path of all) {
    it(path.split('/').pop()!, () => {
      const { song, def } = load(path);
      const full = splitNotes(song, { parts: [def] }).player;
      const [easy, medium, hard, expert] = levelStats(full, song) as [ReturnType<typeof levelStats>[0], ReturnType<typeof levelStats>[0], ReturnType<typeof levelStats>[0], ReturnType<typeof levelStats>[0]];
      expect(expert.noteCount).toBe(full.length);
      expect(medium.noteCount).toBeLessThanOrEqual(hard.noteCount);
      expect(hard.noteCount).toBeLessThanOrEqual(expert.noteCount);
      // Strictly fewer notes on Easy, unless the part is already within Easy's limits
      // (a five-finger exercise in quarter notes has nothing to remove).
      if (easy.noteCount < expert.noteCount) expect(easy.noteCount).toBeLessThan(medium.noteCount);
      else expect(peakDensity(full.map((n) => n.time))).toBeLessThanOrEqual(2);
      expect(easy.noteCount).toBeGreaterThan(0);
      expect(easy.notesPerSec).toBeLessThanOrEqual(2);
      const chart = buildChart(song, { parts: [def], difficulty: 'easy' });
      expect(peakDensity(chart.notes.map((n) => n.time))).toBeLessThanOrEqual(2);
      // Nothing is lost: what the chart does not ask for is carried or played by the band.
      const carried = chart.notes.reduce((n, c) => n + (c.carry?.length ?? 0), 0);
      const inBand = buildChart(song, { parts: [] }).backing.filter((e) => e.type === 'on').length - chart.backing.filter((e) => e.type === 'on').length;
      expect(chart.notes.length + carried + chart.droppedCount).toBe(inBand);
    });
  }
});

describe.skipIf(files.length === 0)('golden: every level autoplays to 100% on 25 keys', () => {
  for (const file of files) {
    it(file, () => {
      const { song, def } = load(join(dir, file));
      for (const difficulty of DIFFICULTIES) {
        const unfolded = buildChart(song, { parts: [def], difficulty });
        const window = chooseWindow(unfolded.notes.map((n) => n.origPitch), 24);
        const chart = buildChart(song, { parts: [def], window, difficulty });
        const t = { perfMs: 0 };
        const session = new PlaySession({
          chart, clock: new GameClock(() => t.perfMs), judgeConfig: DEFAULT_JUDGE_CONFIG, rate: 1, inputOffsetMs: 0, synth: null, relative: true,
          visibleSeconds: 1, barSeconds: 1, autoplay: { jitterMs: 0 }, hint: '',
        });
        session.octaveOffset = 12;
        let guard = 0;
        while (session.status === 'playing' && guard++ < 200_000) {
          t.perfMs += 1000 / 60;
          session.update();
        }
        const r = session.result();
        expect(r.counts.miss + r.counts.wrong + r.counts.late, difficulty).toBe(0);
        expect(r.maxCombo, difficulty).toBe(chart.notes.length);
      }
    });
  }
});

describe.skipIf(!files.includes('Michael_Jackson_-_Beat_It.mid'))('golden: Beat It on Easy on 25 keys', () => {
  it('is playable: at most 2 notes/s and 15% folded', () => {
    const { song, def } = load(join(dir, 'Michael_Jackson_-_Beat_It.mid'));
    const unfolded = buildChart(song, { parts: [def], difficulty: 'easy' });
    const window = chooseWindow(unfolded.notes.map((n) => n.origPitch), 24);
    const chart = buildChart(song, { parts: [def], window, difficulty: 'easy' });
    expect(peakDensity(chart.notes.map((n) => n.time))).toBeLessThanOrEqual(2);
    expect(chart.foldedRatio).toBeLessThanOrEqual(0.15);
    expect(chart.notes.length).toBeGreaterThan(40);
  });
});
