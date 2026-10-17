// The Rhythm Bosses pack: one sixteen-bar boss per Rhythm Basics round, on the same two keys,
// and what each difficulty level leaves of the rhythm each boss is there to test.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { offeredLevels, simplify, splitNotes, type Difficulty } from '../src/midi/chart.ts';
import { parsePackJson } from '../src/midi/pack.ts';
import { parseSong } from '../src/midi/parse.ts';

const songsDir = join(process.cwd(), 'public/songs');
const ORDER = ['boss-1-straight', 'boss-2-syncopation', 'boss-3-swing', 'boss-4-seven-eight', 'boss-5-three-two'];
/** The level the pack opens each boss at: the lowest that keeps every rhythm the boss tests. */
const OPENS_AT: Record<string, Difficulty> = {
  'boss-1-straight': 'medium', 'boss-2-syncopation': 'medium', 'boss-3-swing': 'hard', 'boss-4-seven-eight': 'medium', 'boss-5-three-two': 'hard',
};
const C4 = 60, G4 = 67;

function load(id: string) {
  const bytes = new Uint8Array(readFileSync(join(songsDir, `${id}.mid`)));
  const song = parseSong(bytes);
  const { player, backing } = splitNotes(song, { parts: [{ track: 1, channel: 0 }] });
  const sig = song.timeSigs[0]!;
  const bar = (song.ppq * 4 * sig.numerator) / sig.denominator;
  return { bytes, song, player, backing, bar, ppq: song.ppq };
}
/** Bar b's notes (0-based) as "beat + key", beats in quarter notes from the bar line. */
function barOf(notes: readonly { tick: number; pitch: number }[], b: number, bar: number, ppq: number): string[] {
  return notes.filter((n) => n.tick >= b * bar && n.tick < (b + 1) * bar).map((n) => `${+((n.tick - b * bar) / ppq).toFixed(2)}${n.pitch === C4 ? 'C' : 'G'}`);
}
const tempo = (id: string) => Math.round(60e6 / load(id).song.tempoMap[0]!.usPerBeat);

describe('Rhythm Bosses songs', () => {
  it('follow Rhythm Basics in the song list, in round order, opening at their level', () => {
    const manifest = JSON.parse(readFileSync(join(songsDir, 'manifest.json'), 'utf8')) as { id: string; tag?: string; difficulty?: string; defaultParts: unknown }[];
    expect(manifest.slice(-5).map((m) => m.id)).toEqual(ORDER);
    expect(manifest.at(-6)!.id).toBe('rhythm-5-three-two');
    for (const m of manifest.slice(-5)) {
      expect(m.defaultParts).toEqual([{ track: 1, channel: 0 }]);
      expect(m.difficulty).toBe(OPENS_AT[m.id]);
      expect(m.tag).toContain(`${OPENS_AT[m.id] === 'hard' ? 'Hard' : 'Medium'} and up`);
    }
  });

  it('are sixteen bars on C4 and G4, a little faster than their drills, ending on a held C', () => {
    const drills = ['rhythm-1-straight', 'rhythm-2-syncopation', 'rhythm-3-swing', 'rhythm-4-seven-eight', 'rhythm-5-three-two'];
    expect(ORDER.map(tempo)).toEqual([92, 88, 96, 76, 72]);
    ORDER.forEach((id, i) => {
      const { song, player, bar, backing } = load(id);
      expect(new Set(player.map((n) => n.pitch))).toEqual(new Set([C4, G4]));
      expect(Math.max(...song.trackEndTicks)).toBe(16 * bar);
      expect(player.at(-1)!.tick).toBe(15 * bar);
      expect(tempo(id)).toBeGreaterThan(Math.round(60e6 / load(drills[i]!).song.tempoMap[0]!.usPerBeat));
      expect(backing.some((n) => n.pitch === C4 || n.pitch === G4)).toBe(false); // the band never plays the player's keys
    });
  });

  it('play the round\'s own rhythm, two twists, then a boss phrase that switches every bar', () => {
    const s = load('boss-1-straight');
    expect([0, 4, 8, 12, 13].map((b) => barOf(s.player, b, s.bar, s.ppq))).toEqual([
      ['0C', '1G', '2C', '3G'], ['0C', '1G', '2C'], ['0C', '1G', '1.5G', '2C', '3G', '3.5G'],
      ['0C', '0.5C', '1G', '2C', '2.5C', '3G', '3.5G'], ['0C', '2C', '3G'],
    ]);
    const y = load('boss-2-syncopation');
    expect(barOf(y.player, 4, y.bar, y.ppq)).toEqual(['0C', '1.5C', '3G', '3.5G']); // 3 + 3 + 2
    expect(barOf(y.player, 13, y.bar, y.ppq)).toEqual(['0.5G', '1.5C', '2.5G', '3.5C']); // nothing on the beat
    const w = load('boss-3-swing');
    expect(barOf(w.player, 8, w.bar, w.ppq)).toEqual(['0C', '1G', '2C', '2.33G', '2.67G', '3C']); // a triplet on 3
    // 7/8 groups (eighths): 2 + 2 + 3, 3 + 2 + 2, 2 + 3 + 2; a kick starts every group, the bass marks it
    const v = load('boss-4-seven-eight');
    const eighths = (b: number) => v.player.filter((n) => n.pitch === C4 && n.tick >= b * v.bar && n.tick < (b + 1) * v.bar).map((n) => (n.tick - b * v.bar) / (v.ppq / 2));
    expect([0, 4, 8, 12, 13].map(eighths)).toEqual([[0, 4], [0, 3, 5], [0, 2, 5], [0, 4], [0, 3, 5]]);
    const bass = (b: number) => v.backing.filter((n) => n.channel === 1 && n.tick >= b * v.bar && n.tick < (b + 1) * v.bar).map((n) => (n.tick - b * v.bar) / (v.ppq / 2));
    expect([0, 4, 8, 12, 13].map(bass)).toEqual([[0, 2, 4], [0, 3, 5], [0, 2, 5], [0, 2, 4], [0, 3, 5]]);
    // 3 against 2 with the hands swapped: G on the beats, C in triplets
    const x = load('boss-5-three-two');
    expect(barOf(x.player, 4, x.bar, x.ppq)).toEqual(['0C', '0G', '0.67C', '1G', '1.33C', '2C', '2G', '2.67C', '3G', '3.33C']);
    expect(barOf(x.player, 8, x.bar, x.ppq)).toEqual(['0C', '0G', '1.33C', '2G', '2.67C']); // quarter-note triplets
  });
});

describe('what each difficulty level does to the bosses', () => {
  const levels = (id: string) => { const { song, player } = load(id); return offeredLevels(player, song).map((l) => [l.level, l.noteCount]); };

  it('offers Easy and Medium on bosses 1, 2 and 4, and adds Hard on 3 and 5', () => {
    expect(ORDER.map(levels)).toEqual([
      [['easy', 56], ['medium', 70]],
      [['easy', 29], ['medium', 67]],
      [['easy', 34], ['medium', 93], ['hard', 98]],
      [['easy', 46], ['medium', 80]],
      [['easy', 42], ['medium', 105], ['hard', 131]],
    ]);
  });

  it('the opening level is the full part, except Hard on 3 and 5, which is everything', () => {
    for (const id of ORDER) {
      const { song, player } = load(id);
      expect(simplify(player, OPENS_AT[id]!, song), id).toHaveLength(player.length);
    }
  });

  it('Boss 1 on Easy keeps the rests but loses every eighth note', () => {
    const { song, player, bar, ppq } = load('boss-1-straight');
    const easy = simplify(player, 'easy', song);
    expect(barOf(easy, 4, bar, ppq)).toEqual(['0C', '1G', '2C']);
    expect(barOf(easy, 8, bar, ppq)).toEqual(['0C', '1G', '2C', '3G']);
    expect(easy.every((n) => n.tick % ppq === 0)).toBe(true);
  });

  it('Boss 2 on Easy is the pulse only; its bar of off-beats is empty', () => {
    const { song, player, bar, ppq } = load('boss-2-syncopation');
    const easy = simplify(player, 'easy', song);
    expect(barOf(easy, 13, bar, ppq)).toEqual([]);
    expect(easy.every((n) => n.tick % ppq === 0)).toBe(true);
  });

  it('Boss 3 on Medium keeps the swing but not the whole triplet: only Hard has all three', () => {
    const { song, player, bar, ppq } = load('boss-3-swing');
    expect(barOf(simplify(player, 'medium', song), 8, bar, ppq)).toEqual(['0C', '1G', '2C', '2.33G', '3C']);
    expect(barOf(simplify(player, 'hard', song), 8, bar, ppq)).toEqual(['0C', '1G', '2C', '2.33G', '2.67G', '3C']);
  });

  it('Boss 4 on Easy moves the groups: the 3 + 2 + 2 and 2 + 3 + 2 bars lose their group starts', () => {
    const { song, player, bar, ppq } = load('boss-4-seven-eight');
    const easy = simplify(player, 'easy', song);
    const starts = (b: number) => easy.filter((n) => n.tick >= b * bar && n.tick < (b + 1) * bar).map((n) => (n.tick - b * bar) / (ppq / 2));
    expect(starts(4)).toEqual([0, 2, 5]); // written 0, 3, 5
    expect(starts(8)).toEqual([0, 2, 4]); // written 0, 2, 5
  });

  it('Boss 5 on Medium drops the C under the shared attacks, as the drill does', () => {
    const { song, player, bar, ppq } = load('boss-5-three-two');
    expect(barOf(simplify(player, 'medium', song), 4, bar, ppq)).toEqual(['0G', '0.67C', '1G', '1.33C', '2G', '2.67C', '3G', '3.33C']);
  });
});

describe('Rhythm Bosses pack', () => {
  it('holds the five bosses in round order with class settings and opening levels', () => {
    const v = parsePackJson(readFileSync('public/packs/rhythm-bosses.midihero.json', 'utf8'));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.pack.name).toBe('Rhythm Bosses');
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
