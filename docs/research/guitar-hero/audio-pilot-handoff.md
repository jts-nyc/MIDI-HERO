# Audio pilot handoff

September 27, 2026. Ready-to-use capture and annotation instructions; **no completed trials or listener data**. See [pilot findings](audio-pilot-findings.md) for the actual access checks and [full plan](audio-assessment-plan.md) for later comparisons.

## Smallest useful return

Provide one unedited recording containing original-game audio, plus a listener's completed notes when available. A controlled **stock Guitar Hero II** setup is preferred for the full study; another original-game capture can establish initial feasibility without establishing GH2 behavior. With game access, prefer a sparse song passage with several successful actions, one deliberate omitted target, and successful recovery. Include a matched correct pass if practical. Keep enough lead-in and continuation to hear the phrase. A 15–30-second passage is a capture suggestion, not a measured game requirement.

Record direct game audio and gameplay together, with hands/controller visible where possible. Record an omission as intended until the footage confirms the target was missed. Do not replace or overdub the soundtrack. Preserve the native recording before making an uncompressed/lossless analysis copy; converting lossy audio does not restore lost information. Keep source files outside the committed research package unless their inclusion is separately appropriate.

If only a public recording is available, record its URL and attribution and ask a listener to assess it. Originality and permitted file access must still be resolved; a working stream alone does not pass the measurement gate. Keep GH3 and tutorial observations separate from stock GH2 song-mode results.

## Current public-video capture assignment

The user can record a public video sooner and annotate in at least a couple of weeks. **Capture now; listen later.** The candidate is [IGN's 30-second GH3 PS3 clip, V2](https://www.youtube.com/watch?v=UHaQSiHoNL8). Capture the complete 0:00–0:30 at normal speed, preserving the context around the earlier visual notebook's approximately 0:10–0:17 loss/rebuild sequence. That interval is a candidate, not an established audible error/recovery event. Exact input cause is unknown.

1. Use ordinary permitted playback. Do not bypass restrictions or obtain media through a workaround when playback is blocked. Record URL, title, uploader, capture date and any visible player settings.
2. Make a short capture test first. Select game/browser audio in the recorder if supported; a microphone-only recording can omit or contaminate the signal. Record which audio route was actually used. No recording setup has been verified in this task.
3. Preserve the raw screen recording, for example `V2-IGN-GH3-PS3-capture-YYYY-MM-DD.mov`, without trimming or normalizing it. Keep ads, buffering and interruptions documented; mark interrupted passages unusable. Do not claim that a screen recording is the uploader's original master.
4. Supply its local path. The analyst can inspect audio streams, decode samples, check for digital silence/peaks, and prepare interval annotations before a human listens. An audio track or nonzero samples alone do not prove the intended sound was captured.
5. Later, the listener confirms audibility and describes the candidate passage using the sheet below. If original/reactive audio or an interpretable sequence remains uncertain, change source before expanding.

A screen capture adds browser playback and recorder processing to unknown uploader edits, compression and offsets. Record those limits. Measurements describe the captured signal; they cannot establish stock engine latency, isolated guitar attenuation or error type by themselves. This candidate has no matched correct baseline. An overnight session is not scheduled: it first needs a verified recorder/audio route and a selected capture window. A short capture is sufficient for this candidate; an unattended collection of many videos would not resolve the listening gate.

## Capture record — fill unknowns explicitly

Copy these fields into a record for each source. Use `unknown` for unavailable values, `not reviewed` for unchecked material and `not applicable` only with a reason.

| Field | Entry required |
| --- | --- |
| Source ID and provenance | Filename/URL, recorder/uploader, capture date, availability basis |
| Source identity | Original filename, SHA-256, file size; distinguish original and derivative |
| Game | Title, platform, region/build and stock/mod status, with basis for each |
| Passage | Song, difficulty, mode, passage start/end and condition intended |
| Settings | Calibration; band, playable-guitar and effects levels; default or diagnostic mix |
| Recording | Capture hardware/software; direct output or room microphone; hands/input visibility |
| Processing | Edits, commentary, replacement audio, normalization, gain control and clipping: known/unknown and basis |
| Media properties | Audio codec/sample rate/channels; video frame rate; duration/time base |
| Synchronization | How input, gameplay and audio were combined; measured offset/bounds or unknown |
| Comparison | Correct-reference source/trial, same settings, or unavailable |

Use the same source ID and file for listening and measurements. A hash identifies bytes, not authenticity. Timestamps can be recorded within each stream; cross-stream order and latency remain unresolved unless offset bounds support them.

## Listener sheet — normal speed first

Record listener ID, date, source ID/hash or URL, interval, playback app/device/headphones, volume, and whether the source is clearly audible. Also record whether the listener made the capture or already knows the suspected event; such reports remain useful but are not blind results. Record uncertainty without guessing. Use the full mix at normal speed first and a common playback gain across comparisons. Do not normalize clips independently.

First listen without watching the screen, then repeat with video. Keep those reports separate. Ask open questions before explaining the intended intervention:

1. Where, if anywhere, did something change? Give a recording timestamp or range.
2. Describe what changed in your own words. “No change heard,” “inaudible” and “not reviewed” are different answers.
3. When, if at all, did participation seem to return? What made you think so?
4. Could you keep following the beat? Could you identify the part under player control?
5. What remains unclear? Describe harshness, satisfaction or ownership only if actually experienced.

Save the listener's words before the investigator's interpretation. A single pilot listener verifies a route and supplies a case observation; it does not establish typical player responses. If a music-understanding system is later used, first verify its actual music-input capability blind on known removed-instrument, brief-error and unchanged-control clips as the plan requires; record its answers and failures.

## Linked event and evidence records

Create an event record only after reviewing a real passage:

```text
trial_id; source_id; passage_start_end; intended_condition;
target_time_bounds; observed_physical_input_and_bounds;
visible_judgment_and_bounds; next_accepted_action_and_bounds;
correct_reference_trial; alignment_method_and_drift;
usable_or_excluded_with_reason
```

Attach separate evidence entries, allowing conflicting results:

```text
claim_id; trial_id; label[heard|measured|documented|inferred];
listener_or_method; source_interval; observation_or_result;
units_and_uncertainty; confidence_with_reason;
alternative_explanation; supporting_or_contradicting_claim_ids
```

For **heard**, include audio-only/audiovisual mode, playback route and verbatim listener report. For **measured**, include file/hash, analysis window, method, noise floor and alignment uncertainty. For **documented**, identify title/platform and original/teaching/mod scope. For **inferred**, cite the supporting entries and alternatives. Input, judgment, audible change and restoration need separate time bounds. Never fill unheard fields from a waveform or a visible multiplier.

## Analyst intake after the file arrives

1. Preserve the source; compute SHA-256 and inspect streams with FFprobe. Verify duration, channels, sample rate and video timing. Record the exact commands and tool versions used.
2. Confirm the human hears this same source and completes the sheet. Check whether original soundtrack and processing can be established; exclude replacement soundtracks from reactive-audio evidence.
3. Confirm an actual error and subsequent accepted action in the footage. If input cause is obscured, retain “unknown cause” and obtain a better capture for condition-specific claims.
4. Make an analysis copy without independent gain normalization. Retain channels and native sample rate. Compare repeated correct passes when available before attributing signal differences to an intervention.
5. Align with apparently unchanged accompaniment, record drift and uncertainty, then inspect energy/spectrum around the event. Report unresolved separation if the mix cannot distinguish instrument attenuation from other changes. Sample precision does not resolve unknown input timing.
6. Fill the four gates in the findings report. Expand to matched omission, wrong-fret, empty-strum, sustain and difficulty trials only after the pilot passes.

**Verified local tools:** FFmpeg/FFprobe 8.1 on `PATH`; bundled Python 3.12.14 with NumPy 2.3.5. The default `python3` lacks NumPy. Resolve the bundled interpreter with Codex's workspace dependency tool; do not assume the default interpreter or install packages solely to reproduce this readiness check. No recording was analyzed during preparation of this handoff.
