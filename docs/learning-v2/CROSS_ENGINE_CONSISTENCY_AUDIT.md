# Cross-Engine Consistency Audit — V2 Learning Architecture

> **Status:** SPECIFICATION REVIEW ONLY. This document changes **nothing** — no code, schema, API, runtime,
> test, or existing V2 spec. It audits the six committed V2 engine specs for cross-engine contradictions,
> duplicate truth, and incompatible semantics **before** implementation. Recommended amendments are described
> here; the owner will decide a single controlled reconciliation pass afterward.

## 1. Purpose

Answer the core question: *if we implemented the six specs exactly as written, would they produce one coherent
learning system with one source of truth per concept — or contradictory state, duplicate truth, or incompatible
semantics?* Expose issues first; do not force problems (§41 rule); "no contradiction" is a valid finding.

## 2. Audit scope

The seven docs under `docs/learning-v2/`: `LEARNING_SYSTEM_V2.md` (umbrella) + Placement, Roadmap, Teaching,
Skills, Mastery & Review, Content Quality. V1 code was consulted only to confirm reusable substrate
(`LearnerSkillState`/`SkillMeasurement`/merge, `LearnerLessonCompletion`, `LearnerSignal`, `LearnerRoadmap`,
`PublicationReadinessService`, `ContentSource`). References below use exact `Engine §N` anchors.

## 3. Executive verdict

**PASS WITH REQUIRED RECONCILIATIONS.** The architecture is **fundamentally coherent**: it rests on one evidence
substrate (append-only `SkillMeasurement`), one single-writer of the compact projection (`LearningProgressService`
/ `LearnerSkillState`), and cleanly separated engine responsibilities. The reconciliation rounds already fixed
the historically dangerous confusions (Blueprint≠LessonRevision, session-completed≠mastered, historical-evidence
≠current-competence, NOT_ASSESSED≠0, evidence-admissibility). **No CRITICAL contradiction remains.** What
remains is a focused set of **source-of-truth / write-authority designations** that the specs *lean* toward
correctly but do not yet state explicitly — these must be pinned **before schema design** so implementation does
not create two writers for one truth.

- **CRITICAL: 0 · MAJOR: 7 · MINOR: 5 · Implementation-blocking open questions (category A): 7.**

## 4. Canonical concept dictionary

Owner = system that owns the truth. F/P = immutable **F**act or recomputable **P**rojection. "V1?" = persisted
in V1 today. **⚠ = collision/ambiguity flagged below.**

| Concept | Canonical meaning | Owner | F/P | Producers → Consumers | V1? | Note |
|---|---|---|---|---|---|---|
| Subject | Top content container | Content authoring | F | Methodist → all | yes | ok |
| Domain | Subject-scoped competency area | Skills | F (authored) | Methodist → Placement/Roadmap/Mastery | **no** | NEW (Skills §4) |
| Skill | Stable pedagogical ability | Skills | F (authored) | Methodist → all | yes (flat) | EXTEND |
| Skill Family | Grouping of skills | Skills §7 | F | Methodist → UI/reporting | no | NEW |
| Skill-Level Expectation | What a level demands of a skill | Skills §8 | F (versioned) | Methodist → Mastery/Placement/Roadmap | no | NEW |
| Roadmap Point | Pedagogical learning unit (≠ Lesson) | Roadmap §5 | F (canonical) | Methodist → Teaching/Mastery | no | NEW |
| Teaching Blueprint / Revision | *How* a point is taught (orchestrates content) | Teaching §4 | F (versioned) | Methodist → Teaching runtime | no | NEW; **≠ LessonRevision** |
| Lesson / LessonRevision | V1 content revision (immutable) | Content authoring | F | Methodist → Teaching | yes | REUSE as *one* orchestrated revision |
| Activity + evidence mapping | Task + skill attribution (primary/supporting, evidence-vs-exposure) | Skills §22 / authoring | F | Methodist → Teaching/Mastery | partial (bare joins) | EXTEND |
| Learning outcome | Point's can-do target | Content §12 / Roadmap §5 | F | Methodist → CQ review | no | NEW |
| Mastery Requirement | Evidence policy to satisfy an expectation/point | **authored content** | F (versioned) | Methodist → Mastery evaluates → Roadmap consumes | no | **⚠ M6 home ambiguous** |
| SkillMeasurement / evidence fact | Append-only evidence unit | Skills/Mastery | **F** | Placement/Teaching/Review → merge | yes | immutable |
| Evidence kind | recognition/production/reading/… | Skills §11 | F (on measurement) | Teaching → Mastery | no | NEW metadata |
| Evidence coverage | how much evidence (V1 `confidenceBp`) | Skills §17 | P | merge → decisions | yes | **not certainty** |
| Evidence sufficiency | enough to decide (states) | Skills §18 | P | Skills → Placement/Mastery | no | NEW |
| Evidence diversity | kind spread | Skills §11 | P | Skills → Mastery | no | NEW |
| Independence | unaided vs scaffolded | Skills §14 | F (on measurement) | Teaching → Mastery | no | NEW |
| Decision confidence | strength of a *decision* | Skills §17.D | P | (future) | no | ≠ coverage |
| NOT_ASSESSED / INSUFFICIENT / SUFFICIENT | assessment states | Skills §18 | P | Skills → Placement/Roadmap/UI | no | **never 0** |
| Current competence projection | ability *now* | Mastery/Skills | **P** | merge → all | yes (`masteryScoreBp`) | recomputable |
| Historical acquisition fact | past legitimate LEARNED/VALIDATED event | Roadmap | **F** | Roadmap writes → audit | no | **⚠ M2 writer** |
| PlacementDecision | study-placement decision | Placement §15 | F (versioned) | Placement → Roadmap | no | NEW |
| Validation by assessment | evidence-satisfied-without-study | Placement emits / Roadmap records | F | Placement → Roadmap | no | **⚠ M1 two stores** |
| LearnerLessonCompletion | per-**lesson** studied fact (+XP/IZL/time) | Content/lesson-exec | F | lesson-exec → Roadmap | yes | per-lesson, **not** per-point |
| Point acquisition (LEARNED/VALIDATED) | durable per-**point** state | Roadmap §12 | F+P | Mastery evaluates → Roadmap writes | no | **⚠ M2 granularity** |
| REPAIR_REQUIRED | not-established/gap attention | signal→Roadmap Attention | P (derived) | Mastery/CQ → Roadmap view | no (signal yes) | **⚠ M3 two stores** |
| REVIEW_DUE | fading-recall attention | signal→Roadmap Attention | P (derived) | Mastery → Roadmap view | yes (`LearnerSignal`) | **⚠ M3 two stores** |
| Retention / freshness | recall currency | Mastery §21 | P | Mastery → review/UI | no | NEW |
| Misconception observation | one datum | Teaching §17 | F | Teaching → Mastery | no | NEW |
| Active misconception signal | accumulated, resolvable | Mastery §27 / LearnerSignal | P | Mastery → Roadmap/CQ | yes (`categoryCode`) | ok |
| LearnerSignal | actionable interpretation (one learner) | learner-signals | P | Mastery → Roadmap/DailyPlan | yes | **≠ state/evidence** |
| Review candidate | prioritized review target | Mastery §13 | P | Mastery → DailyPlan | no | NEW |
| Daily Plan candidate | today's options | Roadmap+Mastery → DailyPlan | P | → DailyPlan schedules | models exist | ok |
| Content availability | publish-ready teaching exists? | **Content Quality/publication** | F (source) | CQ → Roadmap `CONTENT_UNAVAILABLE` | partial | **⚠ M4 two stores** |
| Content quality issue | defect lifecycle record | Content Quality §41 | F+P | CQ → engines | no | NEW |
| Evidence admissibility | can historical evidence be relied on now? | Content Quality §35a | P (versioned decision) | CQ → Mastery/Skills/Placement/Roadmap recompute | no | **⚠ M7 representation** |
| Quality policy version | rule set a revision passed | Content Quality §48 | F | CQ → audit | no | NEW |
| Current domain projection | per-domain band + coverage | Skills §19 | P | Skills → Placement | no | not a naked score |
| Current study-level projection | learner's level *now* | **⚠ split 3 ways** | P | Placement/Roadmap/Skills | `displayLevel` (null) | **⚠ M5** |

**Terminology collisions flagged:** "level/current level" (M5); "validation" store (M1); "acquisition/completion"
granularity (M2); "REVIEW_DUE/REPAIR_REQUIRED" store (M3); "content availability" store (M4); "Mastery
Requirement" home (M6); "admissibility" representation (M7). "current competence projection" vs "demonstrated
mastery" vs "mastery estimate" — same thing, three labels (m2).

## 5. Engine authority matrix

| Engine | OWNS | READS | EMITS | MUST NOT OWN |
|---|---|---|---|---|
| **Placement** | entry study-level **decision**, threshold policy, level-up offer, `PlacementDecision` | Skills projections, evidence | `PlacementDecision` (validatedAreas, weak, start, domain scores) | roadmap projection; per-skill state; mastery formula; content |
| **Roadmap** | canonical point graph, learner **projection**, point **acquisition** state, repair/prereq placement, level-progression state | `PlacementDecision`, Mastery evaluations, publication status, signals | roadmap projection, DailyPlan candidates | placement decision; mastery formula; teaching flow; review timing |
| **Teaching** | Teaching Blueprint runtime, session, remediation branches | point+blueprint, skill maps, expectations, taxonomy | evidence (kind/independence/misconception), session-completed fact | global mastery; point acquisition; scheduling; content authority |
| **Skills** | Subject→Domain→Skill model, Skill-Level Expectations, evidence taxonomy, projections | `SkillMeasurement` | domain/level projections, sufficiency, expectations | placement/roadmap/review decisions; content publication |
| **Mastery & Review** | current competence + retention projections, mastery-requirement **evaluation**, review candidates/priority, review sessions | `SkillMeasurement`, expectations, requirements, admissibility | current projection, requirement-satisfied results, review candidates | schedule; teaching flow; certification; **content edits**; direct roadmap writes |
| **Content Quality** | authoring/review/publish governance, quality issues, quality-policy version, **evidence-admissibility decision** | signals, publication status, evidence facts | quality outcomes, admissibility outcomes, availability | learner mastery/roadmap **rewrites**; placement; scheduling |
| Daily Plan (downstream) | today's schedule | roadmap + review candidates | scheduled plan | roadmap/review generation |
| Rewards/XP/IZL (downstream) | reward award policy | emitted facts | grants | learning state |
| AI runtime (cross-cut) | *nothing canonical* | approved content/taxonomy | drafts/classifications/personalized wording | any canonical truth |
| Content authoring (V1 substrate) | content revisions | — | published revisions | learner state |
| Media infra (V1 substrate) | asset storage/processing/moderation | — | asset status | pedagogy/evidence |

**Boundary check "does Teaching own mastery?"** → **NO** (Teaching §21/§23 emits evidence; Mastery §11/§34
evaluates; Roadmap §12 owns acquisition). Consistent across specs. **PASS.**

## 6. Write-authority matrix

One writer per truth. ✔ = specs agree; ⚠ = must be made explicit.

| State category | Sole writer | Specs | Status |
|---|---|---|---|
| canonical Subject/Domain/Skill/Family | Methodist (content authoring) | Skills §4/§5/§19 | ✔ |
| Skill-Level Expectation (versioned) | Methodist | Skills §8/§25 | ✔ |
| Roadmap canonical graph | Methodist | Roadmap §8 | ✔ |
| Learner roadmap projection | Roadmap engine | Roadmap §8/§16/§17 | ✔ |
| Teaching Blueprint / revision | Methodist (CQ-gated) | Teaching §4; CQ §33 | ✔ |
| Teaching session + response | Teaching runtime (append-only response) | Teaching §21/§22 | ✔ |
| `SkillMeasurement` | producers append; **never mutated** | Skills §15; Mastery §5 | ✔ |
| `LearnerSkillState`/current projection | **single-writer merge** (`LearningProgressService`) | Mastery §6; Skills §16 | ✔ |
| Mastery-requirement **evaluation** | Mastery engine | Mastery §11 | ✔ |
| Historical **point acquisition** event (LEARNED/VALIDATED) | Roadmap (on Mastery/Placement result) | Roadmap §12/§26 | **⚠ M1/M2** — writer + granularity not explicit |
| Roadmap Attention (REPAIR/REVIEW_DUE) | Roadmap (derived from signals) | Roadmap §12/§14 | **⚠ M3** — must be derived-only |
| Review candidate | Mastery engine | Mastery §13 | ✔ |
| Misconception signal | Mastery/learner-signals | Mastery §27 | ✔ |
| `PlacementDecision` | Placement engine | Placement §15 | ✔ |
| Validation fact | Placement emits / Roadmap records durable | Placement §15; Roadmap §10 | **⚠ M1** — one source, one durable projection |
| Content quality issue | Content Quality | CQ §41 | ✔ |
| Evidence-admissibility decision | Content Quality (versioned) | CQ §35a | **⚠ M7** — representation must not mutate measurements |

**No two independent writers of the same truth were found** — the ⚠ rows are *under-specified*, not
*contradictory*.

## 7. Immutable facts vs derived projections

**Immutable / historical (never deleted/rewritten):** learner response; assessment attempt; `SkillMeasurement`;
per-lesson `LearnerLessonCompletion` + teaching-session-completed fact; historical acquisition event
(LEARNED/VALIDATED at T); historical validation; published revision used (pinned); historical quality approval
(policy version); historical content-defect/admissibility decision. **Derived / recomputable:**
`LearnerSkillState`/current competence; evidence sufficiency/coverage/diversity; domain projection; current
study-level projection; retention/freshness; review priority; roadmap projection + Attention + Availability;
current admissibility interpretation. **Consistency check** — the dangerous confusion *"historical mastery never
changes"* vs *"current competence can never decrease"* is correctly resolved: Mastery §5 (A/B frozen, C
recomputable) and CQ §35a agree. **PASS** (see §18).

## 8. Evidence lifecycle (end-to-end trace)

`Teaching activity → learner response (F, immutable) → deterministic/rubric scoring (versioned) → evidence kind
+ independence (F on measurement) → SkillMeasurement (F, append-only, pins derivationVersion) → [CQ
evidence-admissibility decision, versioned] → Skills projection (P, recompute) → Mastery evaluation vs
Mastery Requirement (P) → Roadmap point-acquisition consequence (F event + P attention) → review candidate (P)
→ later reassessment (new F, supersedes decision not evidence).` Every transition has a clear immutable/derived
split and a versioned policy. **Missing handoff identified:** the *admissibility* hop (bracketed) is defined by
CQ §35a but its **representation and the recompute trigger** are not yet owned by a named contract → **M7**
(implementation-critical).

## 9. Evidence admissibility (cross-engine)

CQ §35a ("immutable historical evidence ≠ permanent current admissibility") is **compatible** with Skills §16
(recomputable state), Mastery §5.C/§29 (current projection responds to evidence; anchors don't erase evidence),
Placement §11/§30-equivalent (supersede decision, keep evidence), Roadmap §17 (regeneration preserves history).
Wrong-answer-key scenario traces cleanly (§34). Blast-radius scoping (bad explanation ≠ invalidate a valid
independent mastery task) is stated in CQ §35a and consistent. **One gap (M7):** admissibility must be a
*versioned CQ decision consumed by recompute* — **not a mutable flag written onto `SkillMeasurement`** (that
would violate append-only, Mastery §5). The specs imply this but do not forbid the flag explicitly. **PASS given
M7 amendment.**

## 10. Validation / completion / acquisition / proficiency semantics

Four concepts must stay distinct: `VALIDATED_BY_ASSESSMENT ≠ COMPLETED_BY_LEARNING ≠ CURRENTLY_PROFICIENT ≠
SESSION_COMPLETED`. Cross-check: Roadmap §10/§11 (validated ≠ completed, no fake `LearnerLessonCompletion`/XP/
IZL), Placement §15a, Teaching §21 (session-completed ≠ mastered), Mastery §7 (all four distinct), LEARNING §4a.
**All specs agree — PASS.** Residual: the *store* of the validation fact (M1) and the *granularity* of the
acquisition event vs per-lesson completion (M2).

## 11. Assessment sufficiency semantics

`NOT_ASSESSED` (no evidence) / `INSUFFICIENT_EVIDENCE` (some, not enough) / `SUFFICIENTLY_ASSESSED` (enough under
policy) — defined in Skills §18, consumed by Skills §19 aggregation (never 0; excluded from numeric math but
visible to decision coverage). Placement §10 required-domain floors correctly refuse "Grammar 95 / Reading 94 /
Listening·Writing·Speaking NOT_ASSESSED ⇒ B2 validated". **PASS.** **MINOR (m1):** Placement §10/§17 predates
Skills §18 and uses `NOT_ASSESSED` + `minEvidenceSufficiency` but not the explicit `INSUFFICIENT_EVIDENCE` term
— vocabulary should be aligned.

## 12. confidence / coverage semantics

Searched all specs. `confidenceBp` = evidence **coverage** consistently, explicitly **not** certainty/mastery
probability/decision confidence: Placement §16, Skills §17 (four notions A/B/C/D), Mastery §4/§17. No spec
treats it as statistical certainty. **PASS.** **MINOR (m2):** one canonical label for the current-ability
projection ("current competence projection") should be used everywhere instead of the interchangeable
"demonstrated mastery"/"mastery estimate."

## 13. Roadmap Point / Blueprint / Lesson boundaries

Roadmap §5 (Point ≠ Lesson; may span multiple content pieces) and Teaching §4/§34 (Blueprint ≠ LessonRevision;
orchestrates one-or-more content revisions) agree — the owner's reconciliation fixed the earlier 1:1 assumption.
No residual accidental 1:1. **PASS.** (Consequence: point acquisition is per-point while `LearnerLessonCompletion`
is per-lesson → the mapping is M2.)

## 14. Skill / domain / level semantics

Subject → subject-scoped Domain → Skill (Skills §4), and Skill ≠ one CEFR level — Skill↔LevelExpectation
(introduced/expected/reinforced/assessed/required-for-exit, Skills §8). English CEFR is first-class *subject
configuration*, not a hardcoded engine enum (Skills §9; Placement §0.1; Roadmap §4/§22). **PASS.**

## 15. Mastery-requirement ownership

**⚠ M6.** The Mastery Requirement appears in Skills §8 (expectation "required evidence kinds"), Mastery §10
("for a Skill-Level Expectation and/or Roadmap Point"), Roadmap §5/§11 (point "mastery requirement"), and CQ §20
(validates satisfiability). The *definition* home is ambiguous. Required agreement (already implied, must be
explicit): **authored as content** (part of the Skill-Level Expectation and/or point blueprint, CQ-gated) →
**Mastery evaluates** learner evidence against it → **Roadmap consumes** the result. The five-way agreement
(CQ blocks unsatisfiable requirement; Teaching can't fabricate production evidence; Mastery can't mark satisfied;
Roadmap can't mark LEARNED) is **consistent** across CQ §20, Teaching §22/§24, Mastery §11, Roadmap §11 —
**PASS on behavior**, amend for the single authoring home.

## 16. Misconception ownership

Canonical taxonomy = Methodist/verified-content (Skills §23). Teaching observes/classifies (§17); Mastery
accumulates/activates/resolves (§27); Roadmap acts on repair target (§13); CQ analyzes aggregate patterns (§21);
AI classifies within the approved taxonomy only, never creates canonical entries (Skills §23, Teaching §17, CQ
§29). **No duplicate ownership, no silent AI creation. PASS.**

## 17. Repair vs review consistency

`not established → REPAIR`; `established but recall needed → REVIEW`; `repeated review failure → may escalate to
REPAIR` — Mastery §8/§20, Roadmap §13/§14. A single lower prerequisite gap inserts **targeted** repair and
blocks only dependent point(s) — it must **not** restart the level: Roadmap §9/§13 (Scenario D), Placement §13.
No spec restarts the level. **PASS.** (Store of REPAIR/REVIEW attention = M3.)

## 18. Current competence vs historical acquisition

Scenario (Day-1 LEARNED → weeks later three independent production failures) traces consistently: historical
evidence + LEARNED event frozen (Mastery §5.A/§5.B), current competence projection may fall (§5.C), REPAIR_REQUIRED
activates (§20), Roadmap shows LEARNED + REPAIR_REQUIRED (§7/§34; Roadmap §12). CQ §35a aligns. **PASS** — this
was the last reconciliation and it holds.

## 19. Versioning / reproducibility matrix

| Pinned/versioned thing | Version created by | Referenced by | Must remain reproducible |
|---|---|---|---|
| Assessment definition/version | authoring | attempts | ✔ (V1 pins `definitionVersionId`) |
| Placement engine + threshold policy | Methodist | `PlacementDecision` | ✔ (Placement §10/§24) |
| `PlacementDecision` (policy+derivation) | Placement | Roadmap | ✔ (§15/§20) |
| Skill definition / `code` | Methodist | measurements, mappings | ✔ (Skills §5/§25) |
| Skill-Level Expectation | Methodist | Mastery/Placement | ✔ (Skills §25) — **new** |
| Canonical roadmap graph | Methodist | projection | ✔ (Roadmap §23) — **new** |
| Learner roadmap projection generation | Roadmap | UI/DailyPlan | ✔ (Roadmap §17/§23) — **gap: V1 `LearnerRoadmap` has no `engineVersion`** |
| Teaching Blueprint revision + content-revision set | Methodist | session pin | ✔ (Teaching §28) — **new** |
| Referenced Lesson/content revisions | authoring | blueprint/session | ✔ (V1 pins `lessonRevisionId`) |
| Activity payload/revision | authoring | attempts | ✔ |
| Scoring version | code | measurements | ✔ (deterministic) |
| Rubric version | Methodist | productive eval | ✔ — **new (AI)** |
| AI eval prompt/policy | code/policy | rubric eval | **gap** — named but no version contract |
| Mastery Requirement version | Methodist | Mastery eval | ✔ — **new (M6)** |
| Mastery derivation policy | code | `LearnerSkillState` | ✔ (`derivationVersion`) — extend |
| Review selection policy | code | review session | ✔ (`review-session-v1`) |
| Quality policy version | Methodist | approval | ✔ (CQ §48) — **new** |
| Evidence-admissibility decision/policy | Content Quality | recompute | **gap M7** — representation undefined |
| Source/provenance | authoring | published content | ✔ (CQ §7/§49) — **new** |

**Versioning gaps:** (a) `LearnerRoadmap` lacks generation/engine version (Roadmap §17 flags it) — needed for
regeneration history; (b) AI eval prompt/policy versioning is named but lacks a contract; (c) admissibility
decision representation (M7). Otherwise the reproducibility model is complete.

## 20. Reassessment / regeneration

Old `PlacementDecision` superseded by new (decision superseded, **evidence + history preserved**): Placement
§11, Mastery §30, Roadmap §17. Roadmap projection regenerates/versions; durable completions/validations survive.
**PASS** (contingent on the `LearnerRoadmap` generation-version gap above).

## 21. Content versioning / availability

Active-session pinning to blueprint/content-revision **set** (Teaching §28); new sessions get v4; v3 history
reproducible; critical withdrawal blocks **future assignment** without mutating recorded sessions (CQ §35/§36).
Emergency semantics are stated (CQ §36) though the exact status enum is deferred (acceptable). **Content
availability** has two representations (M4): publication status (CQ §45, source) vs Roadmap `CONTENT_UNAVAILABLE`
(§21, derived) vs Placement `LEVEL_UNAVAILABLE` (§18.3, derived) — must designate publication status as source.

## 22. AI authority audit

| AI MAY | AI MUST NOT |
|---|---|
| draft explanations/examples/distractors/visuals; classify errors into the approved taxonomy; personalize approved wording; evaluate productive/speaking under rubric; suggest approved remediation branches; research/summarize sources; consistency-check | invent canonical skills / CEFR expectation policy / roadmap nodes / misconception categories; silently mutate canonical content or roadmap; **publish** / self-approve; override deterministic objective scoring; fabricate evidence or sources; treat runtime web results as authority; fake speaking/writing/listening when unavailable |
Sources: Placement §2, Roadmap §8, Teaching §24/§29, Skills (authoring), Mastery §29 (deterministic core), CQ
§29/§30/§50. **Fully consistent across all six — PASS.**

## 23. AI / media degradation

Speaking-provider-unavailable traces identically everywhere: Teaching = assessment unavailable (§24/§29); Skills
= Speaking `NOT_ASSESSED`/insufficient (§18); Mastery = no fake productive mastery (§26); Placement = required-
domain policy sees missing evidence (§10/§17); Roadmap = honest (§21); CQ = no fake coverage (§25). **No engine
converts to 0. PASS.**

## 24. Daily Plan boundary

Roadmap provides path candidates (§19); Mastery/Review provides prioritized review candidates (§14/§36); Daily
Plan chooses today; Teaching executes. No other engine schedules the day. **PASS** (no V1 generator; boundary
clean).

## 25. Reward / XP / IZL boundary

Validation ≠ completion reward (Roadmap §10); review ≠ automatic unlimited reward, session completion ≠ mastery
reward (Mastery §40). Engines emit **facts**; Reward/Finance owns awards. **PASS.**

## 26. Quality signal vs learner signal

Learner signal = one-learner interpretation (Mastery §28); content-quality signal = aggregate content problem
(CQ §37/§43). "One learner omits 3SG" (learner) vs "80% of strong learners fail one item" (content). Neither
auto-converts to the other; neither auto-edits. **PASS.**

## 27. Invalid-content blast radius

Scoped, not blanket: a defect may affect one answer key / item / rubric / media asset / localized variant /
explanation stage / whole revision (CQ §35a; §28-equivalent). Not "invalidate all session evidence"; not "keep
all automatically." **PASS** (representation = M7).

## 28. State-machine collision audit

Distinct dimensions, no overlap in meaning — but several are easy to confuse by name at implementation time:
`RevisionStatus` (content), Teaching session status, Roadmap **Acquisition** vs **Availability** vs **Attention**
(three axes, Roadmap §12), assessment **sufficiency** state (Skills §18), review session state, retention state,
misconception state, quality-review state, quality-issue lifecycle, content availability, evidence admissibility.
**No semantic collision**, but the three Roadmap axes + sufficiency + admissibility share adjectives
(`LEARNED/VALIDATED/REPAIR/REVIEW/UNAVAILABLE/INSUFFICIENT`) → **MINOR (m3): a single naming convention doc is
recommended** so implementers never store a value on the wrong axis.

## 29. Duplicate-truth risks (CRITICAL SECTION)

For each: **SoT** = source of truth · **View** = derived/cached · **Recompute owner**.

| # | Risk | SoT | Derived view | Recompute owner | Sev |
|---|---|---|---|---|---|
| D1 | current competence vs a separately-stored domain score | `LearnerSkillState` + measurements | domain/level projection | Skills (over merge) | MAJOR **M5** |
| D2 | Roadmap acquisition vs a Mastery "mastered" flag | Roadmap point-acquisition event | Mastery "requirement satisfied" result (transient) | Mastery evaluates, Roadmap writes event | MAJOR **M2** |
| D3 | Teaching session completion vs `LearnerLessonCompletion` | per-lesson `LearnerLessonCompletion` (F) | session-completed fact (F, different granularity) | — | MAJOR **M2** (map granularity) |
| D4 | Placement validation vs roadmap validation state | `PlacementDecision.validatedAreas` + evidence | Roadmap acquisition=VALIDATED (durable projection w/ provenance) | Roadmap consumes | MAJOR **M1** |
| D5 | `displayLevel` cache vs derived expectation satisfaction vs PlacementDecision level | Skills expectation-satisfaction over evidence | `displayLevel` (cache only) | Skills | MAJOR **M5** |
| D6 | REVIEW_DUE stored in roadmap item **and** LearnerSignal | signal/evidence (Mastery) | Roadmap Attention view | Roadmap recompute | MAJOR **M3** |
| D7 | REPAIR_REQUIRED stored in several engines | signal/evidence (Mastery/CQ) | Roadmap Attention view | Roadmap recompute | MAJOR **M3** |
| D8 | content availability in roadmap vs publication status | publication status (CQ) | Roadmap `CONTENT_UNAVAILABLE` | Roadmap recompute | MAJOR **M4** |
| D9 | admissibility copied onto measurements vs versioned quality decision | versioned CQ decision | recompute exclusion/qualification | Mastery/Skills recompute | MAJOR **M7** |

**All nine already *lean* the right way in the specs** (they say "derived"/"recomputed"/"consumes") — the
amendment is to state the SoT/View/recompute-owner **explicitly** so no implementer persists the view as an
independent writable truth.

## 30. Scenario A — new learner

`"I am new"` → Placement `FRESH_START`, no exam (Placement §3/§7) → Roadmap generates macro A1→C2, first A1 point
`AVAILABLE`, rest `LOCKED`, 0% (Roadmap §16/§14; Scenario A) → Teaching selects the A1 blueprint (Teaching §4/§5)
→ session emits evidence (Teaching §22) → Mastery evaluates the point Mastery Requirement (Mastery §11) →
Roadmap writes acquisition on satisfaction (M2) → later review candidate (Mastery §13). **Traces cleanly; only
under-specified point = who writes the LEARNED event (M2).**

## 31. Scenario B — claimed B2

claims B2 → B2 diagnostic → Grammar/Reading strong, Listening weak, Writing/Speaking `NOT_ASSESSED` →
`PlacementDecision` (validatedAreas + weak + NOT_ASSESSED, Placement §14/§15) → Roadmap validates strong areas
(no fake completion), inserts listening/repair, does **not** restart B2 (Roadmap §10/§13; Scenario B) → optional
C1 challenge only if fully validated (Placement §11 — Listening weak ⇒ not offered). **No contradiction; store of
validation = M1.**

## 32. Scenario C — mastered then regressed

LEARNED → REVIEW_DUE → one review wrong (no downgrade) → three independent production failures → current
competence falls, historical LEARNED remains, REPAIR_REQUIRED, targeted repair, new evidence, recompute (Mastery
§5/§7/§20/§41; Roadmap §12). **PASS** (the reconciled path).

## 33. Scenario D — defective item

published item → response (F) → measurement (F) → wrong-key confirmed → CQ quality incident + **admissibility
decision** (CQ §35a) → Skills/Mastery **recompute** excluding/qualifying affected evidence → Placement/Roadmap
regenerate if materially affected → learner action only if justified; **no history rewrite** (CQ §35a; Mastery
§5). **Traces cleanly; depends on M7** (admissibility representation + recompute trigger contract).

## 34. Scenario E — AI/speech unavailable

point needs Speaking evidence, provider down → Teaching: unavailable; Skills: Speaking `NOT_ASSESSED`; Mastery:
requirement not satisfiable via production ⇒ not marked LEARNED (no fake); Placement (if in a diagnostic):
required-domain missing; Roadmap: honest; CQ: no fake coverage. **No fake 0/success/complete. PASS.**

## 35. Scenario F — content missing

valid B2 learner, B2 blueprint unpublished → CQ reports no publish-ready coverage (§45) → Roadmap
`CONTENT_UNAVAILABLE` (§21), spine visible, not actionable → Teaching cannot start a missing blueprint (§21) →
**no A1 substitution / no fake completion** (Placement §18.3). **PASS** (availability SoT = M4).

## 36. Scenario G — reassessment

old decision + old projection + historical learning → new reassessment evidence → new `PlacementDecision`
(supersedes decision) → Roadmap regenerates/versions projection → **durable completions/validations/history
survive** (Placement §11; Roadmap §17; Mastery §30). **PASS** (contingent on `LearnerRoadmap` generation-version
gap).

## 37. Implementation-critical open questions

**A — MUST RESOLVE BEFORE SCHEMA DESIGN (7):**
1. Source-of-truth designations for D1–D9 (M1–M5) — which store is authoritative vs a derived/cached view.
2. Evidence-admissibility **representation** (versioned CQ decision, *not* a flag on `SkillMeasurement`) + the
   recompute trigger contract (M7).
3. Point-acquisition **event** semantics + its mapping to per-lesson `LearnerLessonCompletion` (M2).
4. Mastery Requirement **authoring home** (one place) (M6).
5. Skill ↔ Domain ↔ Level-Expectation persistence relationship (Skills §35) — association vs attribute.
6. Roadmap Point ↔ Blueprint ↔ content-revision-set persistence relationship (Roadmap §27; Teaching §36).
7. `LearnerRoadmap` generation/engine **version** for regeneration history (Roadmap §17 gap).

**B — before engine implementation:** review-scheduling policy shape; merge rework (kind-aware, anchor-as-
baseline; Mastery §29); productive/rubric evidence pipeline. **C — configurable during implementation:**
threshold/floor numbers; interval policy; hint weighting; review priority formula. **D — later product phase:**
speaking/STT provider; vocabulary subsystem; item-analysis statistics; batch authoring.

## 38. CRITICAL / MAJOR findings

**CRITICAL: none.** **MAJOR (7):**
- **M1 — Validation fact has two candidate stores.** `PlacementDecision.validatedAreas` (Placement §15) and
  Roadmap acquisition=VALIDATED (Roadmap §10). *Why it matters:* two writable "validated" stores can diverge.
  *Resolution:* PlacementDecision + evidence = SoT; Roadmap records a durable VALIDATED acquisition **projection
  with provenance to the decision**, never an independent truth. *Amend:* Roadmap §10/§26, Placement §15.
- **M2 — Point-acquisition event: writer + granularity.** Point LEARNED (per-point, Roadmap §12; evaluated by
  Mastery §11) vs `LearnerLessonCompletion` (per-lesson, V1). *Why:* ambiguity on who writes LEARNED and how a
  multi-lesson point aggregates completions. *Resolution:* Mastery **evaluates** the requirement; **Roadmap
  writes** the durable acquisition event; a point's LEARNED aggregates its lessons' completions + evidence.
  *Amend:* Roadmap §11/§12/§26, Mastery §11/§34.
- **M3 — REVIEW_DUE / REPAIR_REQUIRED double storage.** Signals (Mastery/learner-signals) vs Roadmap Attention
  (§12/§14). *Resolution:* signal/evidence = SoT; Roadmap Attention = derived, recomputed view (no independent
  writer). *Amend:* Roadmap §12/§14, Mastery §28.
- **M4 — Content availability double storage.** Publication status (CQ §45) vs Roadmap `CONTENT_UNAVAILABLE`
  (§21) vs Placement `LEVEL_UNAVAILABLE` (§18.3). *Resolution:* publication status = SoT; the others are derived
  views. *Amend:* Roadmap §21, CQ §45, Placement §18.3.
- **M5 — "Current level" split three ways + `displayLevel` cache.** Placement entry study-level decision vs
  Roadmap level-progression state (§15) vs Skills per-domain/skill level projection (§20). *Resolution:* name
  them distinctly; Skills owns per-skill/domain level projections (over evidence); Placement owns the entry
  decision (versioned); Roadmap owns active level-progression; `displayLevel` is a derived cache only. *Amend:*
  Skills §20/§21, Placement §15, Roadmap §15.
- **M6 — Mastery Requirement authoring home ambiguous.** Skills §8 / Mastery §10 / Roadmap §5. *Resolution:*
  authored as content (part of the Skill-Level Expectation and/or point blueprint), evaluated by Mastery,
  consumed by Roadmap. *Amend:* Mastery §10, Skills §8, Roadmap §5.
- **M7 — Evidence-admissibility representation.** CQ §35a. *Why:* if implemented as a mutable flag on
  `SkillMeasurement`, it breaks append-only immutability. *Resolution:* a **versioned CQ decision** consumed by
  recompute (exclude/qualify affected evidence); measurements are never mutated. *Amend:* CQ §35a, Mastery
  §5/§29.

## 39. MINOR findings

- **m1** — Placement §10/§17 should adopt the explicit `INSUFFICIENT_EVIDENCE` vocabulary from Skills §18.
- **m2** — One canonical label ("current competence projection") for the recomputable ability estimate, used
  across Skills §17 / Mastery §4/§5.
- **m3** — A short **axis/naming-convention** note so implementers never store an Attention value on the
  Acquisition/Availability axis (Roadmap §12 three axes + Skills §18 sufficiency + CQ admissibility share
  adjectives).
- **m4** — Unify "Blueprint Revision / content-revision set" (Teaching §4/§28) with CQ "content revision"
  (§33/§34) wording.
- **m5** — AI-evaluation prompt/policy versioning is named but lacks a version contract (versioning matrix gap).

## 40. Confirmed-consistent areas (PASS)

Validated≠Completed≠Proficient≠Session-completed (§10); LEARNED+REVIEW_DUE & LEARNED+REPAIR_REQUIRED multi-axis
(§18); repair≠review (§17); NOT_ASSESSED/INSUFFICIENT/SUFFICIENT + no-silent-validate (§11); confidence=coverage
(§12); recognition≠production, exposure≠evidence (§14); historical-immutable vs current-recomputable (§7/§18);
AI authority (§22); AI/media honest degradation (§23); Daily Plan boundary (§24); reward boundary (§25); quality
signal ≠ learner signal (§26); blast-radius scoping (§27); Point≠Lesson, Blueprint≠LessonRevision (§13); macro/
micro boundary; misconception ownership (§16); reassessment preserves history (§20); single evidence substrate +
single-writer merge (§6). **These are genuinely coherent — not forced.**

## 41. Required amendments (documentation only — do NOT apply here)

The controlled reconciliation pass should make **7 source-of-truth/ownership designations (M1–M7)** explicit and
apply **5 minor terminology alignments (m1–m5)**. Affected specs: **Roadmap** (§10/§11/§12/§14/§15/§21/§26),
**Placement** (§10/§15/§17/§18.3), **Skills** (§8/§18/§20/§21), **Mastery** (§5/§10/§11/§28/§29/§34), **Content
Quality** (§35a/§45), plus a small **cross-cutting naming-convention** note (candidate: a new section in
`LEARNING_SYSTEM_V2.md`, or a shared appendix). No engine's *behavior* changes — only the explicit designation of
which store is authoritative and which is a derived view.

## 42. Final verdict

**PASS WITH REQUIRED RECONCILIATIONS.** The six-engine architecture is fundamentally coherent — one evidence
substrate, one merge writer, cleanly separated ownership, and the previously-dangerous confusions already
reconciled — with **no CRITICAL conflict and no end-to-end scenario failure**. Before schema design, the owner
should run one controlled pass to make **7 source-of-truth / write-authority designations (M1–M7)** explicit
(they are currently *implied* but not *stated*, which is the main risk of accidental duplicate truth at
implementation time) and apply **5 minor terminology alignments**. With those documentation reconciliations, the
architecture is ready for implementation planning.
