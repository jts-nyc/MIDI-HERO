# Guitar Hero technical evidence: input, judgment, score, audio, and provenance

Research date: September 27, 2026. This memo independently inspects Guitar Hero sources and related public implementations; it does not inspect MIDI-HERO. It supplies technical evidence for the main report, not an assertion that the complete original engines have been reconstructed.

## What is established, and by which kind of evidence

The original GH2 and GH3 manuals establish the player-facing contract: fret plus strum for basic notes, continued hold for sustains, independent audio categories, streak multipliers, Star Power, and visible performance states. The MIT specification establishes an unusually clear teaching model of input acknowledgment, judged feedback, and gated recorded audio. CHOpt exposes concrete version-specific scoring and timing assumptions. YARG exposes a complete modern matching implementation, but is neither original Guitar Hero code nor proof of its edge cases. The publicly inspected re-gh2 checkout does not expose readable original judgment code.

**Do not promote third-party model constants to measured facts about shipping games.** In particular, this research has not verified stock-game millisecond hit windows, closest-note selection, chord grace periods, HOPO resets, sustain-release audio envelopes, or health deltas through original executable analysis.

## Original manuals: direct inspection

### Guitar Hero II, PS2 manual (Dual Pack scan)

Source: [original manual scan](https://www.videogamemanual.com/PS2/Guitar%20Hero%20II%20%28Dual%20Pack%29%20%28USA%29.pdf). Downloaded and inspected the embedded page images; this PDF has no extractable text. Printed GHM page numbers differ from PDF page numbers by two.

- **GHM5 / PDF7:** strum up/down activates held fret buttons; tilt or Select activates Star Power.
- **GHM8 / PDF10:** separate band, playable guitar, and sound-effect volume controls; lag calibration; practice selected portions at normal or reduced speed.
- **GHM11 / PDF13:** repeated notes may reuse a held fret while restrumming. Sustains require holding through the note. Chords combine notes. Whammy audibly bends long notes. The rock meter distinguishes good, acceptable, poor, and imminent-failure states. Streaks earn 2–4× multipliers, lost on mistakes; Star Power doubles the multiplier and requires a half-full meter.
- **GHM12 / PDF14:** complete star-note groups earn Star Power; whammy on starred sustains adds more. Easy uses three fret buttons, Medium four, Hard/Expert five. Easy excludes store access. Results show stars, score, streak, hit percentage, and further statistics.

Confidence: high for these documented player-facing rules. The manual does not supply exact matching algorithms or signal-processing behavior.

### Guitar Hero III, Xbox 360 booklet

Source: [original Activision booklet PDF](https://www.videogamemanual.com/xbox360/Guitar%20Hero%20III-%20Legends%20of%20Rock.pdf). Read the gameplay, options, score, Star Power and result sections (printed pp.7–10; PDF pp.5–7). Its control/scoring contract corroborates the GH2 statements above: held repeated frets, sustained holds, separate audio categories, multiplier loss, whole star phrases, half-meter activation, and multiplier doubling. It additionally documents score, streak and hit percentage as distinct results. This is original booklet content on an archive, not a developer explanation of implementation. Do not infer that identical wording proves identical engine behavior. The earlier Wii booklet transcription on Manualzz was also inspected, but its search-provided URL was truncated; this complete PDF URL supersedes that citation.

## Developer teaching specification: the three events must remain distinct

[Eran Egozy's MIT Assignment 7](https://ocw.mit.edu/courses/21m-385-interactive-music-systems-fall-2016/ad8c22178b0c4d54ee46bfcd85d98fb1_MIT21M_385F16_pset7.pdf), pp.1–4, explicitly describes a simplified keyboard-input Guitar Hero exercise. Its ±100 ms acceptance window is an assignment value, not verified stock-game timing.

The complete event table and scope limits are consolidated in [developer-learning-evidence.md, D3](developer-learning-evidence.md). That memo is the canonical account of the teaching specification; this technical memo does not treat it as retail source code.

## CHOpt: inspectable, version-specific scoring model

Repository: [GenericMadScientist/CHOpt](https://github.com/GenericMadScientist/CHOpt), inspected commit **38d13d46a61b18fff4905e3dc978adae398d0af4**. Cloned read-only for analysis into temporary storage. [README engine choices](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/README.md#L31-L49) explicitly support GH1, GH2, GH3 separately. This is a Star Power optimizer, assuming successful chart performance for its scoring points; it has no original controller polling, health system, music muting, or hit graphics.

### Code trace

1. [`append_note_points`, src/points.cpp lines 288–354](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/src/points.cpp#L288-L354) calculates a note's timestamp and neighboring gaps, asks the selected engine for early/late bounds, scales by the pathing squeeze setting, and assigns a base value multiplied by chord size.
2. [`append_sustain_points`, lines 127–218](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/src/points.cpp#L127-L218) turns holds into score points, with separate musical-beat/fretbar policies, rounding, and chord-multiplication behavior.
3. [`apply_multiplier`, lines 474–490](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/src/points.cpp#L474-L490) increments combo on note heads, not on sustain ticks, then applies the chosen transition order. It is an all-hits traversal; it cannot itself establish miss/reset behavior.
4. [`sp_deduction`, src/sp.cpp lines 36–42](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/src/sp.cpp#L36-L42) deducts one full Star Power bar per eight SP measures. The meaning of SP measures comes from the time-map/engine policy, not necessarily eight ordinary bars in every time signature.

### Model differences that matter

Source for this table: [`BaseHarmonixGhEngine`, `Gh1Engine`, `Gh2Engine`, `Gh3Engine`, include/engine.hpp lines 305–471](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/include/engine.hpp#L305-L471).

| Model property | GH1 | GH2 | GH3 |
|---|---:|---:|---:|
| Base single note head | 50 | 50 | 50 |
| Maximum ordinary multiplier | 4 | 4 | 4 |
| Threshold note head uses old multiplier? | Yes | No | No |
| Hold scoring metric | Musical beats | Musical beats | Fretbars |
| Nominal hold points per metric unit | 25 | 25 | 25 |
| Chord size multiplies hold points | Yes | Yes | No |
| Early-whammy support in model | Yes | Yes | No |
| Early bound in model | min(0.100, previous gap/2.0001) s | 0.100 s | 0.116 s |
| Late bound in model | min(0.100, next gap/2.0001) s | min(0.100, next gap/2.0001) s | min(0.100, next gap/2.0001) s |
| Resource per complete phrase | 0.25 bar | 0.25 bar | 0.25 bar |
| Minimum resource to activate | 0.5 bar | 0.5 bar | 0.5 bar |

Confidence: high that these are the inspected model's rules; moderate or unresolved as exact stock-game rules until corroborated. The source itself calls the 2.0001 denominator a numerical fudge to prevent certain boundary squeezes. **Therefore quoting this table as literal original hit-window code would be misleading.** The `squeeze` setting further reduces the model's bounds; screenshot/path appearance is not a direct representation of the whole controller engine.

### Boundary order: a small detail with a visible consequence

For successful single note number `n`, the ordinary GH2/GH3 model multiplier is `min(floor(n/10)+1, 4)`. GH1 note heads instead use `min(floor((n-1)/10)+1, 4)`. GH1 hold ticks use the updated combo multiplier.

At ten consecutive unsustained single notes, this predicts GH1 = `10×50 = 500`; GH2/GH3 = `9×50 + 100 = 550`. It predicts GH1's tenth-note sustain can already score at 2× even though that note's head scored at 1×. The explicit regression test [`gh1_multiplier_delay_accounted_for`, tests/points_unittest.cpp lines 650–662](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/tests/points_unittest.cpp#L650-L662) asserts exactly the latter distinction: the tenth head is worth 50 and its following one-point hold tick is worth 2.

Tests tied by comments to actual GH1 *Ace of Spades* passages also check hold rounding: [`tests/points_unittest.cpp` lines 410–459](https://github.com/GenericMadScientist/CHOpt/blob/38d13d46a61b18fff4905e3dc978adae398d0af4/tests/points_unittest.cpp#L410-L459). For the two-fret, 360-tick chord at resolution 480, the model computes `100 + 2×round(25×360/480) = 138`. Rounding after multiplying would instead give 137 or 138 depending policy; the code rounds per-fret duration before multiplying. This confirms a model behavior, not a new observation of the console.

The test named `gh1_one_beat_sustain_is_handled_correctly` actually supplies 1917 ticks at resolution 480, almost four musical beats. Its total 150 is consistent with 50 + rounded 99.84375. **Read test inputs and assertions, not test names alone.**

### Worked feedback/score trace (reconstructed example, not a captured run)

Assumptions: GH2 CHOpt success values, ordinary single-player multiplier rules from the manual, no Star Power, no partial holds, and an error that resets combo without subtracting already-earned points. The last assumption is not proven by CHOpt, which does not simulate errors. This example illustrates the consequence structure; it must not be presented as empirical game footage.

| Event | Score gained | Running score | Streak consequence |
|---|---:|---:|---|
| Nine single-note hits | 9×50 = 450 | 450 | 9, at 1× |
| Tenth hit is two-fret chord | 2×50×2 = 200 | 650 | 10, now 2× |
| Eleventh hit, single note with two-beat hold | Head 50×2 + hold 25×2 beats×2 = 200 | 850 | 11, still 2× |
| Miss next note | 0 | 850 under stated assumption | Combo resets |
| Correct recovery single note | 50 | 900 | 1, at 1× |

The interesting design consequence is not the particular numbers. Recovery can restore immediate successful play while the score economy takes much longer to recover. The player may be playing correctly yet earning less than before. That is a plausible reason to show recovery separately from multiplier rebuilding. It is also a reason why points and hit percentage measure different achievements.

## re-gh2: what is and is not available

Repository: [YoshiCrystal9/re-gh2](https://github.com/YoshiCrystal9/re-gh2), commit **ef521f4c7ab57cbd201de6f9acf37f218f48fa49**.

The [README](https://github.com/YoshiCrystal9/re-gh2/blob/ef521f4c7ab57cbd201de6f9acf37f218f48fa49/README.md) calls this an Xbox 360 recompilation proof of concept, reports crashes/performance limitations, and requires an extracted game plus generated code. The checked-in [`src/main.cpp`](https://github.com/YoshiCrystal9/re-gh2/blob/ef521f4c7ab57cbd201de6f9acf37f218f48fa49/src/main.cpp) initializes the ReX runtime, loads `default.xex`, and creates a window. [`src/arkless.cpp`](https://github.com/YoshiCrystal9/re-gh2/blob/ef521f4c7ab57cbd201de6f9acf37f218f48fa49/src/arkless.cpp) is a file-access hook. The `generated` directory contains only `.gitignore`. `gh2test_config.toml` identifies `assets/default.xex` and many address-based function names/sizes, without readable gameplay semantics.

This checkout is **not** a release of original, human-readable Guitar Hero gameplay source. No note-match, HOPO, sustain, or audio-muting implementation was recovered from it in this investigation. The original target executable/platform can be identified broadly as GH2 Xbox 360; the inspected configuration does not establish a retail binary hash/version. No game assets were downloaded and no original executable was run.

## GH2 calibration patch: evidence of a useful separation, not stock behavior

Repository: [hmxmilohax/gh2-calibration-fix](https://github.com/hmxmilohax/gh2-calibration-fix), commit **e11ec53fcd48231ab0ea0be58b658bcc9ec69f08**. Its README describes a mod allowing separate audio/video calibration on both platforms.

The inspected [`set_calibration`, _ark/ui/funcs.dta lines 15–30](https://github.com/hmxmilohax/gh2-calibration-fix/blob/e11ec53fcd48231ab0ea0be58b658bcc9ec69f08/_ark/ui/funcs.dta#L15-L30) sends `-lag_video` to `options set_sync_offset` (commented as the input/hit-window offset), separately calculates `-(lag_audio - lag_video)` for the audio offset, and dispatches it through a loaded audio-lag object. The binary object was not reverse engineered here. Commented internal baseline values in this file are intentionally unused; do not present them as measured calibration facts.

Its [`hud_panel.dta` lines 7–20 and 53–62](https://github.com/hmxmilohax/gh2-calibration-fix/blob/e11ec53fcd48231ab0ea0be58b658bcc9ec69f08/_ark/ui/hud_panel.dta#L7-L62) shows event subscription and a Star Power-ready branch that triggers both a HUD message and sound. This is readable mod-distributed script, with uncertain unmodified-original provenance, but it demonstrates an event-to-multiple-feedback architecture.

Design inference: MIDI-HERO should distinguish audible-output delay, visual delay, and judgment alignment. A single wider acceptance window may hide some symptoms while leaving the player learning an offset movement. This patch is a concrete example of separate corrections, not a recommendation to copy its signs or constants.

## YARG.Core: modern reference implementation, explicitly not Guitar Hero

Repository: [YARC-Official/YARG.Core](https://github.com/YARC-Official/YARG.Core), commit **e2d44e8d84172921f7b4fded6f09a4aea4524c23**. Read matching and event paths; did not build or run it.

- [`YargFiveFretGuitarEngine.cs` lines 93–104](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/Engines/YargFiveFretGuitarEngine.cs#L93-L104) distinguishes strum-on events from fret-state changes.
- [Lines 144–178](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/Engines/YargFiveFretGuitarEngine.cs#L144-L178) consume certain strums after recent HOPOs, punish double-strums in other conditions, and start a strum-leniency timer. This illustrates how forgiving input order requires explicit state rather than just a wider note window.
- [Lines 238–333](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/Engines/YargFiveFretGuitarEngine.cs#L238-L333) inspect pending notes, handle expired notes, check fret eligibility, separately evaluate HOPO/tap state, and fall back to strumming. The HOPO condition depends on combo or the first note in the chart, with an explicit practice accommodation. There are extra modes and exceptions beyond GH1–3.
- [Lines 424–462](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/Engines/YargFiveFretGuitarEngine.cs#L424-L462) accept exact masks, require exact matches for strummed chords, and separately treat anchored single notes and HOPO/tap chords.
- [`GuitarEngine.cs` lines 270–332](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/GuitarEngine.cs#L270-L332) order a hit as combo increment → statistics → multiplier update → score → sustain initiation → note-hit event. A miss marks the note, invalidates affected Star Power, clears combo, updates multiplier, and emits a miss event. [Overstrum lines 173–202](https://github.com/YARC-Official/YARG.Core/blob/e2d44e8d84172921f7b4fded6f09a4aea4524c23/YARG.Core/Engine/Guitar/GuitarEngine.cs#L173-L202) ends active holds and emits its own event after state updates.

These paths support a technical lesson: input, matching, judgment, state accounting, and presentation should be distinguishable in an instrument game's specification and logs. They do not establish GH2's anchor rules or GH3's exact HOPO leniency. YARG.Core does not contain the complete audio/visual reaction implementation in these inspected files; emitted events are the boundary, not evidence of an actual mute or flame.

## Evidence gaps that should remain explicit in the report

| Question | What this investigation can support | What remains missing |
|---|---|---|
| Input → judgment | Manual contract; full YARG comparison | Original GH1–3 event ordering, polling rate, target selection, grace periods |
| Timing | CHOpt model values and numerical approximations | Characterized stock-game input/window measurements |
| Audio | Original independent mix categories; developer teaching stem gating | Original mute/fade/unmute timing and miss-vs-pass behavior by title |
| Graphics | Teaching acknowledgment vs success split; mod HUD event script | Original rendering path, measured effect duration, live frame/event comparison |
| Score | Explicit model and version differences; manual multiplier contract | Replay-verified worked original-game trace including failure/reset |
| HOPO recovery | Explicit YARG state model | Version-specific original behavior established by original code or controlled tests |
| Health/failure | Manual qualitative meter states | Damage/recovery formulas and difficulty dependence |

The best next evidence for unresolved mechanics is controlled original gameplay with synchronized raw inputs and sound, not additional general descriptions. For MIDI-HERO, source-backed principles can already guide prototypes: acknowledge every input; distinguish omission from active error; define chord and repeat semantics; preserve immediate recovery; separate performance success from high-score optimization; and test whether assisted sound preserves or conceals the keyboard action the player is supposed to learn. These are design inferences, not demonstrated causal effects on practice motivation.

## Bounded follow-up: GH2 Deluxe audio configuration

Public GH2DX Xbox 360 tree inspected through the GitHub API, commit **e4116a1852bdc9e84abab0017d9a533c60f1fdee**; downloaded only two text scripts, no executable/assets or repository clone. The [project README](https://github.com/hmxmilohax/Guitar-Hero-II-Deluxe-360/blob/e4116a1852bdc9e84abab0017d9a533c60f1fdee/README.md) describes a Track Muting modifier that disables muting the played instrument on misses, and a No Flames modifier that suppresses successful-hit flames.

[`_ark/config/beatmatcher.dta`, lines 167–173](https://github.com/hmxmilohax/Guitar-Hero-II-Deluxe-360/blob/e4116a1852bdc9e84abab0017d9a533c60f1fdee/_ark/config/beatmatcher.dta#L167-L173) defines audio attenuation settings and sets `mute_volume` to -96 or -0.001 depending on `$muting`. The nearby comment says Harmonix had not used this property in GH2, despite its presence; this makes it especially inappropriate to assume the mod setting is an original stock value or proves the complete retail muting path. The underlying miss/hit callback and fade envelope are still missing. Additional submix names/data in this file are not enough to prove they are live in the shipping game.

[`watcher.slop`, lines 136–148](https://github.com/hmxmilohax/Guitar-Hero-II-Deluxe-360/blob/e4116a1852bdc9e84abab0017d9a533c60f1fdee/_ark/config/beatmatcher.dta#L136-L148) uses 100 for standard/slow speeds and comments that this is the stock 100 ms window, with proportional behavior. This offers mod-author corroboration for the CHOpt GH2 nominal early bound, but still does not prove effective window boundaries after original note-selection/input rules, nor measured end-to-end latency.
