// The Rhythm Basics pack: five two-key drills from the rounds of the "Pocket Change" jazz boss,
// and what each difficulty level leaves of the rhythm the song exists to teach.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offeredLevels, simplify, splitNotes, type Difficulty } from '../src/midi/chart.ts';
import { parsePackJson } from '../src/midi/pack.ts';
import { parseSong } from '../src/midi/parse.ts';

const songsDir = join(process.cwd(), 'public/songs');
const ORDER = ['rhythm-1-straight', 'rhythm-2-syncopation', 'rhythm-3-swing', 'rhythm-4-seven-eight', 'rhythm-5-three-two'];
/** The level the pack opens each song at; undefined = Easy, which keeps the rhythm. */
const OPENS_AT: Record<string, Difficulty | undefined> = { 'rhythm-2-syncopation': 'medium', 'rhythm-3-swing': 'medium', 'rhythm-5-three-two': 'medium' };
const C4 = 60, G4 = 67;

function load(id: string) {
  const bytes = new Uint8Array(readFileSync(join(songsDir, `${id}.mid`)));
  const song = parseSong(bytes);
  const { player, backing } = splitNotes(song, { parts: [{ track: 1, channel: 0 }] });
  const sig = song.timeSigs[0]!;
  const bar = (song.ppq * 4 * sig.numerator) / sig.denominator;
  return { bytes, song, player, backing, bar, ppq: song.ppq };
}
/** Position of a tick inside its beat, in beats (0 = on the beat). */
const inBeat = (tick: number, ppq: number) => (tick % ppq) / ppq;
const offBeat = (tick: number, ppq: number) => inBeat(tick, ppq) > 1e-6;

describe('Rhythm Basics songs', () => {
  it('are listed after the other bundled songs, in teaching order, with their level in the tag', () => {
    const manifest = JSON.parse(readFileSync(join(songsDir, 'manifest.json'), 'utf8')) as { id: string; tag?: string; defaultParts: unknown }[];
    expect(manifest.slice(-5).map((m) => m.id)).toEqual(ORDER);
    for (const m of manifest.slice(-5)) {
      expect(m.defaultParts).toEqual([{ track: 1, channel: 0 }]);
      expect(m.tag).toContain(OPENS_AT[m.id] ? 'Medium and up' : 'Easy and up');
    }
  });

  it('are twelve bars on two keys, C4 and G4, so the rhythm is the only thing to learn', () => {
    for (const id of ORDER) {
      const { song, player, bar } = load(id);
      expect(new Set(player.map((n) => n.pitch))).toEqual(new Set([C4, G4]));
      expect(Math.max(...song.trackEndTicks)).toBe(12 * bar);
      expect(player.at(-1)!.tick).toBe(11 * bar); // a held C ends the song on the downbeat
    }
  });

  it('have a bass on every beat (every group in 7/8) that keeps the pulse when the drums drop out', () => {
    for (const id of ORDER) {
      const { backing, bar, ppq } = load(id);
      const bass = new Set(backing.filter((n) => n.channel === 1).map((n) => n.tick));
      const pulse = id === 'rhythm-4-seven-eight' ? [0, 2, 4].map((e) => (e * ppq) / 2) : [0, 1, 2, 3].map((b) => b * ppq);
      for (let b = 0; b < 11; b++) for (const t of pulse) expect(bass.has(b * bar + t), `${id} bar ${b + 1}`).toBe(true);
      expect(backing.some((n) => n.pitch === C4 || n.pitch === G4)).toBe(false); // the band never plays the player's keys
    }
  });

  it('write each rhythm into the note times', () => {
    const straight = load('rhythm-1-straight');
    expect(straight.player.every((n) => !offBeat(n.tick, straight.ppq))).toBe(true);
    expect(straight.player.filter((n) => n.tick < straight.bar).map((n) => [n.tick / straight.ppq, n.pitch])).toEqual([[0, C4], [1, G4], [2, C4], [3, G4]]);

    const sync = load('rhythm-2-syncopation');
    expect(sync.player.filter((n) => n.tick < sync.bar).map((n) => [n.tick / sync.ppq, n.pitch])).toEqual([[0, C4], [1, G4], [1.5, C4], [2.5, C4], [3.5, G4]]);

    // Swing: every offbeat at 2/3 of the beat, long–short, none at a straight half-beat.
    const swing = load('rhythm-3-swing');
    const swingOff = swing.player.filter((n) => offBeat(n.tick, swing.ppq));
    expect(swingOff.length).toBe(44);
    expect(swingOff.every((n) => n.tick % swing.ppq === (swing.ppq * 2) / 3 && n.pitch === G4)).toBe(true);
    expect(swing.backing.filter((n) => n.pitch === 51 && offBeat(n.tick, swing.ppq)).every((n) => n.tick % swing.ppq === (swing.ppq * 2) / 3)).toBe(true);

    // 7/8: a bar of 3.5 quarter-note beats, hits on eighths 0, 2, 4, 5, 6 (2 + 2 + 3).
    const seven = load('rhythm-4-seven-eight');
    expect(seven.song.timeSigs[0]).toMatchObject({ numerator: 7, denominator: 8 });
    expect(seven.bar).toBe(3.5 * seven.ppq);
    const eighth = seven.ppq / 2;
    expect(seven.player.filter((n) => n.tick < seven.bar).map((n) => n.tick / eighth)).toEqual([0, 2, 4, 5, 6]);

    // 3 against 2: per two beats, C on both beats and G on three evenly spaced triplets.
    const xt = load('rhythm-5-three-two');
    const cell = xt.player.filter((n) => n.tick < 2 * xt.ppq).map((n) => [n.tick, n.pitch]);
    expect(cell).toEqual(expect.arrayContaining([[0, C4], [0, G4], [320, G4], [480, C4], [640, G4]]));
    expect(cell.length).toBe(5);
  });
});

describe('what each difficulty level leaves of the rhythm', () => {
  it('Straight and 7/8 keep their rhythm on Easy, so they open there', () => {
    const straight = load('rhythm-1-straight');
    expect(offeredLevels(straight.player, straight.song).map((l) => [l.level, l.noteCount])).toEqual([['easy', 45], ['medium', 45]]);

    // Easy keeps the start of every group (eighths 0, 2, 4): the 2 + 2 + 3 and the short bar survive.
    const seven = load('rhythm-4-seven-eight');
    const easy = simplify(seven.player, 'easy', seven.song);
    const eighth = seven.ppq / 2;
    for (let b = 0; b < 11; b++) {
      const inBar = easy.filter((n) => n.tick >= b * seven.bar && n.tick < (b + 1) * seven.bar).map((n) => (n.tick - b * seven.bar) / eighth);
      expect(inBar).toEqual([0, 2, 4]);
    }
  });

  it('syncopation, swing and 3 against 2 lose every off-beat note on Easy, so the pack opens them at Medium', () => {
    for (const id of ['rhythm-2-syncopation', 'rhythm-3-swing', 'rhythm-5-three-two']) {
      const { song, player, ppq } = load(id);
      const easy = simplify(player, 'easy', song);
      expect(easy.some((n) => offBeat(n.tick, ppq)), id).toBe(false);
      const opened = simplify(player, OPENS_AT[id]!, song);
      expect(opened.filter((n) => offBeat(n.tick, ppq)), id).toEqual(player.filter((n) => offBeat(n.tick, ppq)));
    }
  });

  it('3 against 2 adds Hard: Medium drops the C under the shared attacks, Hard is both hands', () => {
    const { song, player } = load('rhythm-5-three-two');
    expect(offeredLevels(player, song).map((l) => [l.level, l.noteCount])).toEqual([['easy', 44], ['medium', 89], ['hard', 111]]);
    expect(simplify(player, 'hard', song)).toHaveLength(player.length);
  });
});

describe('Rhythm Basics pack', () => {
  it('holds the five bundled songs in teaching order with class settings and opening levels', () => {
    const v = parsePackJson(readFileSync('public/packs/rhythm-basics.midihero.json', 'utf8'));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pack.name).toBe('Rhythm Basics');
    expect(v.pack.settings).toEqual({ kb: 25, timing: 'normal', names: true, synth: true, unlocks: false });
    expect(v.songs).toHaveLength(5);
    v.songs.forEach(({ song, bytes }, i) => {
      expect(bytes).toEqual(load(ORDER[i]!).bytes);
      expect(song.defaultParts).toEqual([{ track: 1, channel: 0 }]);
      expect(song.difficulty).toBe(OPENS_AT[ORDER[i]!]);
      expect(song.timingPreset).toBe('normal');
    });
  });
});
