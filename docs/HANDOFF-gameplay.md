# Handoff: make MIDI Hero feel like Guitar Hero

For the next build session (any agent: Claude, Codex, or a team). Read this file first, then
`docs/GAMEPLAY-ASSESSMENT.md`, then `README.md`. The plan that produced v0.1 is summarized in
the assessment's "Constraints" section.

## Status (2026-09-27)

Done on branch `claude/gameplay-handoff-execution-987c4b`, one commit per package: WP1 to WP7
and the calibration half of WP8. The perspective highway is on `codex/graphics-highway`
(not merged here); `docs/RENDER-CONTRACT.md` says what it has to draw and where the two branches
overlap. Checklist items 1 to 5 pass; item 6 (real hardware) is the owner's.

Where the work departs from the text below, and why:

- **WP1** sounds the feedback through the player synth, not the backing synth, on channels 16 and
  up. It is the same synth class, so timbres match, and the player's notes are then untouched by
  the backing volume, by the band's voice stealing, and by the mix thinning of WP3.
- **WP2** carries the notes a level removes on the chart note before them, and sounds them when
  that note is hit (in the other sound modes the band plays them). Without that, Easy would
  delete most of the melody from the song. The golden test asks for strictly fewer notes on Easy
  only where there is something to remove: the five-finger exercise is already one note a beat.
- **WP4** makes every 4th phrase a star phrase only from 16 phrases up; shorter songs get every
  3rd or 2nd, so that star power can be reached in Ode to Joy. Space now switches star power on,
  so it no longer pauses (Esc does); it still resumes a paused song.
- **WP7**: an early release cuts the trail and the hold points, not the sound (WP1 says the note
  sounds for its written length).
- **Checklist 3** names `jitter=140`, which cannot produce a miss: autoplay's jitter is uniform
  and anything within 150 ms still consumes the note. `jitter=220` shows misses, wrong notes,
  falling health and the thinned mix.
- **Added** at the owner's request: from Medium up, a key held after its note is over gets a
  bonk (see README, "Holds").

## Repo orientation (read these, in this order)

| File | What it is |
|---|---|
| `src/types.ts` | Shared data types: SongData, Part, etc. |
| `src/midi/parse.ts` | .mid → SongData (tempo/time-sig maps, notes in ticks+seconds, GS/XG drum channels). Pure. |
| `src/midi/parts.ts` | (track, channel) parts, classification, duplicates, default-part heuristic. Pure. |
| `src/midi/chart.ts` | Selected parts (+hand split) → Chart: player notes with folding into a pitch window, collision merge, and `backing` events for the band. Pure. **Difficulty simplification goes here.** |
| `src/game/judge.ts` | Scoring state machine: clamped windows, tiers, combo, wrong notes. Pure. **Streak/multiplier/star-power/health state goes here or beside it.** |
| `src/game/session.ts` | One play-through: input → judge → visuals, autoplay, player-note synth. **Hit/miss/wrong sound consequences hook in `handleInput` and `update`.** |
| `src/audio/clock.ts` | Single time reference on the audible audio timeline. Do not add a second clock. |
| `src/audio/synth.ts` | Web Audio polysynth with GM timbre families, drums, CC7/11, bend. `RecordingSynth` is the test seam. |
| `src/audio/scheduler.ts` | Lookahead scheduler for backing events (+ count-in). |
| `src/input/normalize.ts` | Raw MIDI → events, channel lock, doubled-note merge, octave tracker. Pure. |
| `src/render/renderer.ts` | Canvas 2D: highway, notes, keyboard, popups, HUD. `RenderState` is the contract with the session. **All VFX goes here.** |
| `src/render/layout.ts` | Key columns; display range snapped to C. |
| `src/ui/screens.ts` | DOM overlays (first run, song select, part picker, gate, pause, results, settings). |
| `src/main.ts` | Wiring: library (IndexedDB + bundled), import/export packs, gate, play/pause/results. |
| `src/midi/difficulty.ts`, `src/midi/phrases.ts` | Beat grid and `simplify()`; phrase splitting and star phrases. Pure. |
| `src/game/meter.ts`, `src/game/results.ts`, `src/game/calibration.ts` | Performance meter; sections and the next-step suggestion; tap calibration. Pure. |
| `src/render/fx.ts` | Effects state in fixed pools. Pure; see `docs/RENDER-CONTRACT.md`. |
| `test/*.test.ts` | 330 tests with the local fixtures (127 before this session). `test/golden.test.ts` runs extra checks when `MIDI_FIXTURES_DIR` points at local .mid files. |

Commands: `npm run dev` (http://localhost:5173), `npm test`, `npm run build`, `npm run gen-songs`.
Debug: the page mirrors session state into `document.getElementById('stage').dataset.state`
(status, score, counts, fps, frameMs). URL params: `?song=ode-to-joy&autoplay=1&jitter=60`,
`?file=fixtures/x.mid` (served from gitignored `public/fixtures/`), `?kb=25&timing=relaxed`.

## Goal

Turn the scorer into a feedback loop. Definition of done for this session: a student on a
25-key controller playing "Ode to Joy" on Easy can *hear* when they are right and wrong, sees
a streak grow and break, sees a multiplier meter fill, and gets a results screen that tells them
what to do next. Nothing in the existing test suite regresses.

## Work packages (independent; can run in parallel)

Each package lists the files it owns. Packages that touch the same file coordinate through the
interfaces named below; do not refactor shared files beyond what the package needs.

### WP1 — Audible consequences (owner: `session.ts`, `synth.ts`)
- On **hit**: sound the chart note through the backing synth on a dedicated channel, using the
  part's program (`Part.program`) and the note's original pitch and velocity; hold it for the
  note's duration or until key release, whichever is longer up to the duration.
- On **wrong note**: a short low-passed "clunk" (≈80 ms, noise burst + 90 Hz thud) at the played
  velocity. No pitched tone.
- On **miss**: nothing sounds. The backing continues.
- Setting `feedbackSound: 'chart' | 'press' | 'off'` (default `chart`; `press` is today's
  behaviour for keyboards with no speakers that want free play).
- Keep the synth call synchronous inside the input handler (there is a test for this).
- Tests: with `RecordingSynth`, a hit produces one `noteOn` on the feedback channel with the chart
  pitch; a wrong press produces the clunk call and no pitched `noteOn`; a miss produces nothing.

### WP2 — Difficulty by note reduction (owner: `chart.ts`, `parts.ts`, part picker in `screens.ts`)
- `simplify(notes, level)` → `'easy' | 'medium' | 'hard' | 'expert'`:
  - easy: keep at most one note per beat, on the beat (nearest to beat within 1/8 beat), highest
    pitch of any chord, drop notes shorter than 1/8 beat, and drop the weak-beat note when two
    consecutive notes are the same pitch.
  - medium: one note per half-beat, chords → top note, keep syncopations that are ≥ 1/4 beat.
  - hard: full part, chords ≤ 3 notes (keep top 3).
  - expert: full part (both hands allowed).
- Beat grid comes from `SongData.tempoMap` + `ppq` (ticks are already on every note).
- Picker shows difficulty as a segmented control with notes/s and note count per level; store the
  choice with the part choice; include it in the best-score key.
- Tests: table-driven on synthetic charts; golden: every local file's default part has strictly
  fewer notes at easy < medium ≤ hard ≤ expert and easy ≤ 2 notes/s.

### WP3 — Streak, multiplier meter, milestones, health (owner: `judge.ts` + new `game/meter.ts`)
- `Judge` already tracks combo and multiplier; expose `multiplierProgress` (0..1 to next level)
  and a `PerformanceMeter` (health 0..1: +0.03 per hit, −0.08 per miss, −0.04 per wrong; clamped).
- Milestones at streak 10/25/50/100 emit `JudgeEvent {type:'milestone'}`; streak break emits
  `{type:'break', streak}`.
- Optional fail: `failAt: number | null` (default null for class mode; 0 in arcade mode).
- Low health effect hook: session exposes `mixLevel` 0..1 that the backing synth uses to attenuate
  drums and pads (call `backingSynth.setChannelGroupGain`, add it).
- Tests: meter arithmetic, milestone/break events, fail threshold.

### WP4 — Star phrases via pedal (owner: `chart.ts` phrase detection, `judge.ts`, `session.ts`)
- Phrase = run of notes between rests ≥ 1 beat, or fixed 2-bar windows if the part has no rests.
  Every 4th phrase is a star phrase (`ChartNote.star = true`).
- Clean phrase (no miss/wrong inside) adds 25% to `starGauge`. Activation: sustain pedal down
  (CC64 ≥ 64) or Space while playing, when gauge ≥ 50%; drains over 16 beats; multiplier ×2.
- Tests: phrase splitting, gauge fill, activation math.

### WP5 — Hit VFX, miss consequences, HUD (owner: `renderer.ts`, `RenderState`)
- Particle burst + ring at the key on hit (count/size by judgment), gem pop, hit-line shockwave on
  Perfect. Missed notes pass through the line, grey, with a red key flash; wrong key flashes red.
- Big centred streak counter that scales on hit and shatters on break; milestone call-outs.
- Multiplier meter (radial) and badge; star gauge bar; star mode: highway gold, notes glow.
- Health meter (traffic-light) at the side; below 30% the highway dims.
- Countdown "4 3 2 1" during the lead-in synced to the count-in click.
- Keep every effect pooled and allocation-free per frame; frameMs must stay < 2 ms on the 4.3k-note
  Sandstorm pad part (`?file=fixtures/darude-sandstorm.mid&kb=25`, see debug mirror).
- Contract: extend `RenderState` with `fx: FxState` (particles, shockwaves, callouts, meters) that
  the session fills in `update()`; the renderer never reads the judge directly.

### WP6 — Results drama and next step (owner: `screens.ts`, `session.ts` result)
- Animated percentage count-up, staggered star reveal, longest streak, per-section accuracy bars
  (sections = 8-bar windows or MIDI markers), delta vs previous best, and one suggestion
  ("Try Medium" if ≥ 90% at Easy; "Try 90% speed" if < 70%).
- Tests: suggestion rules.

### WP7 — Sustains (owner: `judge.ts`, `session.ts`, `renderer.ts`)
- Score holds for notes ≥ 1 beat: hold bar fills while the key (or the pedal) is down through the
  tail; early release forfeits the tail bonus and cuts the drawn trail. 1 point per 1/16 beat held.
- Tests: hold accounting with and without pedal.

### WP8 — Calibration and perspective highway (owner: `screens.ts` calibration, `renderer.ts`)
- Guided input-offset calibration (8 clicks, median), visual-offset test.
- Pseudo-3D highway: trapezoid projection with per-row scale; beat-line pulse; keep the keyboard
  flat at the bottom. Behind a setting until it is proven readable on a 25-key window.

Suggested order if sequential: WP1 → WP2 → WP3 → WP5 → WP6 → WP4 → WP7 → WP8.

### Assignment by model (per the Fable 5.1 vs GPT-6 Astra comparison)

- **Claude Fable 5.1 — game mechanics, UI production stability, mergeability:** WP1–WP7 and the
  calibration half of WP8. Run as one session, or as a team: A = WP1+WP4 (audio/session),
  B = WP2 (chart math), C = WP3+WP6 (scoring state + results), D = WP5+WP7 (renderer VFX,
  sustains). Each commits per package; keep `npm test` green.
- **GPT-6 Astra (Codex) — 3D rendering, multi-agent orchestration:** the perspective highway,
  specified separately in `docs/HANDOFF-codex-highway.md` as its own module behind a stable
  interface so it cannot conflict with WP5. If the Fable work is run as a team, Astra is also the
  natural integrator: it owns the merge order, runs the golden tests with `MIDI_FIXTURES_DIR`
  set, and resolves conflicts in `renderer.ts` and `session.ts`.

### Renderer contract both sides must respect
- `src/render/renderer.ts` keeps `draw(state: RenderState)` as its only public entry point.
- WP5 adds `fx: FxState` to `RenderState` and a pure helper module `src/render/fx.ts`
  (particle pools, shockwaves, call-outs; no canvas calls, only state updates) so any highway
  renderer can draw the same effects.
- The 3D highway lives in `src/render/highway3d.ts` and implements the same `draw(RenderState)`;
  `main.ts` picks the renderer from `settings.highway: 'flat' | 'perspective'`. Nothing in the
  session or judge may know which renderer is active.

## Rules for this codebase

- Pure logic (parse/parts/chart/judge/normalize/layout/meter) must not touch the DOM or
  AudioContext; put it under test in `test/`. Browser-only code stays thin.
- One clock (`GameClock`). Input is judged at `audibleSongTime(event.timeStamp)`; sounds are
  scheduled through the clock's `songTimeToContextTime`.
- Windows stay in wall-clock ms and clamped to half the same-pitch gap; do not loosen scoring to
  make feedback feel better — change the feedback.
- 25-key first: every new visual must be legible with a two-octave display; every new mechanic
  must work with folded notes and relative judging (see `test/golden.test.ts` autoplay check).
- Never commit commercial MIDI. `fixtures/` and `public/fixtures/` are gitignored.
- Keep `npm test` green and `npm run build` clean before each commit. Commit per work package.

## Verification checklist for the session

1. `npm test` (and with `MIDI_FIXTURES_DIR` set) green; `npm run build` clean.
2. `?song=ode-to-joy&autoplay=1`: chart-note feedback audible on hits, streak counter and
   multiplier meter animate, results screen animates and suggests a next step.
3. `?song=ode-to-joy&autoplay=1&jitter=140`: misses are silent and pass through, wrong presses
   clunk, health drops and the mix thins, streak breaks visibly.
4. Part picker on a local file shows four difficulties with decreasing note counts; Easy on
   "Beat It" on 25 keys is playable (≤ 2 notes/s, ≤ 15% folded).
5. Sandstorm pad part: `frameMs` < 2 with all VFX on.
6. Real hardware (owner): Oxygen 25, pedal activates star power; Yamaha with speakers uses
   `feedbackSound: 'press'` or Local Control on.
