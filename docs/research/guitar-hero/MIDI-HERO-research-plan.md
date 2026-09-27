# Guitar Hero → MIDI-HERO: research and north-star report plan

Prepared September 27, 2026. Planning document; proposed mechanisms and MIDI-HERO design choices below are research questions, not completed findings. No application changes are part of this phase.

**Audio investigation:** The dedicated [audio assessment plan](audio-assessment-plan.md) expands the audiovisual work below into controlled comparisons, listening and measurement protocols, and keyboard-specific experiments. Direct auditory verification remains outstanding.

**Purpose.** Work backwards from Guitar Hero to design a fun game that gets people playing songs on a real keyboard. Explain how its gameplay made players willing to attempt, fail, practice, improve, and return, then derive principles for MIDI-HERO. Give the logic of feedback to player input the deepest treatment. Fun gameplay is the driver of musical participation and practice, with game mastery and musical progress evaluated separately.

**Confirmed design brief.** Start with deliberately arranged songs of reduced complexity, playable within two octaves. Support expansion beyond that starting range and complexity as players progress. Research and analysis must be independent of the current MIDI-HERO build: its architecture, features, existing proposals, imported-MIDI workflow, and classroom assumptions do not define the solution. Do not use the current build to choose search topics, rank findings, or constrain recommendations.

**Central question:** What must a player perceive after an action so that they understand its consequence, trust the game, feel that improvement is possible, and want another attempt?

**Provisional north star to test:** Make playing a simplified song on a keyboard so satisfying that players want another attempt—and let each new challenge expand what they can actually play.

**Research foundation: inspect Guitar Hero itself before explaining it.** The work begins with direct audiovisual observation, original technical material, and code investigation. General learning theory follows this reconstruction. A bibliography alone does not fulfill this phase. Produce a timestamped observation notebook, a code/source trace, and an explicit list of unverified behavior before deriving the MIDI-HERO principles below.

**A. Build and inspect an audiovisual evidence set.**

- Start with approximately 12–18 recordings spanning GH I, II, and III; expand for missing event coverage rather than for volume. Include beginner or imperfect play, expert performance, failure/retry, tutorials, practice mode where available, and the same song on multiple difficulties. Perfect runs alone cannot reveal error and recovery logic.
- Seek footage with the controller and hands visible, or a documented input overlay, synchronized with the highway, HUD, and original game audio. Include clean direct captures for sound and visual detail. Record title, platform, version, difficulty, mode, modifiers, source URL, timestamps, and what input/audio channels are actually observable. Distinguish stock games from modified games, emulators, and recreations.
- Verify the video can actually be played and the relevant audio heard. Search snippets, captions, transcripts, and silent screenshots do not count as audiovisual inspection. If access or tool capabilities prevent listening, record the limitation and leave auditory findings unverified until another suitable source can be inspected.
- Watch representative passages at normal speed first to assess the complete experience; then inspect selected events frame by frame and listen repeatedly where useful. Compare the same musical passage in successful and unsuccessful attempts when available. An external soundtrack laid over gameplay makes a video unsuitable for evaluating reactive audio.
- Annotate successful strums, fret presses without strums, wrong frets, empty strums, omitted notes, early/late attempts, incomplete chords, sustain releases, hammer-ons/pull-offs, streak transitions, Star Power, low health, recovery, and failure. Capture at least two independently sourced examples for central behavior where possible; gaps remain explicit.
- Create event records with source timestamp, visible input, note position, immediate visual reaction, audible change, score/meter change, recovery trigger, interpretation, and confidence. Separate visible evidence from inferred input, especially where the hand camera hides the strum bar or fret state.
- Do not infer millisecond hit windows or engine latency from an ordinary uploaded video. Hand cameras, overlays, game captures, encoding, and audio may have different offsets. Timing measurement requires a characterized recording or direct technical evidence; otherwise report event ordering and bounded estimates only.

**B. Inspect legitimate technical sources and available code.**

- Start with original manuals, tutorials, developer-authored postmortems, talks, papers, and teaching materials. Follow specific claims to their original author and relevant page or passage. Record whether a statement describes a shipping title, an early prototype, or a simplified demonstration.
- Investigate publicly available Guitar Hero reverse-engineering, recompilation, and modding projects. Establish provenance, target binary/version, completeness, and whether relevant logic is reconstructed, generated, modified, or independently implemented. A project name or README is not proof that usable original gameplay logic is available.
- Inspect third-party scoring models and their tests for version-specific rules. Use open recreations to understand explicit implementation choices and possible experiments, labeling them as recreations. Neither a clone nor a scoring optimizer proves the original game's complete behavior.
- Trace concrete functions, constants, state transitions, and tests. Pin repository commit IDs and cite file/function/line references in the report. Track the path from controller state through matching and judgment to score, audio commands, and rendering events wherever accessible. Document missing links rather than filling them with plausible pseudocode.
- Use small, isolated calculations or code probes to check disputed rules when available source supports them. Any reconstructed pseudocode in the report must indicate which branches are source-backed and which are hypotheses. Reading code is sufficient unless execution resolves a specific open question; running the original game depends on a legitimately available copy and suitable environment.

**C. Reconstruct these systems explicitly.**

| System | Investigation targets | Required output |
| --- | --- | --- |
| Input and matching | Fret state versus strum events; event ordering; chord matching; held lower frets; hammer-on/pull-off eligibility and reset; extra inputs; closest/next-note matching | Version-specific state diagram and edge-case table |
| Timing | Song clock; chart timestamps; acceptance windows; calibration; buffering or grace periods; practice-speed behavior | Timing model with sourced values and unknowns |
| Audio | Backing versus playable stems; whether successful input gates recorded audio or triggers sound; miss versus omission; mute/unmute or fade; recovery; sustain/whammy; crowd and failure sounds | Annotated audio event timeline and mix-state model |
| Graphics | Raw input illumination versus judged-hit effects; note removal/miss state; sustain tails; hit-line effects; beat lines; highway perspective; HUD transitions and prioritization | Annotated frame sequences and visual state table |
| Scoring and stakes | Base note/chord value; sustain accumulation; streak/multiplier boundaries; reset order; Star Power acquisition/drain/activation; rock meter; star thresholds | Worked score traces and performance-state transitions |
| Charts and progression | Actual easy-to-expert chart differences; recurring motifs; reduced notes and controls; retained musical accents; practice sections and restart behavior | Matched passage comparisons across difficulties |

For audio, specifically test the distinction between hearing the played input and controlling the audibility of an already-recorded performance. For scoring, calculate a short sequence containing hits, a sustain, an error, and recovery, then compare the calculation to the visible score where possible. For graphics, identify which effects merely acknowledge input and which certify a judged success.

**D. Reconcile observation, documentation, and code.**

For each major behavior, connect a timestamped gameplay example with a manual/developer description or code/model reference where available. Resolve disagreements by checking title, platform, mode, modification, source completeness, and recording quality. Observed behavior establishes what happened in that case; code can explain a mechanism; a developer account can explain intent. None alone establishes why a player will persist or learn. Label a mechanism as confirmed, supported, inferred, or unresolved, and explain the basis.

**Completion criterion for this foundation:** the report must contain actual inspected gameplay events, readable technical traces where available, and a coverage table for the six systems above. If direct audio/video access or original implementation details remain unavailable, report that gap prominently; do not silently replace game inspection with generic psychology or clone behavior.

1. **Establish the evidence and historical scope.**

   Use Guitar Hero I, II, and III as the core comparison, identifying version and mode for every mechanical claim. Bring in Rock Band and instrument-learning games selectively to investigate particular design alternatives. Do not collapse different engines, practice tools, judging rules, and progression systems into a fictional composite Guitar Hero.

   Separate five kinds of evidence: documented behavior; developers’ stated intentions; empirical learning or motivation findings; player accounts; and our design inferences. Manuals, original developer talks/interviews, postmortems, and inspectable gameplay are the main sources for mechanics. Player anecdotes help identify experiences and failure cases but do not establish prevalence or causation. Research on other motor tasks provides possible mechanisms, with explicit limits on transfer to music games.

   Start by questioning the premise as well as explaining it: who persisted, who stopped, and how much success might reflect music selection, novelty, social context, or existing interest? Sales and enthusiastic retrospective accounts do not establish that a particular feedback system caused learning.

   Deliverable: a version-specific mechanics inventory and an evidence ledger with claim, source/location, evidence type, counterevidence, confidence, and design implication. Unsupported engine details remain unknown.

2. **Reconstruct the entire action-to-feedback loop.**

   Trace anticipation → physical action → input registration → matching and judgment → audible/visual response → score and performance state → player interpretation → next action. Include actions the player omits: a missed target has no triggering keypress. Include the chart and backing music as advance information that teaches the player what to expect.

   Keep three questions separate throughout: Did my input register? Was it accepted as correct? What can I change? Determine which signals answer each question and where players can confuse them.

   Analyze distinct time scales: immediate input acknowledgment; note-level success/error; recovery over the next few notes; phrase-level competence; song-level results; and improvement across sessions. Distinguish a signal’s onset, duration, intensity, location, and recovery behavior. Do not assign universal latency thresholds without appropriate evidence or measurement.

   Deliverable: an annotated causal diagram and event timelines showing what the player does, hears, sees, loses or gains, and can infer at each step. Where direct testing is unavailable, mark behavior as source-described rather than observed.

3. **Study feedback as a conditional system, not a collection of effects.**

   Build a response matrix covering: correct action; accepted early/late action; action outside the timing window; wrong control/pitch; no action; extra or repeated action; incomplete chord; early release; sustained input; streak break; recovery; phrase completion; and failure or restart. Record Guitar Hero behavior separately from proposed MIDI-HERO behavior.

   For each event ask:

   - What did the system know, and when could it know it? An input can be acknowledged immediately, while a missing note cannot be finalized before its acceptance window closes.
   - What sounds: the performed part, silence, an error sound, the backing band, or a combination? How does the mix change and recover?
   - What changes visually, and is it readable while the player watches upcoming notes?
   - Which states change: score, streak, multiplier, resource meter, survival, or unlock progress?
   - What should the player learn, and what misleading interpretation is possible?
   - Does one mistake produce several consequences, and do those consequences clarify the error or overwhelm the player?
   - Does the response encourage recovery, reckless input, excessive caution, or immediate restarting?

   Examine interactions: a miss followed by a late correction; the first hit after a miss; losing a long streak; several errors in a dense passage; a successful phrase after repeated failure. Consider a player’s belief about the rules, not just the internal rules themselves.

   Deliverable: a feedback specification template containing event, prerequisites, judgment, audio, visual acknowledgment, state changes, recovery condition, intended inference, and failure risks.

4. **Investigate why the feedback could motivate practice.**

   Test explanations involving perceived musical agency, competence, clear cause and effect, manageable challenge, embodied performance, anticipation, and social recognition. Treat labels such as “flow” or “reward” as hypotheses requiring a concrete explanation of behavior.

   Key tensions: binary success versus graded accuracy; readable feedback versus precision; forgiving judgment versus credible standards; a valuable streak versus anxiety about losing it; consequential failure versus interruption of learning; dramatic spectacle versus attention to the next note.

   Ask what makes a mistake feel specific, fair, and recoverable. Distinguish feedback about results from information about how to improve. Investigate when continuous assistance supports learning and when it creates dependence. Separate performance while assistance is present from retention or transfer after it is removed.

   Deliverable: a causal account of each proposed mechanism, with plausible competing explanations and conditions under which it may fail.

5. **Connect moment-to-moment feedback to the wider game design.**

   Analyze chart authoring as curriculum: recurring motifs, density, timing complexity, control range, coordination, transitions, endurance, and difficulty jumps. Examine how simpler charts preserve musical identity and whether skills learned at one level prepare players for the next.

   Treat two-octave song arrangement as a central design discipline. Investigate how to preserve a song's recognizable hook, rhythmic character, phrase shape, harmonic role, and satisfying moments while simplifying the player's part. Consider melody, bass, riff, and chord roles, and how accompaniment makes a sparse but meaningful part feel like participation in the whole song. Ask which musical events the player must own for success to feel earned.

   Investigate transposition, register changes at phrase boundaries, chord voicing, rhythmic reduction, hand position, fingering, and redistribution between player and accompaniment. Compare authored arrangements with rule-based simplification on musical coherence and playability; do not assume octave folding or note deletion produces a good beginner arrangement.

   Design candidate progression paths that vary range and complexity independently. A song can become richer inside two octaves before requiring more keys. Explore when to introduce additional pitches, rhythmic detail, chords, a second hand, hand movement, articulation, and wider range; identify which steps preserve earlier learning and which require relearning. Treat the exact sequence as a research question. Keep meaningful progression available to players who remain on a two-octave keyboard.

   Cover song desire and familiarity, difficulty selection, setlist sequencing, unlocks, stars, personal bests, strategic resources, practice sections, slowdown, retry friction, and social play. Determine how each system gives feedback a purpose: why should the player care about this phrase, this run, or this next difficulty?

   Follow the entire practice cycle: choose a meaningful goal → attempt → identify a bottleneck → practice it → return to the song → recognize improvement → choose another challenge. Identify where the game teaches this cycle and where it merely assumes players already know how to practice.

   Deliverable: a progression map and arrangement rubric, supported by a worked song example across several candidate difficulty levels. Use original or public-domain material for the example; label proposed arrangements as design illustrations, not validated learning sequences. Show the player's part, accompaniment role, preserved musical identity, new demand, and reason to replay at each level.

6. **Derive the keyboard game from Guitar Hero and the confirmed brief.**

   Begin with the experience and causal mechanisms established by the Guitar Hero research, then ask what realizes those mechanisms on a keyboard with deliberately simplified two-octave arrangements. Develop recommendations without a feature-gap audit of the existing application. Architecture and migration planning belong to a later implementation phase.

   Address the differences between a symbolic guitar controller and an actual keyboard. A keyboard has meaningful pitches, many possible simultaneous inputs, velocity, note releases, pedal behavior, and potentially its own audible output. Hearing only the intended chart note may conceal what was played; hearing the actual note may provide useful information but weaken the arranged performance illusion. Compare these options rather than assuming one is universally correct.

   Study pitch versus timing feedback, partial chords, accidental extra keys, repeated pitches, note duration, articulation, and sustain behavior. Determine which dimensions to judge at each difficulty and how to communicate any assistance so players understand what they accomplished. Examine calibration and device failures so technical problems do not masquerade as player failure. Evaluate optional game controls against their interference with actual keyboard playing.

   Analyze how arrangement and feedback interact: does a sparse beginner part still create audible agency; can a missed note be recognized within a dense accompaniment; does recovery restore the feeling of musical participation; and does a harder arrangement make the additional control audible and rewarding? Any performance illusion should be evaluated against the goal of actually playing the arranged part.

   Deliverable: a transfer matrix with “adopt,” “adapt,” “avoid,” or “test,” reasons, audience/context, confidence, and implementation-independent acceptance criteria.

7. **Validate the recommendations with observable outcomes.**

   Propose focused comparisons: binary versus graded judgments; actual-pitch sound versus chart-gated sound; abrupt versus gradual streak loss; whole-song retry versus targeted section practice; and alternative recovery signals. Change one meaningful variable at a time or explicitly account for interactions. Keep chart, tempo, input setup, and sound level comparable; counterbalance order to reduce familiarity effects.

   Evaluate novice keyboard players separately from experienced musicians and experienced rhythm-game players. Include both successful learners and people who disengage. Use short retrospective questions or replay review when talking during play would distort performance.

   Observe whether players can explain an error, whether their next attempt changes appropriately, how quickly they recover, voluntary retries, chosen challenge, perceived fairness, and improvement on the same passage. Distinguish enthusiastic repetition from productive repetition.

   Measure retention on a later attempt and transfer to an unfamiliar passage or reduced visual assistance. Test movement between arrangement levels: whether the easier version prepares the player for the next and whether expanding range introduces unnecessary discontinuity. Compare under the same scoring conditions; easier charts or wider windows must not be mistaken for skill growth. Participation required by a study or teacher must not be mistaken for voluntary motivation.

   Deliverable: a practical playtest protocol and measurement plan. Recruitment, actual study execution, and definitive causal claims are separate from this desk-research report; record any resulting evidence gaps.

8. **Synthesize a report that can guide development decisions.**

   Produce a concise north-star brief backed by a detailed research report and appendices. Allocate approximately half the analytical depth to input interpretation, feedback, and recovery; the remainder covers progression, practice, musical motivation, social context, and transfer to MIDI-HERO.

   The report should contain: the player experience MIDI-HERO should create; the evidence-based explanation of Guitar Hero’s appeal; the feedback model and response matrix; two-octave arrangement principles and worked examples; progression within and beyond that range; practice design; transfer recommendations; and prioritized experiments.

   Every recommendation must state the player problem, supporting evidence and confidence, causal rationale, relevant tradeoff, suggested behavior, and observable success criterion. Include “when not to use this” so principles can resolve conflicts instead of becoming slogans.

   Finish with a compact decision rubric: Does the player recognize their action? Understand the outcome? Know a useful next adjustment? Retain musical agency? Recover after mistakes? Notice improvement? Want another attempt? Is any claimed learning retained beyond this chart and its assists?

   Prioritize by expected value to player comprehension and productive practice, strength of evidence, and MIDI-HERO constraints. The report should distinguish firm principles from prototype candidates and unresolved questions. Numerical thresholds remain provisional unless justified.

**Execution order:** acquire and inspect original gameplay with audio and input visibility; inspect original technical material and relevant public code; reconstruct and cross-check the game systems; explain possible motivational mechanisms and counterexamples; connect progression and practice; translate to MIDI-HERO; produce recommendations and validation plans. Evidence collection and technical reconstruction precede recommendations. The final quality check is traceability: every consequential claim and recommendation must lead back to evidence or be visibly labeled as a hypothesis.

**Concrete technical and gameplay starting points (discovery status, September 27, 2026):**

- [MIT Guitar Hero assignment, pages 1–4](https://ocw.mit.edu/courses/21m-385-interactive-music-systems-fall-2016/ad8c22178b0c4d54ee46bfcd85d98fb1_MIT21M_385F16_pset7.pdf), from [Eran Egozy's Interactive Music Systems course](https://ocw.mit.edu/courses/21m-385-interactive-music-systems-fall-2016/): inspected the written specification. It gives input outcomes, visual reactions, solo-track muting, error sounds, chart-authoring guidance, and responsibilities for player, display, and audio logic. This is a simplified teaching implementation; its numeric window and rules are not established as the shipped games' exact rules.
- [Guitar Hero II manual](https://www.videogamemanual.com/PS2/Guitar%20Hero%20II%20%28Dual%20Pack%29%20%28USA%29.pdf): original manual hosted by an archive; PDF located and opened, detailed page inspection pending. Use for official descriptions of controls, scoring, training, and sound settings.
- [GDC 2006: Game Design Considerations for Alternate Controllers](https://gdcvault.com/play/1013203/Game-Design-Considerations-for-Alternate): session listing located; recording inspection pending. Investigate the Harmonix controller-design methodology and its connection to playable actions.
- [re-gh2](https://github.com/YoshiCrystal9/re-gh2): README inspected; identifies an Xbox 360 Guitar Hero II recompilation proof of concept with stability limitations. Investigate actual available code and useful logic coverage; do not represent this as a complete, readable release of original source code.
- [CHOpt](https://github.com/GenericMadScientist/CHOpt): README inspected; exposes separate GH1, GH2, and GH3 engine choices. Inspect engine-specific models and tests for scoring and Star Power, and compare their assumptions to gameplay. This is third-party modeling, not the original game engine.
- [Addy Mills's reverse-engineering articles](https://www.addymills.com/): author site located; individual technical articles need inspection. Candidate material on Guitar Hero animation and song data.
- [YARG.Core](https://github.com/YARC-Official/YARG.Core): repository located, with engine, parsing, and replay code identified by its description. Use only as a labeled implementation comparison after original-game analysis; individual functions have not yet been audited.
- [Guitar Hero II “Jordan” with hands, indexed video](https://gtdb.org/daaease/videos/l7HNCM7x3qs): hand-visible footage candidate located by metadata. Direct video access was not established in the initial web fetch. Neither its synchronization nor audio content has been verified.
- [IGN Guitar Hero III PS3 gameplay](https://www.youtube.com/watch?v=UHaQSiHoNL8): original-title gameplay candidate located by metadata. Input visibility, reactive audio, and suitability for event analysis remain to be checked. Additional novice/error/recovery footage is required.

**Initial source leads, not a completed literature review:**

- [Guitar Hero developer postmortem](https://www.gamedeveloper.com/audio/classic-postmortem-guitar-hero): original design aims, constraints, and the explicitly cut practice mode. This immediately establishes why version distinctions matter.
- [Ryan, Rigby, and Przybylski: The Motivational Pull of Video Games](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf): a framework for investigating competence, autonomy, and relatedness. Its findings are not proof of Guitar Hero-specific causation.
- [Mapping Sonification for Perception and Action in Motor Skill Learning](https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00463/full): a lead for investigating how auditory mappings carry task information and how feedback relates to learning.
- [Frequent External Focus Feedback Enhances Motor Learning](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2010.00190/full): a lead for examining feedback content and frequency without assuming less or more feedback is always better.
- [Harmonix calibration guidance](https://www.harmonixmusic.com/how-to-calibration/): a primary source for a related game's treatment of audio/video alignment. Do not substitute its behavior for Guitar Hero’s or generalize it into a complete MIDI calibration method.

**Scope correction:** The initial planning pass consulted repository documents. Following the user's clarification, those documents are excluded as the basis for research scope, design assumptions, and recommendations. The governing constraints are the confirmed brief above: fun gameplay, actual keyboard song playing, reduced complexity, an initial two-octave range, and subsequent expansion.
