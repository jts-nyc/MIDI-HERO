import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildChart, splitNotes } from '../src/midi/chart.ts';
import { parseSong } from '../src/midi/parse.ts';

const songsDir = join(process.cwd(), 'public/songs');
const song = parseSong(new Uint8Array(readFileSync(join(songsDir, 'first-lights.mid'))));
const parts = [{ track: 1, channel: 0 }];
const anchors = [60, 67, 60, 64, 60, 67, 64, 60];
const beat = 0.6;

describe('First Lights authored anchor arrangement', () => {
  it('contains precisely the eight researched-design anchors across four bars', () => {
    const { player } = splitNotes(song, { parts });
    expect(song.tempoMap).toEqual([{ tick: 0, seconds: 0, usPerBeat: 600_000 }]);
    expect(song.timeSigs).toEqual([{ tick: 0, seconds: 0, numerator: 4, denominator: 4 }]);
    expect(player.map((n) => [n.pitch, n.tick, n.endTick, n.velocity])).toEqual(
      anchors.map((pitch, i) => [pitch, i * 2 * song.ppq, (i + 1) * 2 * song.ppq, 80]),
    );
    player.forEach((n, i) => {
      expect(n.time).toBeCloseTo(i * 2 * beat, 9);
      expect(n.duration).toBeCloseTo(2 * beat, 9);
    });
    expect(song.trackEndTicks).toEqual(Array(6).fill(16 * song.ppq));
    expect(song.lastNoteOffTime).toBeCloseTo(16 * beat, 9);
    expect(song.notes.every((n) => !n.unterminated)).toBe(true);
  });

  it('reserves the foreground for the player and keeps its backing quiet and below C4', () => {
    const { backing } = splitNotes(song, { parts });
    const pitched = backing.filter((n) => n.channel !== 9);
    expect(pitched.every((n) => n.pitch < 60 && n.velocity === 40)).toBe(true);
    expect(backing.some((n) => anchors.includes(n.pitch))).toBe(false);
    const changes = [0, 4, 8, 12, 14];
    const lengths = [4, 4, 4, 2, 2];
    const expectedByTrack = [
      [36, 45, 41, 43, 36], // C, Am, F, G -> C bass
      [52, 52, 53, 50, 52], // E3, E3, F3, D3, E3
      [55, 57, 57, 59, 55], // G3, A3, A3, B3, G3
    ];
    expectedByTrack.forEach((pitches, voice) => {
      expect(pitched.filter((n) => n.track === voice + 2).map((n) => [n.pitch, n.tick / song.ppq, (n.endTick - n.tick) / song.ppq]))
        .toEqual(pitches.map((pitch, i) => [pitch, changes[i], lengths[i]]));
    });
    const pulse = backing.filter((n) => n.channel === 9);
    expect(pulse.map((n) => [n.pitch, n.tick / song.ppq, (n.endTick - n.tick) / song.ppq, n.velocity]))
      .toEqual(Array.from({ length: 16 }, (_, i) => [42, i, 0.125, 30]));
  });

  it('keeps all anchors at Easy without carried notes or a background lead', () => {
    for (const removed of ['carry', 'backing'] as const) {
      const chart = buildChart(song, { parts, difficulty: 'easy', removed, window: { low: 48, high: 72 } });
      expect(chart.notes.map((n) => n.pitch)).toEqual(anchors);
      expect(chart.notes.every((n) => !n.folded && !n.carry?.length)).toBe(true);
      expect(chart.droppedCount).toBe(0);
      expect(chart.backing.filter((e) => e.type === 'on').every((e) => e.partKey !== '1:0' && !anchors.includes(e.pitch))).toBe(true);
    }
  });

  it('selects the authored anchor part in the catalog and stays out of the generic beginner pack', () => {
    const manifest = JSON.parse(readFileSync(join(songsDir, 'manifest.json'), 'utf8'));
    expect(manifest.find((entry: { id: string }) => entry.id === 'first-lights')).toMatchObject({ file: 'first-lights.mid', defaultParts: parts });
    const pack = JSON.parse(readFileSync(join(process.cwd(), 'public/packs/beginner.midihero.json'), 'utf8'));
    expect(pack.songs.some((entry: { title: string }) => entry.title.includes('First Lights'))).toBe(false);
  });
});
