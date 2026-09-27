# Developer and learning evidence for the MIDI-HERO north star

Research memo, 27 September 2026. Scope: developer intent, documented teaching logic, and a small empirical counterweight to claims about motivation and learning. No MIDI-HERO implementation was inspected. This memo does not claim audiovisual inspection of a retail game or of GDC recordings.

## Evidence ledger

### D1. Original Guitar Hero postmortem: performance first; practice was cut

**Primary source:** Greg LoPiccolo and Daniel Sussman, *Game Developer*, February 2006, printed pp. 24–29; [original issue](https://media.gdcvault.com/GD_Mag_Archives/GDM_February_2006.pdf), [readable reprint](https://www.gamedeveloper.com/audio/classic-postmortem-guitar-hero). Author attribution verified in original issue contents. Locations: opening, “Strong prototype,” “No guitars,” “We had to cut stuff,” “Got the time.”

The intended experience was musical performance accessible before instrumental proficiency. A minimal scrolling prototype with music and score already prompted internal score competition. The authors report that unreliable substitute controllers were unsuitable for difficulty tuning. They explicitly say GH1 cut a section-selecting, slowing practice mode; focus testing suggested players could begin without much instruction, but players subsequently requested practice. Star Power and whammy behavior took months of iteration.

**Strength:** direct account of intent and development decisions. **Limit:** retrospective, successful team speaking about its own game; internal enthusiasm and focus-testing recollections are not a causal persistence study. GH1 success therefore cannot be attributed to a shipped slowdown/section practice mode. **Inference:** test the musical action loop before investing heavily in spectacle; getting started and overcoming later bottlenecks are different problems.

### D2. Rob Kay interview: feedback, extra strategic depth, and authored difficulty

**Primary interview:** Iain Simons interviewing designer Rob Kay, [*Inside Game Design* excerpt](https://www.gamedeveloper.com/design/book-excerpt-inside-game-design-harmonix-music-systems), 5 December 2007. Locations: questions about prototype, two gameplay threads, gem-track creation.

Kay describes moment-to-moment beatmatching feedback as serving the feeling of guitar performance. Star Power supplied additional depth and replay interest, while tilt and whammy were performance gestures. Chart authors selected musically consequential notes; QA identified feel problems and difficulty spikes. A rule-based difficulty analyzer graphed tracks to support reauthoring and setlist ordering. The playable hardware and charts evolved together. The interview also emphasizes comprehensible performance context over abstract visuals.

**Strength:** direct designer explanation. **Limit:** reported intent and workflow do not establish which component caused retention; the difficulty algorithm is described, not published. **Inference:** arrangement authoring, physical playtesting, and progression ordering should form one iteration loop. A numeric density score cannot substitute for hands-on review of coordination and musical identity. On a keyboard, an optional strategic gesture must earn its place by improving play without competing with the hands needed for the arrangement.

### D3. Eran Egozy's MIT assignment: explicit feedback logic, with important scope limits

**Primary teaching specification:** [Assignment 7: Guitar Hero](https://ocw.mit.edu/courses/21m-385-interactive-music-systems-fall-2016/ad8c22178b0c4d54ee46bfcd85d98fb1_MIT21M_385F16_pset7.pdf), *Interactive Music Systems*, Fall 2016, document pp. 1–4. It explicitly uses keyboard presses instead of retail fret-plus-strum controls.

| Event | Specified judgment and reaction |
|---|---|
| Key down/up | Button appearance tracks input independently of judgment. |
| Hit | Matching lane within ±100 ms; hit effect, gem retired, solo unmuted, points. |
| Temporal miss | Input with no gem inside the window; miss sound. |
| Lane miss | Wrong lane while a gem is eligible; miss sound; that gem becomes unhittable. |
| Pass | Gem exceeds late boundary; changed appearance and solo muted. |

The Player component receives input and commands separate display/audio components. Background and solo audio are separate recordings. Chart guidance prioritizes musical contour and permits sparse easy charts.

**Scope warning:** ±100 ms is this assignment's value, not established retail timing. Miss-triggered muting is not explicitly specified; do not invent that branch. Multi-candidate matching, sustain, chord, HOPO, multiplier, and survival rules are absent. This is a developer-authored conceptual reconstruction, not shipping source code. Its useful lesson is separating acknowledgment, judgment, expired opportunities, and sound-state recovery.

### D4. GDC: primary talks located, recordings not inspected

[Game Design Considerations for Alternate Controllers](https://gdcvault.com/play/1013203/Game-Design-Considerations-for-Alternate), GDC 2006, Ryan Lesser and Greg LoPiccolo: listing describes a common methodology across Guitar Hero, Karaoke Revolution, and EyeToy: AntiGrav. [Is Jimi Hendrix a Good Level Designer?](https://gdcvault.com/play/780/Is-Jimi-Hendrix-a-Good), GDC 2007, Eric Brosius and Daniel Sussman: audio session listing verified. Neither recording was listened to in this memo.

A [contemporaneous GameSpot report](https://www.gamespot.com/articles/gdc-07-behind-the-music-of-guitar-hero-ii/1100-6167217/) is a useful route to talk passages about repeated musical forms, song types, and difficulty. It is secondary reporting and is **not used here to certify technical rules or as evidence that the talk was inspected**. Obtain and listen to the original recording before treating the reported specifics as verified primary evidence.

### L1. Motivation: competence is a plausible mechanism, not a Guitar Hero causal result

**Original research:** Ryan, Rigby, and Przybylski (2006), [The Motivational Pull of Video Games: A Self-Determination Theory Approach](https://selfdeterminationtheory.org/SDT/documents/2006_RyanRigbyPrzybylski_MandE.pdf). Locations: Study 1 methods/results and Table 3; Study 2 discussion. Full paper read selectively around these sections.

Four studies connect perceived competence and autonomy with game enjoyment and future-play motivation. Study 1 used 89 participants; 83 contributed free-choice continued-play data. Perceived competence predicted this behavioral continuation measure. Clear controls were associated with needs satisfaction; comparison of adventure games suggests clear controls alone do not ensure enjoyment. Some participants chose not to continue, and their experience differed from continuers.

**Limit:** these games were not Guitar Hero; mediator associations do not identify which feedback mechanic causes motivation. **Design hypothesis:** a recoverable error and a visibly improved phrase can support credible competence. Test voluntary re-engagement and perceived control rather than treating score, fireworks, or assigned play time as proof of motivation. Offer meaningful song/challenge choices without presuming that an unbounded menu itself creates autonomy.

### L2. Music-game transfer is selective; small instruction can matter

**Original research, abstract/highlights inspected:** Ali Sakkal and Lee Martin (2019), [Learning to rock: The role of prior experience and explicit instruction on learning and transfer in a music videogame](https://www.sciencedirect.com/science/article/pii/S0360131518302781), *Computers & Education* 128, pp. 389–397, DOI 10.1016/j.compedu.2018.10.007. Full publisher page direct fetch failed; indexed abstract and highlights were readable. Do not imply a full methods audit.

Thirty-four undergraduates with low-to-moderate Rock Band experience were randomized to game drill or teacher-led drumming instruction. Both conditions performed similarly in-game. The lesson group did better when commenting on drumming technique, and on GarageBand transfer after controlling for game skill. Prior game experience predicted GarageBand performance, but not all transfer tasks.

**Limit:** Rock Band drums, not keyboard or plastic-guitar transfer; small sample and prior-experience association. **Inference:** an in-game improvement measure can miss a meaningful learning difference. Test a brief musical explanation attached to a bottleneck, then assess both continued enjoyment and a task beyond the practiced chart.

### L3. Direct Guitar Hero counterevidence: do not assume repeated matching teaches meter

**Original short paper:** Matthew Gaydos (2010), [Rhythm Games and Learning](https://repository.isls.org/handle/1/2902), ICLS 2010 Volume 2, pp. 451–452. Publisher repository abstract verified; [full-text PDF](https://repository.isls.org/bitstream/1/2902/1/451-452.pdf) direct fetch returned 403, so this memo relies on the abstract rather than claiming full methodological review.

The study analyzed eight GHII songs and used a listening/tapping task with six participants. It did not find the expected underlying metrical knowledge among players.

**Limit:** extremely small preliminary sample; absence of evidence here cannot establish that GH never develops rhythm skills. **Use:** a warning against assuming mastery of visual targets demonstrates a particular musical representation. MIDI-HERO should separately test reproduction, continuation without visual cues, and unfamiliar patterns, while preserving the game's entertainment goal.

### L4. Why “audio beats visuals for learning” is too simple

**Original research:** Ronsse et al. (2011), [Motor Learning with Augmented Feedback: Modality-Dependent Behavioral and Neural Consequences](https://pubmed.ncbi.nlm.nih.gov/21030486/), *Cerebral Cortex* 21, pp. 1283–1294. Abstract inspected; [paper copy](https://www.dima.univr.it/documenti/OccorrenzaIns/matdid/matdid861963.pdf) located.

Two groups learned a bimanual coordination task using visual coordination feedback or auditory timing feedback. At practice end, the visual group depended more on feedback; the auditory group performed similarly with and without it.

**Limit:** modality and informational structure differ together; this was not keyboard playing. **Inference:** test behavior when an assist disappears instead of judging learning only while it is present. This result alone cannot justify removing the highway or claiming music audio automatically ensures transfer.

**Critical follow-up, original research:** Chiou and Chang (2016), [Bimanual Coordination Learning with Different Augmented Feedback Modalities and Information Types](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0149221), *PLOS ONE* 11(2), e0149221. Locations: participants, tasks/groups, no-feedback transfer, discussion.

Continuous spatial feedback was compared with discrete visual-rhythm and auditory-rhythm feedback. Both rhythmic groups sustained performance better after removal than the continuous spatial group, suggesting information structure matters beyond modality. Twenty-two participants were analyzed; six additional recruits, all from rhythmic groups, were excluded for failing the practice proficiency criterion.

**Limit:** the exclusions materially constrain generalization, particularly to struggling novices. **Inference:** compare useful timing information carried by different channels; count nonlearners and dropouts rather than analyzing only players who reach proficiency.

### L5. Feedback frequency depends on its content and the measured outcome

**Original research:** [Frequent external focus feedback enhances motor learning](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2010.00190/full) (2010). Locations: Methods; Movement Form—Retention/Transfer; Throwing Accuracy. Full text inspected around these sections.

Forty-eight children aged 10–12 practiced soccer throw-ins, receiving external- or internal-focus feedback after every trial or every third trial. Every-trial external-focus feedback improved movement-form transfer relative to the other groups. Retention group effects and throwing-accuracy group effects were not significant.

**Limit:** small groups, quasi-random assignment, nonmusical task; feedback was verbal and between trials, not a continuous hit flash. **Inference:** neither “always reduce feedback” nor “more feedback always improves learning” follows. In MIDI-HERO, compare a phrase-level musical cue such as “keep the two notes evenly spaced” with raw error counts. Measure the specific intended improvement and delayed retention; do not generalize one outcome to all aspects of skill.

## Synthesis for the parent report: design hypotheses to test

The following are proposed deductions, not observed retail rules or experimentally established MIDI-HERO outcomes.

1. **The musical result should make a correct action worth performing.** A meaningful keyboard part can give a sparse beginner arrangement purpose. Decide what the player audibly owns before deciding how many notes to remove. Compare whether players can identify their contribution when accompaniment continues.
2. **Make acknowledgment diagnostically separate from praise.** If the key display responds but the note is not accepted, the player should not conclude the controller failed. Success effects must mean accepted performance. A useful test asks the player what happened after an error, then compares that account with logged input/judgment.
3. **Recovery is part of the feedback contract.** The next accepted action should visibly restore participation; players should understand whether they recovered even if their prior streak is gone. Compare time to resume coherent playing after an error, not just the number of mistakes.
4. **Do not make one signal do every job.** Fast effects can acknowledge acceptance while a phrase summary explains a repeated timing or pitch issue. Showing a correction that requires reading during a dense passage can compete with the next action. Experiment with summary timing and ask whether the next attempt changes appropriately.
5. **Preserve the keyboard's useful truth.** A keyboard's played pitch is meaningful task information. Gating a recorded expert part can create immediate performance satisfaction but can also obscure the player's actual timing, duration, pitch, and dynamic control. Compare actual-pitch sound, explicit assistance, and chart-gated sound while keeping charts and judgment constant. Treat transparency and agency as measurable experiences.
6. **Practice should serve an immediate musical objective.** A short loop should be recognizably the phrase the player wants to perform, with a clear route back to the song. Count voluntary return to the song and improvement under unchanged conditions; lower speed alone is not progress at original speed.
7. **A next level should reveal more of the song without invalidating prior work.** Preserve anchors and phrase roles while adding one salient new demand. Test easy-to-harder transfer directly. Two octaves can support increased rhythmic, chordal, articulatory, and coordination demands before range expands.
8. **Measure fun and durable capability independently.** Voluntary retries and return sessions indicate desire; same-chart success indicates local mastery; delayed unassisted reproduction and unfamiliar phrases examine narrower forms of transfer. None substitutes for the others.

## Unresolved questions and source discipline

- No paper in this memo isolates Guitar Hero's particular hit effects, muting, streak resets, or Star Power as causes of persistence.
- No primary retail source code was inspected here; use the separate code investigation to resolve engine-specific branches.
- GDC audio still needs listening. An accessible session listing and a press summary do not fulfill that step.
- Learning studies support test design and caution, not a prescribed keyboard curriculum or numerical feedback threshold.
- Avoid presenting ±100 ms, GH1 practice mode, or generic auditory superiority as settled retail/design facts.
- Source summaries above are intentionally short. When incorporating them into another artifact, avoid duplicating long paraphrases from the same source across the report and appendices; keep cumulative source-derived wording within tool-provided limits. Each source here had a 200-word allowance, except the unused Ars interview (100) and Vice lead (25).
