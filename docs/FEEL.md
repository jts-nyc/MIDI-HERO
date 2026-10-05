# Feel: timing and feedback

How MIDI Hero makes a press feel answered: which clock everything runs on, what the player sees
and hears at each moment, and the numbers to turn if it feels off. The code is in
`src/render/feel.ts` (constants and pure helpers), `src/render/hitFeel.ts` (drawing shared by
both highways), `src/render/fx.ts` (effect state), `src/audio/sfx.ts` (cues) and
`src/audio/clock.ts` (time).

## 1. Timing truth

Feel is mostly timing. Three clocks meet in a frame, and they are reconciled like this:

| Clock | Used for | How it is tied to the others |
|---|---|---|
| Audio output (`AudioContext.getOutputTimestamp`) | song time: what you hear | the master. `GameClock` maps it onto the performance timeline. |
| Performance timeline (`performance.now`, `event.timeStamp`) | input events, frames | MIDI and key events carry their own timestamps; `audibleSongTime(ev.perfMs)` turns each into the song time that was audible when the key went down, however late the handler runs. |
| Frame (`requestAnimationFrame` timestamp) | where the notes are drawn | the highway is drawn at the song time of the frame's own timestamp. |

**Smoothed clock mapping.** The browser reports the audio clock against the performance clock
once per audio callback. On some systems (Linux and ChromeOS audio servers with big buffers) each
report is a few ms off, and used raw that error shakes the highway and moves the judging window
from frame to frame. `GameClock` keeps a smoothed offset instead: each new report pulls it
`OFFSET_SMOOTHING` (0.1) of the way, and a report more than `OFFSET_SNAP` (15 ms) away is a real
jump (device change, resume) and is taken at once. The clocks drift by parts per million, far
less than the smoothing lags. In `test/clock.test.ts`, ±4 ms of report jitter gives a worst
frame-to-frame error of 7.9 ms unsmoothed and under 1 ms smoothed.

**Draw at the frame's timestamp.** Before this pass the highway was drawn at `performance.now()`
taken partway through the frame, so however long `update()` took showed up as note jitter. Now
`step()` draws at the `requestAnimationFrame` timestamp (stray timestamps more than 50 ms old
or in the future fall back to now; `frameStamp()` in `feel.ts`). Simple mode (`/simple/`) draws
the same way. `scripts/timing-probe.mjs` measures it in headless Chrome
(Minuet in G, perspective, 1024×600):

| | step error p95, 1× | 4× CPU throttle | 6× | drawn time vs a straight line, p95 at 4× |
|---|---|---|---|---|
| before | 0.49 ms | 1.01 ms | 1.30 ms | 0.80 ms |
| after | 0.012 ms | 0.012 ms | 0.013 ms | 0.043 ms |

"Step error" is how far each frame's advance of the drawn song time differs from the advance of
the frame clock; at 600 px/s, 1 ms is 0.6 px. Headless Chrome's own audio reports were steady
(0.04 ms SD), so the smoothing changed nothing there; it is for real audio drivers.

**Calibration.** Settings → "Measure these: calibrate timing…" (already in the game) measures
the input offset by tapping along to 8 clicks and the visual offset by tapping when 8 markers
land; the medians go into "Input offset" and "Visual offset". Bluetooth audio adds 100 ms or
more; the settings screen warns above 60 ms of output latency.

**First-play offer.** The first time a person presses Play in a browser that has no calibration
(both offsets 0), the game asks once: "Check your timing first?", with **Check timing** (the
same tap-along, then the song starts) and **Skip, just play**. Either answer is remembered in
`localStorage` (`midihero.calibrationOffered.v1`); without storage the offer is never made, so
nobody is asked on every play. It is not offered for the First Lights trial, whose protocol
fixes what comes before it, or for autoplay (`shouldOfferCalibration()` in
`game/calibration.ts`). Simple mode does not offer it: see [SIMPLE-TEST](SIMPLE-TEST.md).

**Swing is judged like any other note.** The judge has no idea of swing: it compares each
press with the note's written time, and Rhythm 3 (The Shuffle) writes its offbeats two-thirds
of the way through each beat. At 88 bpm a player who plays straight eighths instead lands every
offbeat 114 ms early (a sixth of a beat), inside the Good window on Normal (±120 ms) and on
Relaxed (±180 ms). Played that way at Medium the drill scores 45 Perfect and 44 Good, 70%
accuracy and 3 stars; played swung it can score 5. On Strict (Good ±84 ms, nothing beyond
±105 ms) the straight offbeats match nothing and count as wrong notes and misses. Below about
83 bpm the gap passes 120 ms and Normal would call straight eighths early too.

The windows stay as they are (decided in the integration PR): one set of windows for every song
keeps the judging predictable, and the drill already rewards swing with Perfect against Good. If
it should be stricter, the options, none built, are slowing the drill below 83 bpm, opening it
on Strict timing in the pack, or a per-note window for written swing. Measured in
`test/rhythm-basics.test.ts` ("swing judging").

## 2. What answers each moment

The session turns judge events into effect state (`fx.ts`); the renderers only draw it. Levels
refer to `game/feedback.ts`: Easy is calm, Medium adds words and milestones, Hard and Expert
get everything.

| Moment | Seen | Heard | Levels |
|---|---|---|---|
| Hit | particles fan up from the key; a ring; a **column of light** up the lane (strength by judgment); the key **flashes white**, then holds its judgment colour; the gem pops | the song's own note | all (Easy half the particles) |
| Perfect | the above plus shock bars along the hit line; **"Perfect"** snaps in at 1.6× and settles in 70 ms | | words: Medium up (Settings caps them) |
| Great / Good | smaller column and burst; the word if "Perfect, Great, Good" is chosen | | Hard up |
| Hold | trail lit, sparks from the key every 70 ms, a bar fills across the key | the note sustains | all |
| Miss | key flashes red, the note falls through grey, "Miss" | silence | word: Medium up |
| Wrong key | red key and small red ring | a clunk | all |
| Beat / bar | the **hit line swells** on every beat, more on a bar line | the band | all, not under reduced motion |
| Count-in | big number, and the hit line swells on each click | clicks | all |
| Multiplier level-up | badge pulses; the **charge light** above the hit line steps up a colour; edge glow and a flare along the hit line | a two-note rise | glow and flare Hard up; sound all |
| Milestone (10, 25, 50, 100s) | call-out, venue light flares, hit-line flare | a two-note chime | Medium up |
| Streak of 10+ broken | the multiplier **badge dips** once (no red, no noise); on Hard and Expert the number also shatters with a red edge glow | a soft falling sweep, Hard and Expert only | dip all |
| Star phrase clean | call-out | a three-note sparkle | all |
| Star power on | gold highway, gold notes, "STAR POWER!", gold flare, **gold rails** along the edges that pulse on the beat, brightest charge light | a rising sweep and a chord | all |
| Results | percentage counts up, stars pop in one by one | each star **chimes** as it lands (rising C-D-E-G-A) | |
| Four stars or a new best | **confetti** from under the stars | a short fanfare | |
| Menus | panels fade up in 190 ms; buttons press in | a quiet tick | |

A beginner who breaks a streak sees the multiplier go back to 1× with one small dip of the badge,
and nothing else: the north-star research asks for re-entry to feel immediate, not for the loss
to linger.

## 3. Tuning constants

All in `src/render/feel.ts` unless named otherwise. Times are seconds of real time (effects keep
their speed when the song is slowed), except the timing words, which follow song time as the
render contract always had them.

| Constant | Value | What it does |
|---|---|---|
| `FEEL.beamLife` | perfect 0.22, great 0.18, good 0.14 | how long the light column lasts |
| `FEEL.beamStrength` | 1 / 0.75 / 0.5 | its brightness (×1.15 in star power) |
| `FEEL.beamReach` | 0.45 | its height as a share of the highway |
| `FEEL.keyFlash` | 0.11 | the white flash on the struck key |
| `FEEL.popup` | life 0.5, popIn 0.07, overshoot 1.6, rise 24 px, fade from 55% | timing-word motion |
| `FEEL.popupSize` | Perfect 19 px, others 15 px | |
| `FEEL.beatPulse`, `beatWeight` | 0.14 s, 0.4 | hit-line swell: decay time, and a beat's share of a bar's |
| `FEEL.charge`, `chargeStar` | 0 / 0.10 / 0.16 / 0.24, star 0.32 | charge light alpha at 1×–4× |
| `FEEL.dropLife` | 0.5 | badge dip after a broken streak |
| `FEEL.surgeLife` | 0.45 | hit-line flare |
| `fx.ts BURST` | perfect 14 particles … good 5 | particle bursts (unchanged by this pass) |
| `session.ts SPARK_EVERY` | 0.07 | hold sparks (unchanged) |
| `clock.ts OFFSET_SMOOTHING`, `OFFSET_SNAP` | 0.1, 15 ms | clock mapping smoothing |
| `sfx.ts SFX_GAIN` | 0.3 | level of every cue against the synth's 0.8 master; each tone peaks at 0.25 or less and ends within 0.8 s |

To make hits louder visually, raise `beamStrength` before `beamLife`: a longer column smears
fast runs together. To calm the highway, lower `beatWeight` first.

## 4. Reduced motion and the frame-time fallback

**Reduced motion.** Settings → "Hit effects and motion" off, or the system's
`prefers-reduced-motion`, now means: no particles, rings, columns or flares, and the renderers
keep still (no swelling counters, no rising words, no sway, no beat pulse, no shatter drift).
Meters, key colours, red flashes and the words themselves stay. `?effects=1` overrides the
system setting, as before. Menus drop their fades and the results drop the confetti through the
CSS media query.

**Fallback.** `FrameGovernor` (feel.ts) watches the time between frames while a song plays:

| `GOVERNOR` | Value | |
|---|---|---|
| `window` | 90 frames | one verdict per window |
| `slowMs` | 20 ms | a slower frame is below ~50 fps |
| `degradeShare` | 25% | that share of slow frames steps effects down a level |
| `goodShare`, `recoverWindows`, `maxRecoveries` | 3%, 10, 1 | ten clean windows (~15 s) step back up, once per song |
| `ignoreMs` | 250 ms | longer gaps (pause, hidden tab) are not counted |
| `warmup` | 45 frames | the start of a song is not judged |

Level 1 halves the particles and caps the canvas at 1.5× device pixels; level 2 turns off the
particles, columns, flares, venue light, charge light, rails, fog and sway, and draws at 1×. The
first step down shows a toast once. The level carries over to the next song. `?governor=0` turns
the fallback off (the benchmark uses this, so it always measures full effects); `?lowfx=1`
starts at level 2. A display that only gives 30 fps will settle at level 2, which is the right
call for it.

## 5. Performance

`npm run bench` (update + draw work per frame, headless Chrome 154 on the owner's M1 Max,
1024×600, DPR 1, Sandstorm pad part 5:4 with 4,314 notes, Expert, effects on, fallback off).
Mean / p95 ms:

| Throttle | flat before | flat after | perspective before | perspective after |
|---|---|---|---|---|
| 1× | 0.096 / 0.2 | 0.106 / 0.2 | 0.096 / 0.2 | 0.092 / 0.2 |
| 4× | 0.376 / 0.9 | 0.340 / 1.0 | 0.394 / 0.9 | 0.341 / 1.0 |
| 6× | 0.637 / 1.5 | 0.541 / 1.6 | 0.647 / 1.5 | 0.581 / 1.6 |

Raw runs: `scripts/bench-results/feel-before.json`, `feel-after.json`. The budget is 2 ms p95
at 4×; both highways stay at half of it. The host was shared with other work while measuring,
and run-to-run spread was about ±0.1 ms mean at 6×: four alternating before/after runs of the
perspective highway at 6× gave 0.53–0.63 ms before and 0.54–0.75 ms after, so the feel layer
costs somewhere between nothing and a tenth of a millisecond a frame. Frame intervals in the
timing probe held at 16.7 ms median and 16.8 ms p95 at 1×, 4× and 6×, before and after. CPU throttling on a Mac is a proxy: it does not model a Chromebook's
GPU or fill rate, which is what the fallback's resolution step is for. A real Chromebook run is
still owed.

## 6. Checking it

- `node scripts/timing-probe.mjs --throttle 4` prints the step error, the line residual, frame
  intervals and the audio report jitter.
- `npm run bench` for work per frame.
- In a dev build, `window.midihero.governor.level` shows the fallback level.
- `?song=entertainer&autoplay=1&jitter=45&tiers=all&feedbackByLevel=0` shows every word and
  effect; add `&lowfx=1` for the lowest level.
