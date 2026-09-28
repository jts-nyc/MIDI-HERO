# Guitar Hero → MIDI-HERO: audio assessment plan

September 27, 2026. Proposed investigation, not completed auditory findings. Independent of the current MIDI-HERO build.

**Execution status:** the [feasibility attempt](audio-pilot-findings.md) did not pass the source/listening/sequence/measurement gates. The [handoff](audio-pilot-handoff.md) is ready for a supplied recording and later annotation. No new behavior has been heard or measured. The user can potentially record sooner than they can listen; file inspection may proceed when a source arrives, while auditory conclusions remain open. A separate [student trial](student-audio-trial.md) tests keyboard hypotheses without relying on completed Guitar Hero findings.

**Aim:** Reconstruct how player actions change what is heard, establish how those changes communicate success, failure and recovery, and identify which mechanisms support real keyboard playing within an initially reduced, two-octave arrangement.

The existing report has source-backed audio hypotheses but no verified listening study. Screenshots, captions and descriptions cannot close that gap. This investigation is a prerequisite to treating its audio recommendations as established.

## 1. Establish a usable listening and capture route first

Run a small feasibility pilot before gathering a large video library. Obtain one short recording with original game audio, a clear error and a subsequent successful action. Prefer a recorder-provided export or a controlled capture of a legitimately available game. Publicly playable recordings can support listening; a source file is needed for reproducible signal measurements. Do not bypass blocked videos or download media to evade browser restrictions.

Preserve the original recording. Check for commentary, replacement soundtrack, edits, volume normalization, clipping, automatic gain control and unknown audio/video offsets. Record what is unknown; exclude replacement soundtracks from reactive-audio evidence.

**Availability checked in the pilot:** FFmpeg and FFprobe 8.1 run; bundled Python 3.12.14 imports NumPy 2.3.5. The default `python3` lacks NumPy; resolve the bundled interpreter through the workspace dependency tool. These support analysis of supplied or otherwise permitted local recordings. They do not provide perception or prove which game component generated a sound.

**Still required:** a verified way to listen. Browser screenshots do not convey audio to this research session, and speech transcription cannot characterize musical feedback. Use a human listener with an annotation sheet, optionally assisted by an audio-understanding system only after its actual music-input capability is verified. Before relying on such a system, test it blind on known clips containing a removed instrument, a brief error sound and an unchanged control. Merely accepting an audio file is insufficient.

Pilot exit criteria: the listener can hear the original sound; the recording exposes at least one interpretable input/error/recovery sequence; source provenance is recorded; and measurements can be tied to the same passage. If any requirement fails, change the source or capture method before expanding. No unverified listening results enter the report.

## 2. Start with controlled GH2 comparisons, then test generality

Use stock Guitar Hero II as the initial reference, with one documented platform/version, song, difficulty, mode and calibration setting. Its manual documents separate band, playable-guitar and sound-effects volume controls, making controlled comparisons a promising route. Diagnostic mixes still require empirical verification of what each slider affects. [GH2 PS2 manual, printed GHM8](https://www.videogamemanual.com/PS2/Guitar%20Hero%20II%20%28Dual%20Pack%29%20%28USA%29.pdf).

Choose three types of passage: sparse isolated attacks, a sustained guitar part, and a dense passage. For each, capture a correct baseline and a repeat with one deliberate intervention, followed by correct recovery. Start with roughly five usable repetitions for each central condition; expand when behavior varies. Repetitions characterize consistency, not a statistically powered player study.

Record direct game output where possible, retaining its native sample rate and channels, with an uncompressed or lossless analysis copy. Record the controller/hands and gameplay together. Raw input logging is preferable when legitimately available, but do not modify a stock game and then silently describe the result as stock behavior. A filmed physical action is evidence with timing uncertainty, not an engine event log.

Capture the default mix first. Then repeat selected passages with the game's band/guitar/effects controls adjusted to help identify layers. Record every setting and retain default-mix examples so the analysis also covers the actual listening experience. Do not assume the effects slider isolates only miss sounds, or that mixer changes leave every other behavior untouched.

After resolving the main questions, reproduce central cases in GH1 and GH3 and a second song. Add difficulty comparisons within the same song. Keep results separated by game/platform/mode; practice mode or a modern recreation cannot establish stock career-mode behavior.

## 3. Test distinct input events and recovery states

| Controlled comparison | What to listen for and measure | Decision it informs |
|---|---|---|
| Successful input versus fret press without a strum | Does input alone sound? Is success a new attack, continued playback, or restoration of an already running part? | Separate physical acknowledgement from musical success. |
| Omitted note versus wrong-fret strum versus empty strum | Error effect, removal/attenuation of an instrument, unaffected accompaniment; whether the three conditions differ | Errors may require different feedback rules. |
| Accepted early/on-time/late actions | Relationship between physical input and the audible musical attack | Determine whether the game grants timing tolerance while the recording stays on the song clock. |
| Rejected early/late actions | When the rejection becomes audible; separate input time, target time and judgment deadline | Avoid attributing all delay to audio latency. |
| One miss followed by a correct hit | Exact restoration point, fade shape, whether music resumes at its current position, whether the attack is preserved | Establish how quickly musical agency returns. |
| Repeated misses, then recovery | Whether errors accumulate, repeat, overlap or saturate; whether recovery requires one or several successes | Understand punishment intensity and recovery cost. |
| Sustain held versus released early | Attack, body, tail and reverb changes; whether the whole part or only its continuation changes | Inform duration feedback and later keyboard note-off behavior. |
| Whammy inactive/active, with and without resource-bearing sustain | Pitch/timbre changes versus resource cues | Distinguish expressive sound from score/resource feedback. |
| Star Power ready/activated/ended | Separate cue, mix, timbre and crowd changes from coincident musical changes | Establish how state transitions are made audible. |
| Good versus poor performance; near failure and failure | Crowd/ambience, warnings, music interruption and silence | Assess emotional pressure and preservation of a useful beat reference. |
| Practice speed changes and section restarts | Pitch, timing, count-in, continuity and time until useful playing resumes | Understand how audio supports another attempt. |

For hammer-ons/pull-offs, add matched successful and failed attempts after the core strum conditions. For all tests, confirm the actual accepted/missed outcome from gameplay evidence; an intended early action is not automatically a rejected early action.

An especially important difficulty test: in the same passage, determine how much audible musical material continues between scored notes on Easy versus Expert, and what disappears after a miss on each. This directly tests the relationship between reduced input complexity and a convincing musical performance.

## 4. Reconstruct the sound logic, with uncertainty visible

Create an event record for each trial:

`game/build → song/difficulty/mode → source and mix → target → observed input → visible judgment → audio change → next successful input → restoration → confidence`

Track input, visible judgment and audio as separate timelines. Document how the recording synchronizes them. With ordinary uploaded video, report ordering and defensible bounds; do not report precise engine latency from frame timestamps. Audio sample resolution does not remove uncertainty about when the game received input.

Use the correct-performance recording as the passage reference. Align recordings using accompaniment that appears unchanged, estimate drift, and preserve uncertainty. Avoid arbitrary time warping that could erase the timing difference under investigation. First compare repeated correct runs to learn how much the mix varies without an error.

Inspect waveforms, short-time energy and spectrograms around the event. Where isolation is trustworthy, estimate attenuation relative to the baseline, onset of change, fade duration, error-effect duration and recovery time. State the analysis window and noise floor. Report a range or an unresolved result when the mixed signal cannot support a clean measurement.

Do not equate a total-volume drop with guitar muting. Crowd variation, reverb, codec artifacts and phase differences can defeat naive subtraction. A naturally silent guitar passage cannot reveal whether its channel was muted. Automated source separation can help locate a suspected change but is an estimate, not proof of the original stem or engine operation.

Use four explicit evidence labels: **heard**, **measured**, **documented**, and **inferred**. Disagreements remain in the record. Infer a candidate state machine only after comparing trials: normal playback → error response → diminished/missing part → recovery. Leave transitions open where evidence is incomplete.

Trace candidate mechanisms against original manuals, developer material and relevant code. The existing [technical memo](technical-evidence.md) separates original documentation, mods and recreations. MIT's [simplified Guitar Hero assignment](https://ocw.mit.edu/courses/21m-385-interactive-music-systems-fall-2016/ad8c22178b0c4d54ee46bfcd85d98fb1_MIT21M_385F16_pset7.pdf) is a useful hypothesis source, not retail implementation proof. Numerical thresholds in teaching code or a recreation must not become claims about the original games.

## 5. Assess what the sound communicates

Listen first at normal speed in the full mix. Then use short event excerpts for diagnosis, retaining enough lead-in and recovery to understand the phrase. Preserve relative loudness: use common playback gain rather than independently normalizing away the feedback difference.

Use a small formative panel, for example six people spanning unfamiliar players, experienced rhythm-game players and keyboard players. This is an initial usability probe, not a population estimate. Randomize clip order and avoid telling listeners the suspected mechanism.

Run audio-only trials to assess what sound communicates by itself, then audiovisual trials to assess the whole experience. Ask listeners to mark where something went wrong, what changed, when control returned, whether the beat remained followable, and whether they could identify their instrument. Collect short descriptions of harshness, satisfaction and musical ownership without assuming those feelings.

Watching recordings cannot establish willingness to practice. Add a separate hands-on session, where feasible, observing whether players notice the cue, recover, choose a retry and improve the target passage. Keep observed choices separate from stated preferences. The investigator's interpretation is not a measured player response.

## 6. Translate findings into real-keyboard experiments

Guitar Hero evidence should inform hypotheses about MIDI-HERO; it does not settle how a real keyboard should sound. Use an original or appropriately available short arrangement within two octaves, independent of the current application. Freeze visuals, judgment and backing while changing one audio policy at a time.

The first comparison should test three concrete policies: audible player notes with accompaniment; the same with a restrained error cue; and the same with a performance-dependent accompaniment change. Treat a prerecorded target part replacing the player's notes as a separate comparison, explicitly testing whether listeners can distinguish what they actually played. Do not adopt it merely because it makes the result sound polished.

Investigate wrong pitch, early/late attack, held notes, early release, partial chords, velocity and repeated errors. Account for keyboards with their own audible sound versus silent controllers using software instruments; double monitoring can invalidate a comparison. Document end-to-end response delay and keep it stable across conditions.

For reduced arrangements, test whether accompaniment supports the song while leaving the assigned melody audibly owned by the player. Compare recognition, ability to hear one's mistakes, recovery, voluntary retries and actual note/timing improvement. Add a brief replay with reduced guidance and a later replay to distinguish immediate game performance from retention. Start formative; choose quantitative sample size and decision margins after pilot variability is known.

Reject a policy if it makes wrong playing sound convincingly correct without clear disclosure, repeatedly obscures the beat needed for recovery, or improves apparent game success while weakening the player's ability to hear and reproduce their assigned part. Treat these as proposed design guardrails to validate, not discoveries about Guitar Hero.

## Deliverables and completion gates

1. **Pilot evidence:** a usable source, verified listener route and one documented error/recovery sequence.
2. **Audio response atlas:** linked source timestamps or permitted short local excerpts, matched correct/error/recovery examples, annotated plots and event records.
3. **Version-specific response matrix:** what each input changes in instrument audio, effects and ambience; timing bounds; restoration condition; confidence; remaining gaps.
4. **Listening findings:** what participants can identify and what remains ambiguous, separate from investigator measurements and causal claims.
5. **North-star revision:** confirmed mechanisms, unresolved questions and keyboard-specific hypotheses, with an explicit recommendation for the next playable audio experiment.

Close the core Guitar Hero audio investigation only after error, omission, recovery, sustain and reduced-difficulty ownership each have interpretable listening evidence, with repeat or independent corroboration for central conclusions. Optional effects can remain scoped follow-ups. A missing capture or listening route remains a visible dependency; additional written sources do not substitute for it.
