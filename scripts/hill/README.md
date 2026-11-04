# Hills

Scored checks to climb against. Each harness prints JSON to stdout and progress to stderr.
They drive the dev build in headless Chrome (`CHROME_PATH` overrides the installed Chrome;
`HEADED=1` shows the window) with a fake Web MIDI device (`fake-midi.js`). No student data
goes in or comes out: the device, the clicks and the notes are all synthetic.

None of this is part of `npm test`. A failing case is a finding to climb, not a red build.

## Setup survives clicking

```bash
npm run hill:setup                 # 50 runs, 20 s each, full game, clicks only
npm run hill:setup -- --keys 0.5   # half the actions are random keys on the MIDI keyboard
npm run hill:setup -- --page simple
npm run hill:setup -- --runs 1 --seed 7   # replay one run; add HEADED=1 to watch it
```

Each run is a first load with the classroom's ports attached (Midi Through, then three
Oxygen 25 entries, keys on the first). A seeded clicker clicks visible controls, sometimes
anywhere, and picks random options in selects. The score is the share of runs that reach a
**playable song** within the budget: a live session (not paused, not behind the gate, not
autoplay) that hears a key pressed on the fake keyboard.

## Classroom cases (17 Oct 2026)

```bash
npm run hill:cases
npm run hill:cases -- --only octave-recovery
```

One case per finding: `through-default`, `hot-plug`, `octave-recovery`, `skipped-setup`. What
each one checks is at the top of `classroom-cases.mjs`. The score is how many pass.

## Baselines

`results/` holds the runs recorded on `main`, with the browser version and platform in each.
The numbers are from one Mac; compare a climb against a baseline taken on the same machine.
