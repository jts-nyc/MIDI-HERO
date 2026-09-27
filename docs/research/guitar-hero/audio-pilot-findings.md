# Audio feasibility pilot: findings and handoff

September 27, 2026. Follow-up to [PR #6](https://github.com/jts-nyc/MIDI-HERO/pull/6), starting from research commit `656f733dba9d960c728ad317aad9bc66a1b96a59`. Independent of MIDI-HERO's current build; no application implementation was inspected or run.

## Result

**Pilot incomplete: original audio access and verified listening have not been established.** Existing video pages are accessible, and one player's clock advanced, but no listener verified their sound and no recording file is available for reproducible signal analysis. **New heard findings: 0. New game-audio measurements: 0.** No retail audio mechanism is newly confirmed.

The user chose to prepare a handoff and confirmed no source/setup was available at intake. They subsequently offered to listen and annotate in at least a couple of weeks, and to screen-record a **publicly playable original-game video** later today or make a capture route available overnight. The handoff selects existing V2 as a candidate; recording setup and audio capture remain unverified, and no overnight job is scheduled. Broader Guitar Hero collection, controlled comparisons and the listening panel remain deferred. This is the outcome of attempting the feasibility stage, not completion of the [audio assessment plan](audio-assessment-plan.md).

Because the user wants student exposure sooner, the separate [student trial protocol](student-audio-trial.md) tests provisional keyboard behavior independently. It need not wait for Guitar Hero reconstruction, but cannot use this incomplete study as evidence that a sound policy is validated.

## What was checked

Read the research index, audio plan, north-star report and supporting gameplay, technical, developer/learning, arrangement and review evidence before testing access. An independent subagent checked the minimum gates and evidence classifications. The checks below concern access and readiness; player controls are not auditory evidence.

| Check | Actual result | Limit |
| --- | --- | --- |
| Existing V2: [IGN GH3 PS3 gameplay](https://www.youtube.com/watch?v=UHaQSiHoNL8) | Page title and IGN attribution loaded in the in-app browser. Player displayed 0:30 duration. After Play, displayed position advanced from 0:00 to 0:02, and later 0:26 before pausing. | Only playback-state access verified. Sound, original soundtrack, commentary, processing and capture offsets remain unverified. |
| Existing V5: [CasuallyGaming GH2 Basic Lessons](https://www.youtube.com/watch?v=SfgrL2A6sFw) | Page title, uploader and 5:05 player duration loaded. | Page access only in this follow-up; no verified listening or error/recovery passage. Tutorial mode is not evidence of song-mode behavior. |
| Local recording availability | Repository search found no files with `.wav`, `.mp3`, `.mp4`, `.flac`, `.m4a` or `.webm` extensions; user confirmed no source/setup yet. | Bounded repository check, not a search of the user's whole computer or connected storage. |
| Analysis tools | FFmpeg and FFprobe both run and report 8.1. Bundled Python 3.12.14 imports NumPy 2.3.5. | Default `python3` cannot import NumPy. Tool availability does not verify an actual recording, analysis pipeline or perception. |
| Listening capability | Browser interface supplies page state/images. Available tool descriptions did not expose a verified music-listening route. No human annotation was collected. | Speech transcription, generation tools and file acceptance cannot establish musical perception. No audio-understanding system passed the plan's blind controls. |

V2 was checked as a short existing loss/rebuild candidate, not substituted for the planned stock GH2 baseline. Its approximately 10–17-second sequence comes from the earlier [visual notebook](gameplay-observations.md); it was not newly annotated frame by frame here. It does not distinguish omission, wrong fret or extra strum. Song, difficulty, mode, build and calibration remain unknown. PS3 is identified by the uploader's title, not independent verification of the executable.

V5 identifies GH2 and tutorial context; platform, build, stock/mod status, calibration and mix settings remain unknown. Neither candidate has a preserved local source or hash. For both, replacement soundtrack, edits, normalization, clipping, automatic gain control and A/V offset are unknown. No media was downloaded, no restriction was bypassed, and no original game was run.

## Pilot gates

| Gate | Status | Evidence and dependency | Next action |
| --- | --- | --- | --- |
| Original game sound and source provenance | Not passed | Candidate pages load; originality of their audio is unverified. No recorder-provided file or controlled stock capture. | Capture and qualify one original-game passage using the handoff; stock GH2 remains preferred for subsequent controlled comparisons. |
| Verified listening route | Not passed | No listener available for this pass; no validated music-understanding system. | A human confirms audible playback of that capture and records observations. |
| Interpretable error then successful recovery | Not passed | V2 supplies prior visual loss/rebuild only, in GH3, with unknown input cause. V5 supplies no established sequence. | Capture visible deliberate input and actual judgment, with successful playing before and after. |
| Measurement tied to the same passage | Not passed | Tools available; source file, hash, interval and synchronization characterization absent. | Preserve and probe the same file the listener hears; record timing bounds. |

All four gates must pass before expanding the corpus. Hearing a public stream can partially advance listening, but cannot supply reproducible measurements without a suitable source file. Five repetitions per main condition belong to the next stage, not this first access check.

## Evidence ledger and unresolved behavior

| Label | Current support | What cannot be claimed |
| --- | --- | --- |
| **Heard** | None in this investigation. Future entries must identify the listener, source and interval, and say “listener reported” when appropriate. | Error timbre, guitar disappearance, continued accompaniment, restoration or emotional effect. |
| **Measured** | No game-audio measurements. Runtime versions and player positions above are readiness observations. | Attenuation in dB, fade duration, recovery delay, latency, clipping level or stem isolation. |
| **Documented** | Existing [technical evidence](technical-evidence.md) records GH2 PS2 manual mixer categories. [Developer evidence D3](developer-learning-evidence.md) separately records the MIT teaching exercise's pass/mute and hit/unmute rules. | Mixer controls do not prove retail error envelopes. A teaching exercise or mod does not establish stock behavior. These are inherited findings, not newly inspected source documents. |
| **Inferred** | A controlled GH2 capture is the most useful next step because it can connect known input, actual judgment and the same sound passage. The keyboard policies below remain experimental proposals. | A reconstructed retail state machine, universal GH1–3 behavior, or demonstrated learning/retention benefits. |

The core response matrix therefore remains open:

| Original-game condition | Heard | Measured | Unresolved question |
| --- | --- | --- | --- |
| Correct input / fret without strum | No | No | New attack, continued recording, or restored part? |
| Omission / wrong fret / empty strum | No | No | Which effect or instrument change belongs to each event? |
| First correct action after error | No | No | What restores, when, and with what fade or preserved attack? |
| Sustain held / released early | No | No | What happens to body, tail, reverb and other instruments? |
| Same passage on Easy / Expert | No | No | What audible material is controlled between scored notes? |

These rows have no version-specific auditory result yet. Prior visual judgment remains a separate record. Candidate transitions such as normal playback → error response → diminished part → recovery are hypotheses; no transition timing or restoration condition is filled in from documentation alone. Whammy, Star Power, crowd, failure, practice and HOPO audio are also untested.

## Recommendation and next action

Use the [pilot handoff](audio-pilot-handoff.md) to obtain one short original-game capture and one listener's annotation. A qualified GH3 passage can establish feasibility while leaving the stock GH2 baseline outstanding. Resume this gate check on those materials before collecting a library. The full response atlas, repeated comparisons and participant findings remain outstanding.

If a recording arrives before the user can listen, preserve/probe it and prepare timestamped event candidates and measurements with explicit uncertainty. Keep all **heard** fields pending and the pilot incomplete. Overnight capture depends on an identified permitted source, a working capture setup and a short test that actually contains audio; scheduling alone cannot supply those dependencies.

The next playable keyboard experiment remains **proposed**: use the original “First Lights” arrangement from the [arrangement memo](arrangements-evidence.md), in a standalone setup independent of the current app. Compare actual played notes plus backing, the same with a restrained error cue, and the same with a performance-dependent backing change. Hold visual targets, judgment, backing content and response delay stable. Treat a prerecorded replacement lead as a separate disclosed assistance condition. Measure error identification, re-entry, voluntary retry and reproduction of the assigned notes; preference alone does not establish learning. No policy is selected or validated by this incomplete pilot.
