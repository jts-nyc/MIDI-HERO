// Golden tests against local-only MIDI files (commercial arrangements, never committed).
// Set MIDI_FIXTURES_DIR or drop files into ./fixtures. Only derived values are asserted here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSong } from '../src/midi/parse.ts';
import { buildParts, defaultPart, songEnd } from '../src/midi/parts.ts';

const dir = process.env.MIDI_FIXTURES_DIR ?? join(process.cwd(), 'fixtures');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.midi?$/i.test(f)) : [];

/** Expected derived values for known files, keyed by file name. */
const expected: Record<string, { defaultPart: string; drumChannels?: number[]; endApprox?: number; tempos?: number }> = {
  'Dr_Dre_-_Still_Dre.mid': { defaultPart: '1:0', endApprox: 94 },
  'Halloween.mid': { defaultPart: '1:1', endApprox: 178 },
  'HotelCalifornia.mid': { defaultPart: '2:1', endApprox: 391 },
  'Michael Jackson - Billie Jean.mid': { defaultPart: '1:3', endApprox: 284 },
  'Michael_Jackson_-_Beat_It.mid': { defaultPart: '15:14', drumChannels: [10], endApprox: 256 },
  'Numb.mid': { defaultPart: '7:5', endApprox: 187 },
  'Queen - Bohemian Rhapsody (1).mid': { defaultPart: '3:0', endApprox: 330, tempos: 3 },
  'Undertale_-_Megalovania.mid': { defaultPart: '3:0', endApprox: 161 },
  'Video_Game_Themes_-_Zelda__Ocarina_Of_Time.mid': { defaultPart: '0:0', endApprox: 83 },
  'Wii Channels - Mii Channel.mid': { defaultPart: '1:0', endApprox: 102, tempos: 21 },
  'c-five-finger-70bpm.mid': { defaultPart: '0:0', endApprox: 12 },
  'darude-sandstorm.mid': { defaultPart: '4:3', endApprox: 333 },
  'toto-africa.mid': { defaultPart: '4:3', endApprox: 247 },
};

describe.skipIf(files.length === 0)('golden: local MIDI fixtures', () => {
  for (const file of files) {
    it(`parses ${file}`, () => {
      const song = parseSong(new Uint8Array(readFileSync(join(dir, file))));
      const parts = buildParts(song);
      const def = defaultPart(parts);
      expect(parts.length).toBeGreaterThan(0);
      expect(def).toBeDefined();
      // Sentinel end-of-track markers must never inflate the song length.
      expect(songEnd(parts)).toBeLessThan(song.lastNoteOffTime + 3);
      for (const p of parts) expect(p.kind !== 'drums' || p.name.includes('Drums')).toBe(true);
      const exp = expected[file];
      if (exp) {
        expect(def!.key).toBe(exp.defaultPart);
        if (exp.drumChannels) expect(song.drumChannels).toEqual(exp.drumChannels);
        if (exp.endApprox) expect(Math.abs(songEnd(parts) - exp.endApprox)).toBeLessThan(2);
        if (exp.tempos) expect(song.tempoMap.length).toBe(exp.tempos);
      }
    });
  }
});
