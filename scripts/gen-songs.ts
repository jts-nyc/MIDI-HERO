// Generates the bundled demo songs as Standard MIDI Files, the song manifest,
// and the beginner song pack. Run with: npm run gen-songs
//
// Every melody here is public domain (Beethoven, traditional, Petzold).
// five-finger.mid is the repo owner's own exercise and is included as-is.

import { writeMidi, type MidiData, type MidiEvent } from 'midi-file';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const songsDir = join(root, 'public', 'songs');
const packsDir = join(root, 'public', 'packs');
mkdirSync(songsDir, { recursive: true });
mkdirSync(packsDir, { recursive: true });

const PPQ = 480;

// [pitch, beats]; pitch 0 = rest
type N = [number, number];
type Voice = { name: string; channel: number; program: number; notes: N[] };
type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSig: [number, number];
  voices: Voice[]; // voices[0] is the intended player part
};

// Pitch helpers: C4 = 60
const C = 0, D = 2, E = 4, F = 5, G = 7, A = 9, B = 11;
const p = (name: number, octave: number) => 12 * (octave + 1) + name;
const S = (n: number) => n + 1; // sharp

// ---------------------------------------------------------------------------
// Ode to Joy (Beethoven, Symphony No. 9) — C major, 4/4
// ---------------------------------------------------------------------------
const odeA: N[] = [
  [p(E,4),1],[p(E,4),1],[p(F,4),1],[p(G,4),1],
  [p(G,4),1],[p(F,4),1],[p(E,4),1],[p(D,4),1],
  [p(C,4),1],[p(C,4),1],[p(D,4),1],[p(E,4),1],
];
const odeEnd1: N[] = [[p(E,4),1.5],[p(D,4),0.5],[p(D,4),2]];
const odeEnd2: N[] = [[p(D,4),1.5],[p(C,4),0.5],[p(C,4),2]];
const odeB: N[] = [
  [p(D,4),1],[p(D,4),1],[p(E,4),1],[p(C,4),1],
  [p(D,4),1],[p(E,4),0.5],[p(F,4),0.5],[p(E,4),1],[p(C,4),1],
  [p(D,4),1],[p(E,4),0.5],[p(F,4),0.5],[p(E,4),1],[p(D,4),1],
  [p(C,4),1],[p(D,4),1],[p(G,3),2],
];
const odeMelody: N[] = [...odeA, ...odeEnd1, ...odeA, ...odeEnd2, ...odeB, ...odeA, ...odeEnd2];
// One chord root per bar as half notes root/fifth (16 bars)
const odeBars = ['C','G','C','G', 'C','G','C','C', 'G','C','G','C', 'C','G','C','C'];
const rootOf = (ch: string) => ({ C: p(C,3), G: p(G,2), F: p(F,3) }[ch] ?? p(C,3));
const odeBass: N[] = odeBars.flatMap((ch) => [[rootOf(ch),2],[rootOf(ch)+7,2]] as N[]);

// ---------------------------------------------------------------------------
// Twinkle Twinkle Little Star (traditional) — C major, 4/4
// ---------------------------------------------------------------------------
const tw = (a: number, b: number, c: number, d: number, e: number, f: number, g: number): N[] =>
  [[a,1],[b,1],[c,1],[d,1],[e,1],[f,1],[g,2]];
const twinkleMelody: N[] = [
  ...tw(p(C,4),p(C,4),p(G,4),p(G,4),p(A,4),p(A,4),p(G,4)),
  ...tw(p(F,4),p(F,4),p(E,4),p(E,4),p(D,4),p(D,4),p(C,4)),
  ...tw(p(G,4),p(G,4),p(F,4),p(F,4),p(E,4),p(E,4),p(D,4)),
  ...tw(p(G,4),p(G,4),p(F,4),p(F,4),p(E,4),p(E,4),p(D,4)),
  ...tw(p(C,4),p(C,4),p(G,4),p(G,4),p(A,4),p(A,4),p(G,4)),
  ...tw(p(F,4),p(F,4),p(E,4),p(E,4),p(D,4),p(D,4),p(C,4)),
];
// half-bar bass: C C | F C | G C ... (12 half-bars per 2-bar phrase pair)
const twinkleBassChords = [
  'C','C','F','C', 'F','C','G','C',
  'C','G','C','G', 'C','G','C','G',
  'C','C','F','C', 'F','C','G','C',
];
const twinkleBass: N[] = twinkleBassChords.map((ch) => [rootOf(ch), 2] as N);

// ---------------------------------------------------------------------------
// Minuet in G (Christian Petzold, from the Anna Magdalena Bach Notebook) — 3/4
// ---------------------------------------------------------------------------
const minuetMelody: N[] = [
  [p(D,5),1],[p(G,4),0.5],[p(A,4),0.5],[p(B,4),0.5],[p(C,5),0.5],
  [p(D,5),1],[p(G,4),1],[p(G,4),1],
  [p(E,5),1],[p(C,5),0.5],[p(D,5),0.5],[p(E,5),0.5],[S(p(F,5)),0.5],
  [p(G,5),1],[p(G,4),1],[p(G,4),1],
  [p(C,5),1],[p(D,5),0.5],[p(C,5),0.5],[p(B,4),0.5],[p(A,4),0.5],
  [p(B,4),1],[p(C,5),0.5],[p(B,4),0.5],[p(A,4),0.5],[p(G,4),0.5],
  [S(p(F,4)),1],[p(G,4),0.5],[p(A,4),0.5],[p(B,4),0.5],[p(G,4),0.5],
  [p(A,4),3],
  [p(D,5),1],[p(G,4),0.5],[p(A,4),0.5],[p(B,4),0.5],[p(C,5),0.5],
  [p(D,5),1],[p(G,4),1],[p(G,4),1],
  [p(E,5),1],[p(C,5),0.5],[p(D,5),0.5],[p(E,5),0.5],[S(p(F,5)),0.5],
  [p(G,5),1],[p(G,4),1],[p(G,4),1],
  [p(C,5),1],[p(D,5),0.5],[p(C,5),0.5],[p(B,4),0.5],[p(A,4),0.5],
  [p(B,4),1],[p(C,5),0.5],[p(B,4),0.5],[p(A,4),0.5],[p(G,4),0.5],
  [p(A,4),1],[p(B,4),0.5],[p(A,4),0.5],[p(G,4),0.5],[S(p(F,4)),0.5],
  [p(G,4),3],
];
// Simplified left hand, one bar each (3 beats)
const minuetBass: N[] = [
  [p(G,3),2],[p(A,3),1],   [p(B,3),1],[p(G,3),1],[p(D,3),1],
  [p(C,4),2],[p(B,3),1],   [p(A,3),1],[p(B,3),1],[p(C,4),1],
  [p(A,3),2],[S(p(F,3)),1],[p(G,3),2],[p(B,3),1],
  [p(D,3),1],[p(D,3),1],[p(C,4),1], [p(D,3),3],
  [p(G,3),2],[p(A,3),1],   [p(B,3),1],[p(G,3),1],[p(D,3),1],
  [p(C,4),2],[p(B,3),1],   [p(A,3),1],[p(B,3),1],[p(C,4),1],
  [p(A,3),2],[S(p(F,3)),1],[p(G,3),2],[p(B,3),1],
  [p(D,3),1],[p(D,3),1],[p(D,2),1], [p(G,2),3],
];

const songs: Song[] = [
  {
    id: 'ode-to-joy', title: 'Ode to Joy', bpm: 100, timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: odeMelody },
      { name: 'Bass (left hand)', channel: 1, program: 0, notes: odeBass },
    ],
  },
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', bpm: 90, timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: twinkleMelody },
      { name: 'Bass (left hand)', channel: 1, program: 0, notes: twinkleBass },
    ],
  },
  {
    id: 'minuet-in-g', title: 'Minuet in G', bpm: 112, timeSig: [3, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 6, notes: minuetMelody },
      { name: 'Bass (left hand)', channel: 1, program: 6, notes: minuetBass },
    ],
  },
];

// ---------------------------------------------------------------------------
// SMF writer
// ---------------------------------------------------------------------------
type Abs = { tick: number; order: number; ev: MidiEvent };

function toDeltas(events: Abs[]): MidiEvent[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  let last = 0;
  return events.map(({ tick, ev }) => {
    const out = { ...ev, deltaTime: tick - last } as MidiEvent;
    last = tick;
    return out;
  });
}

function voiceTrack(v: Voice): MidiEvent[] {
  const evs: Abs[] = [
    { tick: 0, order: 0, ev: { deltaTime: 0, meta: true, type: 'trackName', text: v.name } },
    { tick: 0, order: 1, ev: { deltaTime: 0, type: 'programChange', channel: v.channel, programNumber: v.program } },
  ];
  let tick = 0;
  for (const [pitch, beats] of v.notes) {
    const len = Math.round(beats * PPQ);
    if (pitch > 0) {
      // noteOff (order 2) sorts before a noteOn (order 3) at the same tick
      evs.push({ tick, order: 3, ev: { deltaTime: 0, type: 'noteOn', channel: v.channel, noteNumber: pitch, velocity: 80 } });
      evs.push({ tick: tick + len, order: 2, ev: { deltaTime: 0, type: 'noteOff', channel: v.channel, noteNumber: pitch, velocity: 64 } });
    }
    tick += len;
  }
  evs.push({ tick, order: 9, ev: { deltaTime: 0, meta: true, type: 'endOfTrack' } });
  return toDeltas(evs);
}

function conductorTrack(s: Song, lengthTicks: number): MidiEvent[] {
  return toDeltas([
    { tick: 0, order: 0, ev: { deltaTime: 0, meta: true, type: 'trackName', text: s.title } },
    { tick: 0, order: 1, ev: { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / s.bpm) } },
    { tick: 0, order: 2, ev: { deltaTime: 0, meta: true, type: 'timeSignature', numerator: s.timeSig[0], denominator: s.timeSig[1], metronome: 24, thirtyseconds: 8 } },
    { tick: lengthTicks, order: 9, ev: { deltaTime: 0, meta: true, type: 'endOfTrack' } },
  ]);
}

function songToBytes(s: Song): Uint8Array {
  const lengthTicks = Math.max(...s.voices.map((v) => v.notes.reduce((t, [, b]) => t + Math.round(b * PPQ), 0)));
  const data: MidiData = {
    header: { format: 1, numTracks: s.voices.length + 1, ticksPerBeat: PPQ },
    tracks: [conductorTrack(s, lengthTicks), ...s.voices.map(voiceTrack)],
  };
  return new Uint8Array(writeMidi(data));
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

type ManifestEntry = {
  id: string; title: string; file: string;
  defaultParts: { track: number; channel: number }[];
  split?: number;
};
const manifest: ManifestEntry[] = [];
const packSongs: object[] = [];

for (const s of songs) {
  const bytes = songToBytes(s);
  const file = `${s.id}.mid`;
  writeFileSync(join(songsDir, file), bytes);
  const defaultParts = [{ track: 1, channel: s.voices[0]!.channel }];
  manifest.push({ id: s.id, title: s.title, file, defaultParts });
  packSongs.push({ id: sha256(bytes), title: s.title, midiBase64: Buffer.from(bytes).toString('base64'), defaultParts, timingPreset: 'normal' });
  console.log(`wrote ${file} (${bytes.length} bytes, ${s.voices[0]!.notes.length} melody notes)`);
}

// The owner's own five-finger exercise, bundled as-is.
{
  const bytes = new Uint8Array(readFileSync(join(songsDir, 'five-finger.mid')));
  const defaultParts = [{ track: 0, channel: 0 }];
  manifest.unshift({ id: 'five-finger', title: 'C Five-Finger Exercise (70 bpm)', file: 'five-finger.mid', defaultParts });
  packSongs.unshift({ id: sha256(bytes), title: 'C Five-Finger Exercise (70 bpm)', midiBase64: Buffer.from(bytes).toString('base64'), defaultParts, timingPreset: 'relaxed' });
}

writeFileSync(join(songsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const pack = {
  format: 'midihero-pack',
  version: 1,
  name: 'Beginner',
  createdAt: '2026-09-26T00:00:00.000Z',
  settings: { kb: 25, timing: 'relaxed', names: true, synth: true },
  songs: packSongs,
};
writeFileSync(join(packsDir, 'beginner.midihero.json'), JSON.stringify(pack, null, 2) + '\n');
console.log(`wrote manifest.json (${manifest.length} songs) and packs/beginner.midihero.json`);
