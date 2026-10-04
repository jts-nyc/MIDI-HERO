# MIDI Hero

A Guitar Hero–style rhythm game for MIDI keyboards, in the browser. Notes fall down a
piano-roll highway toward an on-screen keyboard; you play them on a real MIDI keyboard
and are scored on timing. Built for classroom use with small keyboards
(the M-Audio Oxygen 25) as well as full-size instruments.

- Import any Standard MIDI File, pick the part you want to play; the rest becomes the backing band.
- You hear your accuracy: a hit sounds the song's own note, a wrong key clunks, a miss is silent.
- Four difficulty levels that remove notes instead of loosening timing (Easy: one note a beat).
- Streak, multiplier, star power (sustain pedal or Space), a performance meter, scored holds.
- 25/49-key mode folds out-of-range notes into a two-octave window and lines up with your
  keyboard's octave buttons ("press your lowest C").
- Timing presets (Strict / Normal / Relaxed), an easy octave-agnostic mode, playback slowdown.
- Song packs: a teacher exports one `.midihero.json` with the songs, chosen parts and class
  settings; students import it in one step.
- Works without a MIDI keyboard too: the computer keyboard plays notes (`Z`–`M`, `Q`–`U`).

## Requirements

- **Browser:** Chrome, Edge or Firefox on a Chromebook, Mac or Windows PC. Web MIDI is not
  available in Safari or on iPad.
- **HTTPS** (or `localhost`) — Web MIDI needs a secure context.
- A USB MIDI keyboard. Firefox denies MIDI access if no device is connected when the page loads,
  so plug in first.

## Development

```bash
npm install
npm run gen-songs   # regenerate the bundled demo songs and the beginner pack
npm run dev         # http://localhost:5173
npm test
npm run build
```

Node 22.12 or newer. Vite 8, Vitest 4, TypeScript, `midi-file`; no other runtime dependencies.

### Your own songs (local only)

Drop `.mid` files into `local-songs/` and they appear in the song list under `npm run dev`.
The folder is gitignored and never built or deployed, so it is the place for songs you
don't have the rights to share. See [local-songs/README.md](local-songs/README.md).

### First Lights student trial

Choose **First Lights — Anchors** in the song list, or open `?song=first-lights` on your running
build. This separate four-bar trial uses eight authored C4/E4/G4 melody notes, actual played
pitches, steady accompaniment and the same phrase ending after mistakes. Choose computer sound
or the keyboard's own sound, check the received pitches, then start with a count-in. Results
offer a same-settings retry or a tempo/sound change. Ordinary song preferences remain separate.

The trial uses absolute pitches: adjust the keyboard's octave controls until C4, E4 and G4
appear in the setup check. Computer keys Q/E/T play those notes. It does not write best scores.
See the [implementation review and preflight checklist](docs/STUDENT-TRIAL-READINESS.md).
Real-device listening and student validation remain outstanding.

Useful URL parameters (session only, they do not change saved settings):
`?kb=25&timing=relaxed&names=1&synth=1` set class defaults for a bookmark;
`?pack=packs/beginner.midihero.json` loads a pack from this site;
`?song=ode-to-joy&autoplay=1&jitter=60` plays a bundled song automatically (for testing; a jitter
above 150 ms produces misses and wrong notes);
`?file=fixtures/some.mid` loads a MIDI file served from `public/fixtures/` (local only, gitignored);
`?difficulty=medium`, `?part=5:4` (track:channel), `?feedback=chart|press|off`, `?arcade=1`,
`?effects=1` (also overrides the system's reduced-motion preference) choose what to check;
`?feedbackByLevel=0` gives every level the full arcade feedback.

`PORT=5180 npm run dev` runs a second dev server next to one that already has 5173. In dev
builds `window.midihero.bench(seconds)` in the console reports the work per frame.

### Test fixtures

`test/golden.test.ts` runs extra checks when it finds `.mid` files in `./fixtures` or in
`MIDI_FIXTURES_DIR`. Those files are commercial arrangements and are **never committed**;
the tests only assert derived values (track counts, default part, timing).

## Deploying for a class (GitHub Pages)

The app is a static site. `npm run build` produces `dist/` with `base` set to `/MIDI-HERO/`
for a project page at `https://<user>.github.io/MIDI-HERO/`. The included workflow in
`.github/workflows/pages.yml` builds and deploys on every push to `main` once Pages is set to
"GitHub Actions" in the repository settings.

**Share the link, don't embed it.** MIDI does not work inside an iframe (Google Sites, Classroom
embeds); the app shows an "Open in new tab" button when embedded.

### IT checklist for managed Chromebooks

1. Allow the site to use MIDI: Chrome policy `MidiAllowedForUrls` = `https://<user>.github.io`
   (or leave the default and let students click "Allow" on the permission prompt).
2. Allow USB MIDI devices (no special driver is needed for class-compliant keyboards).
3. Wired headphones or speakers keep audio latency low; Bluetooth audio adds 100 ms or more.

### Songs and copyright

The repository bundles only public-domain demo songs and the owner's own exercises. Arrangements
of commercial songs stay on the teacher's machine and travel to students inside a song pack
shared through Google Classroom or Drive, never through this repository.

## How the game works

**Sound.** With the default setting a hit sounds the note as the file has it (pitch, velocity,
instrument) for its written length; notes that the difficulty level removed ride along and sound
when the note before them is hit. A wrong key gives an unpitched clunk and takes the rest of the
phrase out of the mix; a miss is silent. Settings → "Sound of my notes" also offers free play
(every key sounds) and none (the keyboard has its own speakers).

**Difficulty.** Easy keeps at most one note per beat, on the beat, the top note of a chord, and
never asks for more than two notes a second; Medium works on half-beats; Hard is the full part
with chords cut to three notes; Expert is the full part. Levels are relative to the song: Easy
is always its lowest rung, and a level above is offered only if it asks for more than the one
below. A five-finger exercise or a simple melody stops at Medium (the same or a few more notes,
and the keys have to be let go in time); sixteenths add Hard; chords of more than three notes,
as in a two-handed piano part, add Expert. The choice is stored per song, travels in song packs,
and has its own best score.

**Highway.** The perspective highway is a road: a note keeps one speed along it, so on screen it
crawls at the horizon and reaches the Speed setting at the keys, shrinking by the same amount the
lanes do. Beat and bar lines ride the same road, so the next bar line tells when the notes above
it land. The flat highway scrolls at the Speed setting everywhere.

**Feedback by level.** Easy shows the notes and the keys and little else: no words over hits or
misses, no streak counter behind the notes, no call-outs or edge flashes, half the particles. A
missed note still falls through grey and its key still flashes red. Medium adds Perfect and Miss
words and the streak milestones; Hard and Expert get everything. Settings → "Calmer highway on
Easy and Medium" turns this off, and "Timing words over hits" never shows more than the level allows.

**Streak and multiplier.** The multiplier rises at streaks of 10, 30 and 50 (2×, 3×, 4×). The
performance meter at the right gains with hits and drains with misses and wrong notes; below 30%
the highway dims and the band loses its drums and pads. Only in arcade mode (Settings) does an
empty meter end the song.

**Star power.** Every few phrases is a star phrase, drawn gold. Played clean it fills a quarter
of the star gauge; from half full, the sustain pedal or Space doubles the multiplier until the
gauge runs out (16 beats for half a gauge). Esc pauses.

**Holds.** Notes of a beat or more pay a point per 1/16 beat while the key (or the pedal) holds
them. From Medium up, a key that stays down after its note is over gets a sour bonk and a red
key, and it costs: 10 points and a little of the meter on Medium, 25 points on Hard, and on
Expert 50 points and the streak. Overlapping the next note by up to 150 ms (or a quarter beat)
is legato and costs nothing. Easy never minds.

**Calibration.** Settings → "calibrate timing" measures the input offset (tap along to 8 clicks)
and the visual offset (tap when a marker lands).

## How scoring works

Only note onsets are judged. Windows are ±35 ms (Perfect), ±70 ms (Great), ±120 ms (Good);
a hit up to 150 ms off counts as an early/late miss. Each window is clamped to half the gap to
the nearest same-pitch note. Windows are measured in real time, so slowing the song down does not
make timing looser; the Relaxed preset does (1.5×). A wrong note resets the combo but costs no
points by default.
