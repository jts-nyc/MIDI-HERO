# Handoff: practice mode, pack progress, venue (round 2)

Written 2026-09-27 after WP1–WP8 and the perspective highway landed on `main`. Read this file,
then `README.md`, `docs/RENDER-CONTRACT.md`, and the "Rules for this codebase" in
`docs/HANDOFF-gameplay.md` (they still hold).

## State of `main`

- Gameplay loop, difficulty levels, meters, star power, sustains, results, calibration: done.
- Perspective highway: done, behind `settings.highway` (default `flat`). Readability gate met
  (13.6 px top-row gem at C4–C6, 1024×600); 0.28 ms mean / 0.6 ms p95 per frame on the owner's
  Mac. Not yet measured on a Chromebook.
- `npm test`: 306 passed, 1 skipped without local fixtures. `npm run build` clean.
- CI: `.github/workflows/ci.yml` runs test and build on every PR. Keep it green.
- Pages deploys fail until Pages is set to "GitHub Actions" in the repo settings (owner).

## Who does what

| Owner | Packages | Files owned |
|---|---|---|
| **Fable 5.1** | WP9, WP10, WP11 | `session.ts`, `main.ts`, `screens.ts`, `settings.ts`, `pack.ts`, `db.ts`, `results.ts`, new `src/game/practice.ts` |
| **Codex** | WP13, WP14, integration | `renderer.ts`, `highway3d.ts`, their tests, bench tooling |
| **Opus 5.5** | WP12 (CI), this doc, review, the Easy options, classroom test script | docs, `.github/` |

The two coding owners share one seam, `src/render/practice.ts` (`PracticeView`, already on
`main` as the optional `RenderState.practice`). Fable fills it; Codex draws it. Neither changes
its shape without the other: if a field is missing, add it in its own commit with a note in the
PR. Nothing else overlaps. Each package is its own commit; open one PR per owner against `main`.

## WP9 — Practice mode (Fable)

The most valuable classroom feature left (assessment #9).

- **Sections.** Reuse `buildSections` (8-bar windows) or MIDI markers when the file has them.
  The part picker gets a "Practise" entry that lists sections with their notes/s; the results
  screen's `section` suggestion gets a button that opens practice on that section.
- **Loop.** Play one section (or a run of adjacent ones) on repeat, with a one-bar count-in
  before each pass. Optional "speed ladder": after two clean passes (no miss, no wrong), step up
  one entry of `RATES`; after two failed passes, step down. Show the rate.
- **Wait mode.** Off by default. When a pending note reaches the hit line unplayed, song time
  holds (backing silent, notes frozen) until every pitch of that onset is down, folded and
  octave-relative as in normal judging. No timing judgment in wait mode, only hit/wrong.
- **One clock.** Looping re-seeks the existing `GameClock` and scheduler; do not add a second
  clock. Holding time in wait mode is a clock pause, not a rate change.
- **Scores.** Practice runs never write bests or change stars. The results screen after a
  practice session shows passes, clean passes and the rate reached.
- **Render.** Fill `RenderState.practice` every frame; leave it `undefined` outside practice.
- **Tests:** a pure `src/game/practice.ts` for the loop/ladder state machine and the wait gate
  (which pitches are still owed), tested without the DOM.

## WP10 — Pack as setlist, unlocks (Fable)

- Song select shows a pack's songs in pack order with the stars earned per song (best across
  its levels) and the level they were earned on.
- `PackSettings.unlocks: boolean` (teacher's choice, default `false`). When on, a level above
  the lowest is offered once the level below has 4 stars on this machine. Old packs without the
  field validate as `false`. Round-trip test in `test/pack.test.ts`.

## WP11 — Hit/miss first, tiers second (Fable)

Assessment #15. The first-order signal is hit vs miss; tier words are secondary.

- Setting `tierText: 'all' | 'perfect' | 'off'`, default `'perfect'`: only "Perfect" floats up
  (smaller than today); Great and Good hit silently with their particles. Misses, wrong notes and
  "Let go" always show. Scoring is unchanged.

## WP13 — Practice and venue visuals (Codex)

Both renderers, same content; flat is the reference, perspective projects it.

- **Practice** (`state.practice`, skip when absent): current section's label and the pass count
  at the top left; loop start and end drawn as labelled lines across the highway (A/B) that scroll
  with the notes; the hit line changes colour while `waiting`, and the keys in `waitingFor` pulse
  on the keyboard. Nothing else changes when `practice` is absent.
- **Venue** (assessment #13, visual half), driven only by `fx.meters` and `fx.callouts` that
  already exist: stage light at the top of the highway that warms with health zone, flares on
  milestone call-outs and goes gold in star power. Honour `reduceMotion` (static colour, no flares).
- Develop against a synthetic `PracticeView` in tests and a temporary harness; do not touch
  `session.ts` or `main.ts` for this. Budget unchanged: no per-frame allocation, 2 ms.

## WP14 — Chromebook performance (Codex)

- Make the frame benchmark reproducible from the command line (a script that drives
  `window.midihero.bench` in headless Chrome with CPU throttling 4× and 6×, on the Sandstorm pad
  part or the densest bundled song). Dev dependencies only; no new runtime dependency.
- Report flat vs perspective mean/p95 at each throttle in the PR. If perspective misses 2 ms p95
  at 4×, optimise before WP13 lands. Flipping the default to `perspective` is the owner's call
  after a real Chromebook test.

## Integration (Codex)

After Fable's PR lands: rebase WP13 onto it, check the live practice view in both renderers,
run the suite with `MIDI_FIXTURES_DIR` set, and merge with merge commits (no squash: the other
branch may still be open).

## Open decision for the owner: the rules of Easy

Today Easy is one recipe for every song: at most one note a beat, on the beat, top note of a
chord, never more than two notes a second. Options:

1. **Keep it fixed.** Predictable across songs; a dense piece's Easy can feel sparse.
2. **Scale with the song.** Easy targets a share of the full part's density (say 25%, still
   capped at 2 notes/s), so half-beats appear in dense pieces. Easy stays the lowest rung.
3. **Fixed Easy plus "Easy+"** in between for dense songs only, offered by `offeredLevels` when
   it adds notes.

Nothing depends on Easy's exact recipe, so this can land any time after the owner picks.

## Verification (each PR)

1. CI green; with `MIDI_FIXTURES_DIR` set locally, green.
2. `?song=ode-to-joy&autoplay=1` unchanged outside practice.
3. Practice on a section of Minuet in G: loop, ladder, wait mode, both renderers.
4. A pack with `unlocks: true` locks and unlocks levels; an old pack still imports.
