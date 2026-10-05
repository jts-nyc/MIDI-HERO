// Generates the bundled demo songs as Standard MIDI Files, the song manifest,
// the beginner song pack and the Rhythm Basics pack. Run with: npm run gen-songs
//
// Existing melodies are public domain (Beethoven, traditional, Petzold).
// First Lights is an original four-bar student-trial arrangement.
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
/** `layers` are extra lines written into the same track (chords, a drum kit). */
type Voice = { name: string; channel: number; program: number; velocity?: number; notes: N[]; layers?: { notes: N[]; velocity?: number }[] };
type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSig: [number, number];
  voices: Voice[]; // voices[0] is the intended player part
  trialOnly?: boolean;
  /** difficulty and flavour, shown under the title in song select */
  tag?: string;
  /** tempo changes as [bar, bpm]; bar 0 overrides bpm */
  tempos?: [number, number][];
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

// ---------------------------------------------------------------------------
// Backing band: turns one chord per bar into bass, chords and drums so a
// melody of a few dozen notes sounds like a whole song. The band never doubles
// the player's melody (north-star report §3: the player's job stays audible).
// ---------------------------------------------------------------------------
type Style = 'rock' | 'march' | 'waltz' | 'gallop';
const CHORD: Record<string, [number, number[]]> = {
  C: [C, [0, 4, 7]], Dm: [D, [0, 3, 7]], D: [D, [0, 4, 7]], Em: [E, [0, 3, 7]], E: [E, [0, 4, 7]],
  F: [F, [0, 4, 7]], G: [G, [0, 4, 7]], G7: [G, [0, 4, 10]], Am: [A, [0, 3, 7]], A: [A, [0, 4, 7]],
  B: [B, [0, 4, 7]], C7: [C, [0, 4, 10]], '-': [-1, []],
};
const KICK = 36, SNARE = 38, HAT = 42, CRASH = 49;

/** One drum line: hits at the given eighth-note slots of each bar, silence elsewhere. */
function drumLine(bars: number, eighthsPerBar: number, slots: (bar: number) => number[], pitch: number): N[] {
  const out: N[] = [];
  for (let b = 0; b < bars; b++) {
    const on = new Set(slots(b));
    for (let s = 0; s < eighthsPerBar; s++) out.push(on.has(s) ? [pitch, 0.25] : [0, 0.25], [0, 0.25]);
  }
  return out;
}

function band(chords: string[], beatsPerBar: number, style: Style): Voice[] {
  const bars = chords.length;
  const e = beatsPerBar * 2;
  const ch = (name: string) => CHORD[name] ?? CHORD.C!;
  // Bass: root and fifth, bouncing in quarters for rock/gallop, one note per beat pattern otherwise.
  const bass: N[] = chords.flatMap((name): N[] => {
    const [root] = ch(name);
    if (root < 0) return [[0, beatsPerBar]];
    const r = p(root, 2) + (root >= F ? 0 : 12), fifth = r + 7;
    if (style === 'waltz') return [[r, 1], [0, 2]].slice(0, 2) as N[];
    if (style === 'march') return [[r, 1], [0, 1], [fifth, 1], [0, 1]].slice(0, beatsPerBar) as N[];
    return Array.from({ length: beatsPerBar }, (_, i): N[] => [[i % 2 ? fifth : r, 0.5], [0, 0.5]]).flat();
  });
  // Chords: soft strings on the bar (a pad, so they thin out when the player struggles).
  const chordLine = (i: number): N[] => chords.map((name): N => {
    const [root, iv] = ch(name);
    return root < 0 ? [0, beatsPerBar] : [p(root, 3) + (root >= A ? -12 : 0) + iv[i]!, beatsPerBar];
  });
  // Drums: everyone gets a pulse; a crash marks every eighth bar.
  const pattern: Record<Style, { kick: number[]; snare: number[]; hat: number[] }> = {
    rock: { kick: [0, 4], snare: [2, 6], hat: [0, 1, 2, 3, 4, 5, 6, 7] },
    gallop: { kick: [0, 2, 4, 6], snare: [2, 6], hat: [1, 3, 5, 7] },
    march: { kick: [0, 4], snare: [2, 3, 6], hat: [0, 2, 4, 6] },
    waltz: { kick: [0], snare: [], hat: [2, 4] },
  };
  const pat = pattern[style];
  const live = (b: number) => chords[b] !== '-';
  return [
    { name: 'Bass', channel: 1, program: 33, velocity: 72, notes: bass },
    { name: 'Chords', channel: 2, program: 48, velocity: 38, notes: chordLine(0), layers: [{ notes: chordLine(1), velocity: 38 }, { notes: chordLine(2), velocity: 38 }] },
    { name: 'Beat', channel: 9, program: 0, velocity: 78, notes: drumLine(bars, e, (b) => (live(b) ? pat.kick : []), KICK), layers: [
      { velocity: 52, notes: drumLine(bars, e, (b) => (live(b) ? pat.snare : []), SNARE) },
      { velocity: 34, notes: drumLine(bars, e, (b) => (live(b) ? pat.hat : [0, 2, 4, 6].filter((x) => x < e)), HAT) },
      { velocity: 50, notes: drumLine(bars, e, (b) => (live(b) && b % 8 === 0 ? [0] : []), CRASH) },
    ] },
  ];
}
/** The band without its bass, for songs whose bundled left-hand part is already the bass. */
const bandNoBass = (chords: string[], beatsPerBar: number, style: Style) => band(chords, beatsPerBar, style).slice(1);

// ---------------------------------------------------------------------------
// In the Hall of the Mountain King (Grieg, Peer Gynt) — A minor, speeds up
// ---------------------------------------------------------------------------
const mkPhrase = (t: number): N[] => ([
  [A,3],[B,3],[C,4],[D,4],[E,4],[C,4],[E,4],
  [S(D),4],[B,3],[S(D),4],[D,4],[S(A),3],[D,4],
  [A,3],[B,3],[C,4],[D,4],[E,4],[C,4],[E,4],[A,4],
  [G,4],[E,4],[C,4],[E,4],[G,4],
] as [number, number][]).map(([n, o], i): N => {
  const lens = [.5,.5,.5,.5,.5,.5,1, .5,.5,1,.5,.5,1, .5,.5,.5,.5,.5,.5,.5,.5, .5,.5,.5,.5,2];
  return [p(n, o) + t, lens[i]!];
});
const mkMelody: N[] = [0, 0, 7, 0, 0, 0, 7, 0].flatMap(mkPhrase);
const mkChords = [0, 0, 7, 0, 0, 0, 7, 0].flatMap((t) => (t ? ['Em', 'B', 'Em', 'G'] : ['Am', 'E', 'Am', 'C']));
const mkTempos: [number, number][] = [[0, 96], [4, 104], [8, 112], [12, 122], [16, 134], [20, 148], [24, 164], [28, 184]];

// ---------------------------------------------------------------------------
// When the Saints Go Marching In (traditional) — C major, pickup bar
// ---------------------------------------------------------------------------
const cef = (): N[] => [[0,1],[p(C,4),1],[p(E,4),1],[p(F,4),1]];
const saintsMelody: N[] = [
  ...cef(), [p(G,4),4], ...cef(), [p(G,4),4], ...cef(),
  [p(G,4),2],[p(E,4),2], [p(C,4),2],[p(E,4),2], [p(D,4),4],
  [0,1],[p(E,4),1],[p(E,4),1],[p(D,4),1], [p(C,4),3],[p(C,4),1], [p(E,4),2],[p(G,4),2], [p(G,4),1],[p(F,4),3],
  [0,1],[p(E,4),1],[p(F,4),1],[p(G,4),1], [p(E,4),2],[p(C,4),2], [p(D,4),2],[p(D,4),2], [p(C,4),4],
];
const saintsChords = ['-', 'C','C','C','C','C', 'C','G', 'G','C','C7','F', 'F','C','G','C'];

// ---------------------------------------------------------------------------
// Jingle Bells (James Lord Pierpont, 1857) — chorus, C major
// ---------------------------------------------------------------------------
const jb1: N[] = [[p(E,4),1],[p(E,4),1],[p(E,4),2], [p(E,4),1],[p(E,4),1],[p(E,4),2], [p(E,4),1],[p(G,4),1],[p(C,4),1.5],[p(D,4),0.5], [p(E,4),4]];
const jbF: N[] = [[p(F,4),1],[p(F,4),1],[p(F,4),1.5],[p(F,4),0.5], [p(F,4),1],[p(E,4),1],[p(E,4),1],[p(E,4),0.5],[p(E,4),0.5]];
const jingleMelody: N[] = [
  ...jb1, ...jbF, [p(E,4),1],[p(D,4),1],[p(D,4),1],[p(E,4),1], [p(D,4),2],[p(G,4),2],
  ...jb1, ...jbF, [p(G,4),1],[p(G,4),1],[p(F,4),1],[p(D,4),1], [p(C,4),4],
];
const jingleChords = ['C','C','C','C','F','C','D','G', 'C','C','C','C','F','C','G7','C'];

// ---------------------------------------------------------------------------
// Für Elise (Beethoven, WoO 59) — the A section, A minor, 3/8
// ---------------------------------------------------------------------------
const q = 0.25; // a sixteenth, in quarter-note beats
const feTurn: N[] = [[p(E,5),q],[S(p(D,5)),q],[p(E,5),q],[S(p(D,5)),q],[p(E,5),q],[p(B,4),q],[p(D,5),q],[p(C,5),q]];
const feA: N[] = [
  ...feTurn, [p(A,4),.5],[0,q],[p(C,4),q],[p(E,4),q],[p(A,4),q], [p(B,4),.5],[0,q],[p(E,4),q],[S(p(G,4)),q],[p(B,4),q],
  [p(C,5),.5],[0,q],[p(E,4),q],
  ...feTurn, [p(A,4),.5],[0,q],[p(C,4),q],[p(E,4),q],[p(A,4),q], [p(B,4),.5],[0,q],[p(E,4),q],[p(C,5),q],[p(B,4),q],
  [p(A,4),1],
];
// A section = pickup (2 sixteenths of turn) + 8 bars; the first bar holds the pickup after a rest.
const eliseMelody: N[] = [[0,1], ...feA, ...feA, ...feA];
const feArp = (a: number, b: number, c: number): N[] => [[a,q],[b,q],[c,q],[0,.75]];
const feLHA: N[] = [
  [0,1.5], [0,1.5], ...feArp(p(A,2),p(E,3),p(A,3)), ...feArp(p(E,2),p(E,3),S(p(G,3))), ...feArp(p(A,2),p(E,3),p(A,3)),
  [0,1.5], ...feArp(p(A,2),p(E,3),p(A,3)), ...feArp(p(E,2),p(E,3),S(p(G,3))), ...feArp(p(A,2),p(E,3),p(A,3)),
];
// each A pass is 8 bars ending on a held A that makes room for the next pickup; the LH rests while the RH turns
const eliseLH: N[] = [[0,1.5], ...feLHA.slice(1), ...feLHA.slice(1), ...feLHA.slice(1)];

// ---------------------------------------------------------------------------
// The Entertainer (Scott Joplin, 1902) — the opening strain, C major, 2/4
// ---------------------------------------------------------------------------
const entPick: N[] = [[p(D,4),q],[S(p(D,4)),q]];
const entHead: N[] = [[p(E,4),q],[p(C,5),.5],[p(E,4),q],[p(C,5),.5],[p(E,4),q],[p(C,5),1.25]];
const entA: N[] = [...entPick, ...entHead, [p(C,5),q],[p(D,5),q],[S(p(D,5)),q],[p(E,5),q],
  [p(C,5),q],[p(D,5),q],[p(E,5),.5],[p(B,4),q],[p(D,5),.5],[p(C,5),1.25]];
const entB: N[] = [...entPick, ...entHead, [p(A,4),q],[p(G,4),q],[S(p(F,4)),q],[p(A,4),q],
  [p(C,5),q],[p(E,5),.5],[p(D,5),q],[p(C,5),q],[p(A,4),q],[p(D,5),1.5]];
const entertainerMelody: N[] = [[0,1.5], ...entA, [0,.5], ...entB, [0,.5], ...entA];
const entertainerChords = ['-', 'C','C','G7','C', 'C','D','G','G', 'C','C','G7','C'];

const songs: Song[] = [
  {
    // The backing owns bass, low harmony and pulse, never a hidden full lead.
    id: 'first-lights', title: 'First Lights — Anchors', bpm: 100, timeSig: [4, 4], trialOnly: true,
    voices: [
      { name: 'Anchors (right hand)', channel: 0, program: 0, velocity: 80,
        notes: [C,G,C,E,C,G,E,C].map((note): N => [p(note,4),2]) },
      { name: 'Bass', channel: 1, program: 32, velocity: 40,
        notes: [[p(C,2),4],[p(A,2),4],[p(F,2),4],[p(G,2),2],[p(C,2),2]] },
      { name: 'Harmony (lower)', channel: 2, program: 0, velocity: 40,
        notes: [[p(E,3),4],[p(E,3),4],[p(F,3),4],[p(D,3),2],[p(E,3),2]] },
      { name: 'Harmony (upper)', channel: 2, program: 0, velocity: 40,
        notes: [[p(G,3),4],[p(A,3),4],[p(A,3),4],[p(B,3),2],[p(G,3),2]] },
      { name: 'Quiet pulse', channel: 9, program: 0, velocity: 30,
        notes: Array.from({ length: 16 }, (): N[] => [[42,0.125],[0,0.875]]).flat() },
    ],
  },
  {
    id: 'ode-to-joy', title: 'Ode to Joy', bpm: 100, tag: 'Beginner · steady quarter notes', timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: odeMelody },
      { name: 'Bass (left hand)', channel: 1, program: 0, notes: odeBass },
      ...bandNoBass(odeBars, 4, 'rock'),
    ],
  },
  {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star', bpm: 90, tag: 'Beginner · the first song', timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: twinkleMelody },
      { name: 'Bass (left hand)', channel: 1, program: 0, notes: twinkleBass },
      ...bandNoBass(twinkleBassChords, 2, 'rock'),
    ],
  },
  {
    id: 'minuet-in-g', title: 'Minuet in G', bpm: 112, tag: 'Intermediate · 3/4 time, quick eighth notes', timeSig: [3, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 6, notes: minuetMelody },
      { name: 'Bass (left hand)', channel: 1, program: 6, notes: minuetBass },
      ...bandNoBass(['G','C','G','G', 'C','G','D','D', 'G','C','G','G', 'C','G','D','G'], 3, 'waltz')
        .filter((v) => v.channel === 9),
    ],
  },
  {
    id: 'saints', title: 'When the Saints Go Marching In', bpm: 116, tag: 'Beginner · marching band', timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 56, notes: saintsMelody },
      ...band(saintsChords, 4, 'march'),
    ],
  },
  {
    id: 'jingle-bells', title: 'Jingle Bells', bpm: 126, tag: 'Intermediate · brisk and bouncy', timeSig: [4, 4],
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: jingleMelody },
      ...band(jingleChords, 4, 'gallop'),
    ],
  },
  {
    id: 'mountain-king', title: 'Hall of the Mountain King (speeds up!)', bpm: 96, tag: 'Challenge · speeds up from 96 to 184 bpm', timeSig: [4, 4], tempos: mkTempos,
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: mkMelody },
      ...band(mkChords, 4, 'rock'),
    ],
  },
  {
    id: 'fur-elise', title: 'Für Elise', bpm: 66, timeSig: [3, 8], tag: 'Intermediate · the famous opening, fast sixteenths',
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: eliseMelody },
      { name: 'Left hand', channel: 1, program: 0, velocity: 60, notes: eliseLH },
    ],
  },
  {
    id: 'entertainer', title: 'The Entertainer', bpm: 72, timeSig: [2, 4], tag: 'Challenge · ragtime syncopation',
    voices: [
      { name: 'Melody (right hand)', channel: 0, program: 0, notes: entertainerMelody },
      ...band(entertainerChords, 2, 'march'),
    ],
  },
];
// Song select lists them easiest first.
const TIER = ['Beginner', 'Intermediate', 'Challenge'];
const tierOf = (x: Song) => (x.trialOnly ? -1 : TIER.findIndex((t) => x.tag?.startsWith(t)));
songs.sort((a, b) => tierOf(a) - tierOf(b) || a.bpm - b.bpm);

// ---------------------------------------------------------------------------
// Rhythm Basics — five drills, one rhythm each, from the five rounds of the
// owner's "Pocket Change" jazz-drummer game (Reset Lab playground). The player
// part uses two keys only: C4 for the game's kick, G4 for its snare, so the
// rhythm is the only thing to learn. Swing is written into the note times
// (offbeat at 2/3 of the beat): MIDI has no swing flag.
// ---------------------------------------------------------------------------
type Level = 'easy' | 'medium' | 'hard' | 'expert';
type RhythmSong = Song & {
  /** The level the Rhythm Basics pack opens the song at: Easy strips the rhythm it teaches. */
  packDifficulty?: Level;
};
const KICK_KEY = p(C, 4), SNARE_KEY = p(G, 4);
const RIDE = 51, PEDAL_HAT = 44, CLICK_HI = 76, CLICK_LO = 77;
const tk = (beat: number) => Math.round(beat * PPQ);

/** A line from [beat, pitch, beats] events that never overlap, padded with rests to `total` beats. */
function line(events: [number, number, number][], total: number): N[] {
  const out: N[] = [];
  let at = 0;
  for (const [beat, pitch, len] of [...events].sort((a, b) => a[0] - b[0])) {
    const t = tk(beat);
    if (t > at) out.push([0, (t - at) / PPQ]);
    out.push([pitch, tk(len) / PPQ]);
    at = t + tk(len);
  }
  if (tk(total) > at) out.push([0, (tk(total) - at) / PPQ]);
  return out;
}

/** One pattern bar repeated: [beat in bar, value] → absolute beats. */
const repeatBars = <T,>(pattern: [number, T][], beatsPerBar: number, bars: number, from = 0): [number, T][] =>
  Array.from({ length: bars }, (_, b) => pattern.map(([beat, v]): [number, T] => [(from + b) * beatsPerBar + beat, v])).flat();

/**
 * The player part from Pocket Change hits: one line per key, each note lasting until the next
 * hit of either key (so holding a key until the next one is never an over-hold), and a final
 * kick held through the last bar.
 */
function drill(pattern: [number, 'kick' | 'snare'][], beatsPerBar: number, bars: number): Voice {
  const hits = repeatBars(pattern, beatsPerBar, bars - 1);
  hits.push([(bars - 1) * beatsPerBar, 'kick']);
  const total = bars * beatsPerBar;
  const onsets = [...new Set(hits.map(([b]) => tk(b)))].sort((a, b) => a - b);
  const lineOf = (drum: 'kick' | 'snare', key: number) => line(hits.filter(([, d]) => d === drum).map(([b]): [number, number, number] => {
    const next = onsets.find((t) => t > tk(b)) ?? tk(total);
    return [b, key, (next - tk(b)) / PPQ];
  }), total);
  return { name: 'Rhythm (C = low drum, G = high drum)', channel: 0, program: 0, notes: lineOf('kick', KICK_KEY), layers: [{ notes: lineOf('snare', SNARE_KEY) }] };
}

/** A metronome: high click on the downbeat, low click on the other `clicks` (beats in the bar). */
function click(clicks: number[], beatsPerBar: number, bars: number, total = bars * beatsPerBar): Voice {
  const hi = line(Array.from({ length: bars }, (_, b): [number, number, number] => [b * beatsPerBar, CLICK_HI, 0.25]), total);
  const lo = line(repeatBars(clicks.filter((c) => c > 0).map((c): [number, number] => [c, 0]), beatsPerBar, bars - 1).map(([b]): [number, number, number] => [b, CLICK_LO, 0.25]), total);
  return { name: 'Click', channel: 9, program: 0, velocity: 70, notes: hi, layers: [{ notes: lo, velocity: 50 }] };
}

/** Bass on the given beats of each bar ([beat, pitch, beats]), the last bar one long root. */
function bassLine(perBar: (bar: number) => [number, number, number][], beatsPerBar: number, bars: number, program = 33): Voice {
  const evs = Array.from({ length: bars - 1 }, (_, b) => perBar(b).map(([beat, pitch, len]): [number, number, number] => [b * beatsPerBar + beat, pitch, len])).flat();
  evs.push([(bars - 1) * beatsPerBar, p(C, 2), beatsPerBar]);
  return { name: 'Bass', channel: 1, program, velocity: 70, notes: line(evs, bars * beatsPerBar) };
}

const POCKET: Record<string, [number, 'kick' | 'snare'][]> = {
  // The pocket: straight quarter notes, kick and snare trade the pulse.
  straight: [[0, 'kick'], [1, 'snare'], [2, 'kick'], [3, 'snare']],
  // The side-eye: some attacks land halfway between the beats.
  syncopated: [[0, 'kick'], [1, 'snare'], [1.5, 'kick'], [2.5, 'kick'], [3.5, 'snare']],
  // The shuffle: long–short swing, the offbeat two-thirds through each beat.
  swing: [[0, 'kick'], [2 / 3, 'snare'], [1, 'kick'], [1 + 2 / 3, 'snare'], [2, 'kick'], [2 + 2 / 3, 'snare'], [3, 'kick'], [3 + 2 / 3, 'snare']],
  // The missing stair: 7/8 grouped 2 + 2 + 3, a bar of 3.5 quarter-note beats.
  sevenEight: [[0, 'kick'], [1, 'snare'], [2, 'kick'], [2.5, 'snare'], [3, 'snare']],
  // The double-cross: three snares against two kicks every two beats, shared attacks on 1 and 3.
  threeTwo: [[0, 'kick'], [0, 'snare'], [2 / 3, 'snare'], [1, 'kick'], [4 / 3, 'snare'], [2, 'kick'], [2, 'snare'], [2 + 2 / 3, 'snare'], [3, 'kick'], [2 + 4 / 3, 'snare']],
};

const RHYTHM_BARS = 12;
// 12-bar blues for the swing drill; the last bar is the ending.
const bluesBars = ['C7', 'F7', 'C7', 'C7', 'F7', 'F7', 'C7', 'C7', 'G7', 'F7', 'C7', 'C'];
const WALK: Record<string, number[]> = { C7: [C, E, G, A], F7: [F, A, C + 12, D + 12], G7: [G, B, D + 12, F + 12] };
const swingRide: [number, number][] = [[0, 0], [1, 0], [1 + 2 / 3, 0], [2, 0], [3, 0], [3 + 2 / 3, 0]];
const straightBass = (): [number, number, number][] => [[0, p(C, 2), 0.5], [1, p(C, 2), 0.5], [2, p(G, 2), 0.5], [3, p(G, 2), 0.5]];

const rhythmSongs: RhythmSong[] = [
  {
    id: 'rhythm-1-straight', title: 'Rhythm 1: The Pocket (straight 4/4)', bpm: 84, timeSig: [4, 4],
    tag: 'Rhythm Basics 1 · straight quarter notes · Easy and up',
    voices: [drill(POCKET.straight!, 4, RHYTHM_BARS), click([0, 1, 2, 3], 4, RHYTHM_BARS), bassLine(straightBass, 4, RHYTHM_BARS)],
  },
  {
    id: 'rhythm-2-syncopation', title: 'Rhythm 2: The Side-Eye (syncopation)', bpm: 80, timeSig: [4, 4], packDifficulty: 'medium',
    tag: 'Rhythm Basics 2 · off-beat eighths · Medium and up',
    voices: [drill(POCKET.syncopated!, 4, RHYTHM_BARS), click([0, 1, 2, 3], 4, RHYTHM_BARS), bassLine(straightBass, 4, RHYTHM_BARS)],
  },
  {
    id: 'rhythm-3-swing', title: 'Rhythm 3: The Shuffle (swing)', bpm: 88, timeSig: [4, 4], packDifficulty: 'medium',
    tag: 'Rhythm Basics 3 · swing, long–short · Medium and up',
    voices: [
      drill(POCKET.swing!, 4, RHYTHM_BARS),
      { name: 'Ride and hi-hat', channel: 9, program: 0, velocity: 46,
        notes: line([...repeatBars(swingRide, 4, RHYTHM_BARS - 1).map(([b]): [number, number, number] => [b, RIDE, 0.25]), [(RHYTHM_BARS - 1) * 4, RIDE, 0.25]], RHYTHM_BARS * 4),
        layers: [{ velocity: 40, notes: line(repeatBars([[1, 0], [3, 0]], 4, RHYTHM_BARS - 1).map(([b]): [number, number, number] => [b, PEDAL_HAT, 0.25]), RHYTHM_BARS * 4) }] },
      bassLine((b) => WALK[bluesBars[b]!]!.map((n, i): [number, number, number] => [i, p(n, 2), 0.9]), 4, RHYTHM_BARS, 32),
    ],
  },
  {
    // 7/8: the quarter-note tempo is 72 (eighths at 144); clicks and bass mark the groups 2 + 2 + 3.
    id: 'rhythm-4-seven-eight', title: 'Rhythm 4: The Missing Stair (7/8)', bpm: 72, timeSig: [7, 8],
    tag: 'Rhythm Basics 4 · 7/8 grouped 2 + 2 + 3 · Easy and up',
    voices: [
      drill(POCKET.sevenEight!, 3.5, RHYTHM_BARS),
      click([0, 1, 2], 3.5, RHYTHM_BARS),
      bassLine(() => [[0, p(C, 2), 0.75], [1, p(C, 2), 0.75], [2, p(G, 2), 1.25]], 3.5, RHYTHM_BARS),
    ],
  },
  {
    id: 'rhythm-5-three-two', title: 'Rhythm 5: The Double-Cross (3 against 2)', bpm: 66, timeSig: [4, 4], packDifficulty: 'medium',
    tag: 'Rhythm Basics 5 · three against two, both hands · Medium and up',
    voices: [drill(POCKET.threeTwo!, 4, RHYTHM_BARS), click([0, 1, 2, 3], 4, RHYTHM_BARS), bassLine(straightBass, 4, RHYTHM_BARS)],
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
  let end = 0;
  for (const line of [{ notes: v.notes, velocity: v.velocity }, ...(v.layers ?? [])]) {
    let tick = 0;
    for (const [pitch, beats] of line.notes) {
      const len = Math.round(beats * PPQ);
      if (pitch > 0) {
        // noteOff (order 2) sorts before a noteOn (order 3) at the same tick
        evs.push({ tick, order: 3, ev: { deltaTime: 0, type: 'noteOn', channel: v.channel, noteNumber: pitch, velocity: line.velocity ?? 80 } });
        evs.push({ tick: tick + len, order: 2, ev: { deltaTime: 0, type: 'noteOff', channel: v.channel, noteNumber: pitch, velocity: 64 } });
      }
      tick += len;
    }
    end = Math.max(end, tick);
  }
  evs.push({ tick: end, order: 9, ev: { deltaTime: 0, meta: true, type: 'endOfTrack' } });
  return toDeltas(evs);
}

function conductorTrack(s: Song, lengthTicks: number): MidiEvent[] {
  return toDeltas([
    { tick: 0, order: 0, ev: { deltaTime: 0, meta: true, type: 'trackName', text: s.title } },
    { tick: 0, order: 1, ev: { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / s.bpm) } },
    { tick: 0, order: 2, ev: { deltaTime: 0, meta: true, type: 'timeSignature', numerator: s.timeSig[0], denominator: s.timeSig[1], metronome: 24, thirtyseconds: 8 } },
    ...(s.tempos ?? []).filter(([bar]) => bar > 0).map(([bar, bpm]): Abs => (
      { tick: bar * s.timeSig[0] * PPQ, order: 1, ev: { deltaTime: 0, meta: true, type: 'setTempo', microsecondsPerBeat: Math.round(60_000_000 / bpm) } })),
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
  id: string; title: string; file: string; tag?: string;
  defaultParts: { track: number; channel: number }[];
  split?: number;
  /** the level the song opens at in the song list until the player picks one (default Easy) */
  difficulty?: 'easy' | 'medium' | 'hard' | 'expert';
};
const manifest: ManifestEntry[] = [];
const packSongs: object[] = [];

for (const s of songs) {
  const bytes = songToBytes(s);
  const file = `${s.id}.mid`;
  writeFileSync(join(songsDir, file), bytes);
  const defaultParts = [{ track: 1, channel: s.voices[0]!.channel }];
  manifest.push({ id: s.id, title: s.title, file, defaultParts, ...(s.tag ? { tag: s.tag } : {}) });
  if (!s.trialOnly) packSongs.push({ id: sha256(bytes), title: s.title, midiBase64: Buffer.from(bytes).toString('base64'), defaultParts, timingPreset: 'normal' });
  console.log(`wrote ${file} (${bytes.length} bytes, ${s.voices[0]!.notes.length} melody notes)`);
}

// The owner's own five-finger exercise, bundled as-is.
{
  const bytes = new Uint8Array(readFileSync(join(songsDir, 'five-finger.mid')));
  const defaultParts = [{ track: 0, channel: 0 }];
  manifest.unshift({ id: 'five-finger', title: 'C Five-Finger Exercise (70 bpm)', file: 'five-finger.mid', defaultParts, tag: 'Warm-up · five notes, one hand' });
  packSongs.unshift({ id: sha256(bytes), title: 'C Five-Finger Exercise (70 bpm)', midiBase64: Buffer.from(bytes).toString('base64'), defaultParts, timingPreset: 'relaxed' });
}

// Rhythm Basics: listed after the other songs, in teaching order, and in a pack of their own.
const rhythmPackSongs: object[] = [];
for (const s of rhythmSongs) {
  const bytes = songToBytes(s);
  const file = `${s.id}.mid`;
  writeFileSync(join(songsDir, file), bytes);
  const defaultParts = [{ track: 1, channel: s.voices[0]!.channel }];
  manifest.push({ id: s.id, title: s.title, file, defaultParts, ...(s.tag ? { tag: s.tag } : {}), ...(s.packDifficulty ? { difficulty: s.packDifficulty } : {}) });
  rhythmPackSongs.push({
    id: sha256(bytes), title: s.title, midiBase64: Buffer.from(bytes).toString('base64'), defaultParts, timingPreset: 'normal',
    ...(s.packDifficulty ? { difficulty: s.packDifficulty } : {}),
  });
  console.log(`wrote ${file} (${bytes.length} bytes)`);
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

const rhythmPack = {
  format: 'midihero-pack',
  version: 1,
  name: 'Rhythm Basics',
  createdAt: '2026-10-05T00:00:00.000Z',
  settings: { kb: 25, timing: 'normal', names: true, synth: true },
  songs: rhythmPackSongs,
};
writeFileSync(join(packsDir, 'rhythm-basics.midihero.json'), JSON.stringify(rhythmPack, null, 2) + '\n');
console.log('wrote packs/rhythm-basics.midihero.json');
