# MIDI Hero

A Guitar Hero–style rhythm game for MIDI keyboards, in the browser. Notes fall down a
piano-roll highway toward an on-screen keyboard; you play them on a real MIDI keyboard
and are scored on timing. Built for classroom use with small keyboards
(the M-Audio Oxygen 25) as well as full-size instruments.

- Import any Standard MIDI File, pick the part you want to play; the rest becomes the backing band.
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

Useful URL parameters (session only, they do not change saved settings):
`?kb=25&timing=relaxed&names=1&synth=1` set class defaults for a bookmark;
`?pack=packs/beginner.midihero.json` loads a pack from this site;
`?song=ode-to-joy&autoplay=1&jitter=60` plays a bundled song automatically (for testing);
`?file=fixtures/some.mid` loads a MIDI file served from `public/fixtures/` (local only, gitignored).

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

## How scoring works

Only note onsets are judged. Windows are ±35 ms (Perfect), ±70 ms (Great), ±120 ms (Good);
a hit up to 150 ms off counts as an early/late miss. Each window is clamped to half the gap to
the nearest same-pitch note. Windows are measured in real time, so slowing the song down does not
make timing looser; the Relaxed preset does (1.5×). A wrong note resets the combo but costs no
points by default.
