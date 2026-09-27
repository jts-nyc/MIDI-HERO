# Gameplay assessment: MIDI Hero vs. Guitar Hero

Status: v0.1 (7 commits). Written 2026-09-27 as input to the next build session.

## The one-line diagnosis

Guitar Hero is not a scorer; it is a **feedback machine**. Every press has an immediate
audible and visual consequence, performance accumulates into visible state (multiplier,
star power, rock meter) that changes how the game looks and sounds, and the song itself is
the reward: your part is only in the mix while you are playing it right. MIDI Hero v0.1 has
none of that loop. A press either matches a chart note or not, a word floats up, and a number
changes in the corner. That is why it feels like Shared Piano with a score at the end.

## Element-by-element

Legend: **Have** = present; **Partial** = exists but not felt; **Missing** = absent.

| # | Guitar Hero element | What it does for the player | MIDI Hero v0.1 | Gap / proposal (piano version) |
|---|---|---|---|---|
| 1 | **Your part is in the mix, and drops out on a miss** | The core loop. The guitar stem is audible while you hit notes and mutes when you miss; a wrong strum plays a "clank". You *hear* your accuracy. | Missing. The player's part is removed from the backing entirely; your own keypress is synthesized regardless of correctness, so wrong notes sound just as good as right ones. | On a **hit**, sound the *chart note* (its original pitch, velocity and the part's instrument program) through the backing synth. On a **wrong note**, play a short dull clunk (low-passed noise or a detuned thud) instead of a clean tone. On a **miss**, silence (the note simply is not heard). Keep "synthesize my notes" only as an off-chart free-play sound in menus. |
| 2 | **Hit VFX at the strike line** | Gem explodes into flames/sparks; fret button lights; highway flashes. Confirms the hit before your brain reads a word. | Partial. Note fades out in 150 ms, key tints, "Perfect" text rises. Small, monochrome, no motion. | Burst particles + ring flash at the key on hit, scaled by judgment; note gem "pops" (scale up + fade); a horizontal shockwave along the hit line for Perfects; screen-edge glow when the multiplier rises. Missed notes should visibly *pass through* the line and go grey while a red flash marks the key. |
| 3 | **Streak counter with milestones** | "50 NOTE STREAK" call-outs; streak is the thing players protect. | Partial. Combo count shown as small text; no milestones, no animation on break. | Big centred streak counter that scales on each hit, milestone call-outs at 10/25/50/100, and a visible "streak broken" moment (counter shatters/falls, red flash). |
| 4 | **Multiplier meter (2x/3x/4x)** | A meter fills toward the next multiplier; the multiplier is a big HUD element that changes colour. | Partial. Multiplier exists in scoring (10/30/50) but is never shown. | Radial or vertical meter next to the score filling over the next 10 notes; multiplier badge with colour per level; short stinger sound on level-up. |
| 5 | **Star Power / Overdrive** | Special phrases; collecting them fills a gauge; activating doubles the multiplier and transforms the highway (blue glow), crowd roars. Gives agency and a strategic layer. | Missing. | Mark **phrases** (every N bars, or the melodic phrases detected from rests) as star phrases; drawn as glowing notes. Hitting a whole phrase clean fills the gauge by 25%. Activate with the **sustain pedal** (CC64) or a key outside the window / spacebar; while active: 2x, highway turns gold, backing gets a subtle filter-open / brightness lift. |
| 6 | **Rock meter (health) and failing** | Green/yellow/red gauge; misses drain it, hits refill; drop to red and the crowd boos, hit zero and the song ends ("You failed"). Stakes. | Missing. Nothing you do can change what happens next. | Add a performance meter. For the classroom keep failing **optional** (default off for students, "Arcade" mode on) but show the meter always; at low health, dim the highway and thin the backing mix (cut drums/pads) so the *song* gets worse. |
| 7 | **Sustained notes with whammy** | Long notes have trails; holding scores continuously; whammy is expressive. | Partial. Tails are drawn but not scored (v1 decision). | Score holds: a draining "hold bar" that fills while the key stays down through the tail; releasing early cuts the trail short (visible) and forfeits the tail bonus. Pedal-down should count as holding (pianists use the pedal). |
| 8 | **Difficulty levels (Easy → Expert) with fewer notes** | Easier charts *remove* notes rather than widen windows. Beginners play the melody skeleton and still feel the song. | Missing. The only knobs are timing preset and playback rate; a student sees every note of an imported track. | **Chart simplification** from the MIDI: Easy = one note per beat on strong beats only, chords reduced to top note; Medium = melody with chords reduced; Hard = full part; Expert = full part + both hands. Compute per part; expose as a picker choice; keep folded % and density stats per difficulty. This is the single most valuable classroom feature. |
| 9 | **Practice mode: sections, slow-down, loop** | Learn a section at 50%, loop it, then speed up. | Partial. Slow-down exists; sections and loops were deferred. | Section detection (from markers, or every 4/8 bars); section select; A–B loop; "wait mode" for chords. |
| 10 | **Results with drama** | Stars fly in, percentage counts up, "You Rock!" crowd noise, longest streak, section breakdown. | Partial. Static table with stars. | Animated count-up, star reveal with stingers, per-section accuracy bars (sections from #9), comparison to previous best ("+4%"), and one clear next-step suggestion ("try Medium at 90%"). |
| 11 | **Intro and count-in** | "Ready… 3, 2, 1"; crowd noise builds; camera swoops. | Partial. Silent lead-in (click count-in with audio). | Visual countdown synced to the click; highway lights up bar by bar during the lead-in. |
| 12 | **Highway motion and perspective** | Receding 3D highway; the beat lines rush at you; camera sways with the music. Sells motion and tempo. | Missing. Flat 2D, notes drop straight down, stripes are static. | Pseudo-3D perspective (trapezoid highway, notes scale up as they approach), beat-line pulse on each beat, subtle horizontal sway on bar lines. Canvas 2D can do this with a per-row scale; no WebGL needed. |
| 13 | **Crowd and venue reaction** | Cheers, boos, lighting changes with performance. | Missing. | Cheap version: backing mix reacts (see #6) plus a low crowd bed that swells on milestones and star power. |
| 14 | **Lag calibration screen** | Tap along to a metronome; the game measures your offset. | Partial. Two numeric offsets in Settings. | Guided calibration: 8 clicks, take the median press offset, store it; a second visual test for audio-vs-visual offset. |
| 15 | **Binary hit/miss with generous window** | GH does not grade Perfect/Great; a hit is a hit. Tiers are a rhythm-game (DDR/Rock Band vocals) idea. | We show tiers. | Keep tiers for scoring but make the *feedback* GH-like: the first-order signal is hit vs miss (sound, flame, streak). Show tier text small, or only "Perfect" for the top tier. |
| 16 | **Setlist, career, unlocks** | Progression across songs. | Missing (packs exist). | Classroom equivalent: a pack is a setlist; track per-song stars; simple "unlock next difficulty at 4 stars". |

## What matters most, in order

1. **Hear your part (#1).** Sound the chart note on hit, a clunk on wrong, nothing on miss. This alone makes it a game instead of a scorer, and it is cheap: the synth and scheduler already exist.
2. **Difficulty by note reduction (#8).** For students on a 25-key controller this is what makes "Beat It" playable at all.
3. **Streak, multiplier meter, milestone call-outs (#3, #4).** Visible state that grows and breaks.
4. **Hit VFX and miss consequences (#2).**
5. **Rock meter with mix thinning; star phrases via pedal (#6, #5).**
6. **Sustains, sections/loops, results drama, calibration (#7, #9, #10, #14).**
7. **Perspective highway and crowd (#12, #13).** Polish; do last.

## Constraints that still hold

- Audience: school class on Oxygen 25 (no sound of its own, octave buttons) and later a Yamaha
  with speakers; Chromebooks and Macs/Windows on Chrome/Edge/Firefox; GitHub Pages hosting.
- Everything must stay playable on 25 keys with folding; feedback must work when the student's
  keyboard is an octave off (relative judging + gate).
- No commercial MIDI in the repo; the 13 local test files live outside git.
- Pure logic stays testable in Node (vitest); browser-only code stays thin.
