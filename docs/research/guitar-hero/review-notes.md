# Independent source-accuracy review notes

27 September 2026. At the first review check, `technical-evidence.md` and `arrangements-evidence.md` did not yet exist. The following flags therefore apply to synthesis, not to identified errors in those documents.

## Completed technical review

Subsequently read `technical-evidence.md` and independently inspected the temporary CHOpt checkout's engine definitions, multiplier traversal, sustain calculation, and cited regression tests. Also visually read GH2 manual GHM11. The worked 450 → 650 → 850 → 850 → 900 example is arithmetically consistent with its stated assumptions. The miss/reset step is appropriately labeled reconstruction rather than CHOpt behavior. GH1's tenth-head versus following-tick distinction and the 138-point rounding example match the inspected code/tests. Provenance distinctions and audio unknowns are handled carefully.

Two small corrections requested from the technical agent: expand the ambiguous “Same” late-window cells to the full formula for every title; replace the visibly truncated GH3 manual URL. In particular, GH3's modeled late window is **not** its 0.116-second early window: it uses `min(0.100, next gap/2.0001)` seconds.

**Main-report limitation:** the root investigator reports visual video inspection but cannot hear the recordings through available tools. Therefore describe these as visual gameplay observations. Frame changes from 4× to an empty multiplier area and subsequently 2× can support a visual loss/rebuild sequence; they cannot establish the precise input error, error sound, stem mute duration, or first recovery audio. Do not claim the plan's audiovisual foundation is fully completed. This is a material gap, because reactive audio is central to the proposed explanation.

## Primary Rock Band 3 precedent worth incorporating

[CDM's 26 October 2010 interview with Daniel Sussman, John Drake, and Matt Nordhaus](https://cdm.link/rock-band-3-behind-the-scenes/) is especially close to MIDI-HERO's brief. Relevant sections: “Rock Band Network, Meet Pro Mode, Keys” and “Learning Music with Rock Band.”

Developers identify register, movement, and bass inclusion as arrangement decisions. They discuss keyboard legibility and input illumination, the added authoring burden of real pitches, and accompaniment that makes simple exercises feel musical. Consult the arrangement memo for the shared source summary.

**Evidence category:** direct developer design account, at launch. It documents concerns and intent; it does not establish long-term learning, retention, or why keyboard support later disappeared. Source-derived summary above deliberately brief; the source allowance is 200 words across summaries, so avoid expanding/repeating it throughout the report.

## Likely misreadings to prevent

- The interview's root-note → power-chord → full-chord sequence follows discussion of **Pro guitar**. Do not present it as a verified keyboard curriculum.
- Two-octave **physical input range**, compressed arrangement range, and approximately one-octave **display window** are different. A developer's informal “octave and a half” should not silently become an exact numeric interface rule.
- “Pitch accurate” does not necessarily mean original register, every original note, two original hands, or an unaltered recording. Clarify the arrangement's claim.
- Do not label these design tensions as proven commercial failure causes. There is no keyboard-specific retention or discontinuation causal analysis in the inspected source.
- Success with Pro keys does not by itself prove score reading, independently remembering a piece, general keyboard technique, or complete piano proficiency.
- Developer playtest anecdotes and teacher opinions about increased enrollment are not randomized evidence of transfer or causal recruitment effects.

## Required checks for the technical synthesis

- Every constant must name the game/platform/version or model. MIT ±100 ms is a teaching specification. A third-party optimizer is not original engine source, even when its test suite is thorough.
- A version-specific hit window in a model can describe the model's usable scoring abstraction, not necessarily controller scanning, queueing, display timing, or every retail acceptance case.
- Distinguish base note value, chord contribution, sustain ticks, score multiplier, Star Power multiplier, and state-change order. A worked example needs explicit assumptions and exact boundary behavior.
- Distinguish a wrong/extra input from an omitted target and an early sustain release. A shared “miss” label must not obscure different side effects.
- Input illumination acknowledges physical state; hit effects certify judgment. Do not claim either answers exactly how to improve.
- Silence, stem gating, error effects, and played-pitch synthesis are different audio mechanisms. Keep observed retail behavior separate from teaching/recreation choices.
- Ordinary uploaded video does not establish millisecond hit windows or latency. Capture offsets and reaction timing are separate unknowns.

## Required checks for arrangement/learning synthesis

- Label the worked song progression as a design illustration, not a validated curriculum.
- Distinguish reduced note density from reduced coordination, fingering, interval, reading, or range demand. A sparse passage can still be physically difficult.
- Preserve easy-level anchors deliberately, but do not assert that anchor preservation guarantees transfer without testing.
- Exact two-octave coverage needs a convention: two octave spans including both endpoints normally means 25 chromatic keys. State the concrete low/high endpoints used in the worked example.
- Record what accompaniment supplies at each level, and what the player's real notes contribute. Otherwise richer automatic backing may be mistaken for increased ability.
- Judge voluntary replay, local performance gain, delayed retention, and unassisted/unfamiliar transfer separately. Winning on an easier chart or wider window is not improvement under the original conditions.
- Include people who struggle or quit. The inspected coordination follow-up excluded six nonlearners; reproducing that exclusion in product evaluation would conceal a central design failure.

## Main draft and completed arrangement review

Read `MIDI-HERO-NORTH-STAR.md` and `arrangements-evidence.md` after they were saved. No material factual error or unearned causal conclusion found in the reviewed main draft. Its incomplete audiovisual disclosure is prominent. It distinguishes proposed feedback behavior from original mechanics and does not use the existing build as its baseline.

Independently viewed all four saved measure-19 crops: the current lane transcription and attack counts (3, 5, 6, 6) match. Hard's last attack is R+Y; Expert's is R+B. Boundary notes at the following measure must remain excluded. The original four-bar example's durations sum correctly; A's retained pitches and onsets persist in B/C. The main report correctly distinguishes the 25-key C3–C5 hardware span from the example's smaller occupied range. D's left-hand position movement is appropriately flagged as potentially needing intermediate levels.

Small final checks requested from the root investigator:

1. Clarify the opening overview's “practice” as GH2/3 section practice, with GH1's cut feature excluded; the later caveat is correct but distant.
2. Match section 4's list of visually observed elements to the actual per-title notebook before finalizing it. A montage-level generalization must not imply each source showed every event.
3. Consolidate duplicate source summaries across the main report and memos, particularly the MIT specification and Rob Kay interview, to respect each source's word allowance. The extra RB3 summary here has been shortened.
