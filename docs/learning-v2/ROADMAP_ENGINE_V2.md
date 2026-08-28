# Roadmap Engine V2 — Specification

> **Status:** SPECIFICATION ONLY. No code, Prisma/schema, migration, endpoint, runtime, test, or deployment
> change is implied. V1 / CONTROLLED_RC keeps running unchanged.
>
> **Companions:** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md) (engine hierarchy, macro/micro),
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md) (the `PlacementDecision` this engine consumes).
>
> **Grounding (verified against current code, not summaries):** `prisma/schema/{content,learning}.prisma`
> (`LearnerRoadmap` L423-443, `RoadmapItem` L445-469, `LearnerRecommendation` L471-490, `RoadmapChange`
> L492-507, `LearnerSignal` L510-532, `Checkpoint` L535-553, `DailyPlan`/`DailyPlanItem` L559-599),
> `src/roadmap/**` (`RoadmapService.generateInitial`/`reconcileCompletion`, `GapRankingEngine`,
> `RoadmapCandidateService`, `RoadmapRepository`), `src/learning-progress/**` (single-writer merge),
> `src/skill-profile/**`, `src/lesson-execution/**`. Accepted product decisions cited as D-xx
> (`docs/PRODUCT_DECISIONS.md`). **Exact schema/enum/table names are deferred** (owner instruction); this fixes
> the *domain contract*, not identifiers.

---

## 1. Purpose

Turn a `PlacementDecision` (and later checkpoint/reassessment evidence) into a **personalized learning
journey** the learner can see and progress along — a macro CEFR spine (A1→C2) of pedagogical **points**, each
resolving to a taught micro path — that **validates what is known, repairs what is weak, sequences by
prerequisite, and evolves over time without rewriting history**. Roadmap answers *"what exact path should this
learner follow, from where placement put them?"* — it never re-decides *where they start* (that is Placement)
and never decides *how a point is taught* (that is the Teaching Engine).

Today's V1 roadmap is a single flat `ACTIVE` list of per-lesson `RoadmapItem`s generated once from a diagnostic
gap ranking; it has no level/point structure, no validation-skip (mastery only re-orders, never skips), no
multi-dimensional point state, and no live regeneration. V2 is the redesign that makes the journey real.

## 2. Product principles

1. **Roadmap is a journey, not a flat lesson list.** The learner sees where they started, where they are, how
   far they've come, the next milestone, what's learned / validated / needs repair / still locked.
2. **See the whole road.** The full A1→C2 macro path is visible even when later parts are locked (§14).
3. **Validated ≠ completed** (D-25/D-27; owner). Placement can mark a point *satisfied by assessment* without
   fabricating lesson completion, XP, IZL, or time-spent (§10/§11).
4. **No blanket validation.** Demonstrating B2 does not fabricate evidence for every A1–B1 lesson; prerequisite
   satisfaction from a higher level is a **deliberate, versioned policy with provenance**, not fake completion
   (§5/§10).
5. **Canonical curriculum is Methodist/verified-content authority; the learner roadmap is a projection** over
   it. AI may recommend adjustments *within* approved content, never invent curriculum nodes, never mutate the
   plan silently (D-05/D-13; §8).
6. **Repair ≠ review.** Repair = knowledge was not established; review = established but fading. Distinct
   states, distinct treatment (§13/§14).
7. **History is durable.** Completions, validations, and evidence survive regeneration; projections supersede,
   facts do not (§17/§23).
8. **Honest degradation.** A point with no published teaching content shows a clear *unavailable* state; never
   fabricated, never silently substituted (§21).
9. **Subject-agnostic architecture.** CEFR is English's level configuration, not a hardcoded roadmap shape
   (§22).

## 3. Definitions

| Term | Meaning |
|---|---|
| **Macro roadmap** | The ordered level spine for a subject+track. For English General: A1→A2→B1→B2→C1→C2. |
| **Roadmap point** | A pedagogical learning unit / milestone (e.g. "The verb *to be*", "Present Simple") — **not** necessarily one Lesson; may require multiple published teaching pieces. The unit the roadmap sequences and states. |
| **Micro learning path** | The taught sequence *inside* a point (concept→…→mastery). Owned by the **Teaching Engine**, not this engine (§6). |
| **Canonical curriculum graph** | Methodist-authored subject structure: levels, sections/modules, points, prerequisites, point→skill expectations, teaching blueprint refs. The **authority** (§8). |
| **Learner roadmap projection** | The personalized, versioned view of the canonical graph for one learner, driven by placement + history + evidence (§8). |
| **Validated (by assessment)** | A point/prerequisite the learner has demonstrated via evidence — satisfied without study. A **durable fact with provenance**, not a completion. |
| **Learned (by learning)** | A point the learner actually studied to completion (today's `LearnerLessonCompletion`, with XP/IZL/time). |
| **Repair** | Targeted work because knowledge was **not sufficiently established** (weak). |
| **Review** | Recall/strengthening because established knowledge is **fading** (`REVIEW_DUE`). |

## 4. Macro roadmap

```
English (Subject) · Track = General English
  A1  ── section/module ── point ── point ── point ─┐
  A2  ─────────────────── point ── point ──…        │  ordered, prerequisite-linked
  B1  …                                             │  the learner-visible SPINE
  B2  …                                             │
  C1  …                                             │
  C2  …  ───────────────────────────────────────────┘
```
- The macro spine is **first-class product structure** for English (owner; see `LEARNING_SYSTEM_V2.md` §3.1),
  not free-text display data. `Level.code` being free-text today (TD-27) is **V1 compatibility history**.
- A level contains **sections/modules → points** (hierarchical, for visibility and progress, §13/§14).
- **Current gap:** `LearnerRoadmap` is per `(subjectId, trackId)` with a **flat `RoadmapItem.position` list** —
  there is no level or point grouping. The macro spine has no home model yet (§29).

## 5. Roadmap point

A point is the unit this engine reasons about. It **references** teaching content but does **not own
execution**. Conceptually a point carries (exact schema deferred, §27; contract in §12):
- stable identity; level; title; pedagogical goal / **can-do outcome**;
- **prerequisites** (point-level, §9); **expected skills/domains** (point→skill expectations);
- required vs optional; estimated effort/duration; ordering;
- **teaching content availability** (published blueprint or not, §21); mastery requirement.

A point may map to **multiple** published lessons/activities. In V1 the `RoadmapItem` is per-**lesson**
(`lessonId`), so "point" has no representation — the closest current containers are `Topic`/`Module`, but those
are content containers, not learner-progression units. V2 introduces the point as the projection unit (§8/§29).

## 6. Micro learning-path boundary (do not become the Teaching Engine)

Inside a point lives the micro path — *concept → visual → rule → examples → recognition → sentence building →
guided writing → listening → reading → speaking → mixed practice → mastery check → later review.*

- **Roadmap Engine owns:** *which* point comes next, prerequisite/order, point **state**, placement
  validation, repair insertion, level progression.
- **Teaching Engine owns (later):** *how* a point is taught — activity sequencing, remediation within the
  point, the micro-path stages above.
- **Hard boundary:** this engine must not sequence intra-point activities or define remediation drills. It
  hands the Teaching Engine a point + its blueprint refs and consumes back mastery/completion evidence.

## 7. PlacementDecision input contract

Roadmap V2 **consumes** `PlacementDecision` (placement spec §15); it must **not** recompute placement. It reads
(domain concepts; names deferred):
`recommendedStart` (study/start level + entry point) · `validatedAreas[]` · `weakAreas[]` · `prerequisiteGaps[]`
· `recommendedRepairs[]` · `domainScores[]` · `skillEvidence[]` · level-up (next-level) evidence ·
`decisionType` · **policy/derivation version + contributing attempt provenance**.

- **Division of labour:** Placement answers *"where should this learner start?"*; Roadmap answers *"what exact
  path from there?"*.
- **Provenance is mandatory:** every roadmap element derived from placement records which decision (and its
  version) produced it, so regeneration and audit can trace it (§17/§23).
- Today the hand-off is only the per-skill diagnostic `SkillMeasurement` snapshot (read via
  `roadmap.repository.diagnosticMeasurements`) → `GapRankingEngine` → candidate plan. V2 replaces this thin
  input with the full decision while keeping the snapshot as the evidence backing (§29).

## 8. Canonical curriculum vs learner projection

Two distinct layers (owner decision #10 direction):

**Canonical curriculum graph — Methodist/verified-content authority.** Defines levels, sections/modules,
points, ordering, prerequisites, required/optional relationships, point→skill expectations, and teaching
blueprint/content references. It is **shared, versioned, authored** — the single source of curricular truth.

**Learner roadmap projection — personalized.** A per-learner view computed from: `PlacementDecision`, learning
history, mastery/evidence (`LearnerSkillState`/`SkillMeasurement`), prior completions, validations, repairs,
review state, learner goal, and (where relevant) available time.

Rules:
- **AI must not invent canonical nodes.** AI may propose *projection* adjustments within approved content and
  pedagogical constraints (surfaced as `LearnerRecommendation`, accepted by the learner — D-13); no silent
  mutation.
- The projection **selects, orders, states, and annotates** canonical points for one learner; it never edits
  the canonical graph.
- **Current gap:** no canonical graph model exists (only the content container chain
  `Subject→Track→Level→Module→Topic→Lesson`), and `LearnerRoadmap` is a single flat projection with no link to
  a canonical point graph or its version (§29).

## 9. Point / prerequisite graph

- **Point-level prerequisites** (a DAG over points), e.g. *Basic sentence structure → verb "to be" → Present
  Simple*. This is coarser and more pedagogical than V1's per-`LessonPrerequisite` edges (which stay valid as
  *within-point*, content-authoring ordering).
- **A prerequisite is satisfied when policy accepts any of:**
  1. **learned completion** (`LearnerLessonCompletion` for the point's required content);
  2. **evidence-backed assessment validation** (`VALIDATED_BY_ASSESSMENT` with provenance);
  3. **explicitly accepted placement-level prerequisite satisfaction** — a *deliberate, versioned policy*
     that lets demonstrated higher-level competence satisfy a lower prerequisite (§5/§10), recorded with
     provenance — **never** a fabricated completion row.
- **Lower-prerequisite discovery** (Scenario D): a B2 learner with strong B2 grammar but a weak B1
  prerequisite → **insert/activate a targeted B1 repair point** and **block only the dependent B2 point(s)** —
  do not reset the roadmap.
- **Current gap:** prerequisites exist only at lesson granularity (`LessonPrerequisite`, per-lesson DAG, no
  cross-level edges) and satisfaction is only "completed lesson". Point-level prereqs and validation/policy
  satisfaction are NEW (§29).

## 10. Validation semantics

`VALIDATED_BY_ASSESSMENT` is a **durable fact** attached to a point/prerequisite, carrying: the evidence
(contributing `SkillMeasurement`/attempt), the `PlacementDecision` + policy version, and a timestamp.

- Roadmap **may** treat a validated point as satisfied (skip normal instruction; show "assessment-validated").
- Validation **must not**: create `LearnerLessonCompletion`, award lesson-completion XP or IZL, count as
  lesson time-spent, or pretend activities executed (protects reward integrity D-25 and anti-farming D-27).
- **No blanket validation (owner #5).** Passing a B2 diagnostic does **not** validate every A1–B1 point.
  V2 distinguishes three satisfaction kinds and never conflates them:
  1. **explicit evidence-backed validation** — the point's expected skills/domains were actually measured;
  2. **prerequisite satisfaction implied by policy** — a versioned rule (e.g. "demonstrated B2 grammar
     satisfies the B1 grammar prerequisite") applied deliberately, with provenance; distinct from (1);
  3. **normal learned completion** — the learner studied it.
- A validated point that later shows decay can become `REVIEW_DUE` or `REPAIR_REQUIRED` (§12) — validation is
  durable but not immune to new evidence.

**Source-of-truth (audit M1).** Distinguish the **Placement validation *decision*** from the **Roadmap point
validation *event***. The `PlacementDecision` (Placement §15) is the authoritative, immutable record of *what
Placement decided* (including `validatedAreas`). Roadmap **does not recompute** that diagnostic validation; it
**consumes** it and writes a durable **point validation/acquisition event** meaning *"this point was accepted
into the learner's roadmap history as validated at T"*, carrying **provenance** to the source
`PlacementDecision`/evidence/policy version. The Roadmap event is **not** a competing statement about what
Placement decided. Reassessment, competence regression, or an evidence-admissibility change (Content Quality
§35a) **never rewrite** either historical fact — a new `PlacementDecision` may supersede the decision and the
current roadmap projection may regenerate (§17), but history survives.

## 11. Completion semantics

`COMPLETED_BY_LEARNING` = the learner actually worked the point's content (`LearnerLessonCompletion`, with its
XP/IZL/time side effects). It is a durable historical fact. Distinctions the model must preserve:
- Completion and validation are **separate durable facts** — a point can be learned, validated, both, or
  neither; regeneration preserves both (§17).
- `reconcileCompletion` today marks a roadmap COMPLETED only when **every** item's lesson has an authoritative
  completion; V2 generalizes "satisfied" to *completed **or** validated* at the point level, without faking
  completion rows (§29).

**Granularity & write-authority (audit M2).** Four distinct facts must never be interchanged:
- **`LearnerLessonCompletion`** — immutable **per-lesson** fact (+XP/IZL/time), written by lesson execution.
- **TeachingSession completion** — immutable **per-session** terminal-state fact, written by Teaching
  (Teaching §21). A session reaching its end is **not** point mastery.
- **Mastery evaluation** — the Mastery Engine's versioned evaluation of evidence vs the pinned Mastery
  Requirement (Mastery §11) — a recomputable result, not an acquisition fact.
- **Roadmap Point acquisition event** — the durable **per-point** `LEARNED`/`VALIDATED` fact.

A **Roadmap Point may span multiple lessons/content pieces/sessions** (§5), so its acquisition is **not** the
same as any single `LearnerLessonCompletion`. **Roadmap is the sole writer of point-acquisition history**, after
consuming a **Mastery evaluation** (for `LEARNED`) or a **Placement validation** (for `VALIDATED`, §10). The
Mastery Engine **must not** persist a competing global `point.mastered = true` — it may reproduce the evaluation
result, but Roadmap owns its application to acquisition history. No fabricated `LearnerLessonCompletion` is ever
created when a point is validated.

## 12. Point state model

A single scalar status is insufficient (owner). A point's learner-facing state is **multi-dimensional** —
three independent axes that can coexist:

| Axis | Values (concepts) | Nature |
|---|---|---|
| **Acquisition** (durable fact) | `NONE` · `LEARNED` (completed-by-learning) · `VALIDATED` (by assessment) · both | durable historical fact + provenance |
| **Availability** (transient) | `LOCKED` (prereqs unmet) · `AVAILABLE` · `IN_PROGRESS` · `CONTENT_UNAVAILABLE` (§21) | recomputed from graph + prereqs + content |
| **Attention** (transient recommendation) | none · `REPAIR_REQUIRED` (weak) · `REVIEW_DUE` (fading) | recomputed from evidence/signals |

- **Legal transitions & their evidence:**
  - `LOCKED → AVAILABLE`: all prerequisites satisfied (completion **or** validation **or** policy, §9).
  - `AVAILABLE → IN_PROGRESS`: learner starts the point's content.
  - `IN_PROGRESS → LEARNED`: authoritative completion of required content (+ mastery requirement, §15).
  - `* → VALIDATED`: a `PlacementDecision`/checkpoint marks the point evidence-validated (no completion row).
  - `LEARNED|VALIDATED → +REVIEW_DUE`: decay/signal (`LearnerSignal` REVIEW_DUE) — acquisition **unchanged**.
  - `LEARNED|VALIDATED → +REPAIR_REQUIRED`: new evidence shows the competency is not actually established.
- **Coexistence:** `LEARNED + REVIEW_DUE`, or `VALIDATED + REPAIR_REQUIRED`, are valid combined states — hence
  three axes, not one enum.
- **Durable vs transient:** Acquisition facts (+ provenance) are durable and survive regeneration; Availability
  and Attention are **recomputed** each projection.
- **Current gap:** `RoadmapItemStatus` is a single scalar (`PENDING|IN_PROGRESS|COMPLETED|SKIPPED`) — it cannot
  represent LEARNED-and-REVIEW_DUE, or VALIDATED-vs-LEARNED, at all (§29).

**Source-of-truth per axis (audit M2/M3).**
- **Acquisition** is a **durable fact written only by Roadmap** (§11), from a Mastery evaluation or Placement
  validation, with provenance. It is the historical acquisition event; regeneration preserves it.
- **Availability** is a **derived projection** recomputed from the point graph + prerequisites + **published
  content state** (the availability source of truth is Content Quality/publication, audit M4, §21) — Roadmap
  does not own an independent content-availability truth.
- **Attention** (`REVIEW_DUE`/`REPAIR_REQUIRED`) is a **derived projection over the active signals/causes +
  policy** — **not** an independent source of *why* the learner needs review/repair (audit M3). The underlying
  **`LearnerSignal`/cause** (with reason, category, provenance, lifecycle) is the fact; Roadmap Attention
  answers *"what should this point currently show/do because of active evidence and signals?"*. Repair **causes**
  may originate from **Mastery review** *or* from **Placement/prerequisite analysis** (§9/§13) — the origin is
  not forced into one engine; Roadmap merely derives the attention view over whichever causes are active.
- `LEARNED + REVIEW_DUE` and `LEARNED + REPAIR_REQUIRED` remain valid coexisting combinations (Mastery §7);
  **repair ≠ review** stays a hard distinction (Mastery §8; §13/§14).

## 13. Repair model

- **Repair point** = targeted work inserted because a competency is weak (placement/checkpoint/reassessment
  evidence). It carries: reason/provenance (which decision/signal), the target skills/domains, and whether it
  is a **prerequisite repair** (a lower-level gap blocking a dependent point, §9) or a **current-level repair**
  (a weak area within the level being studied).
- **Targeted, not restart** (Scenario B/E): given *Present Perfect strong, Conditionals weak*, the roadmap
  marks Present Perfect **validated** and inserts a **Conditionals repair** — it does **not** restart the level.
- **Repair vs review (must not be conflated):** *Repair* = not established (`REPAIR_REQUIRED`, from weak
  evidence); *Review* = established but fading (`REVIEW_DUE`, from decay/`LearnerSignal`). Different provenance,
  different pedagogy, different UI.
- Repairs are projection elements with provenance; when reassessment shows the gap closed, the repair resolves
  (§17) — the historical fact that it existed is retained for audit.
- **Current gap:** `GapRankingEngine` only **re-orders** by gap priority (weaker skills earlier); it never
  *inserts targeted repair* or distinguishes repair from review. `RoadmapItemType` has `REVIEW`/`PRACTICE` but
  no repair provenance. NEW/EXTEND (§29).

## 14. Review relationship

- Review is driven by **decay / recall need** over already-acquired knowledge, surfaced as `REVIEW_DUE`
  (`LearnerSignal` type already exists) — an **Attention** flag that does not change Acquisition.
- Roadmap **surfaces** review candidates (points that are LEARNED/VALIDATED and now REVIEW_DUE) to the Daily
  Plan (§19); it does not schedule them.
- The Mastery/Review engine owns *when* review is due (decay model — no decay field exists today, flagged in
  `LEARNING_SYSTEM_V2.md`); Roadmap consumes the resulting signal.

## 15. CEFR / level progression

- A CEFR level is **not complete because one score crossed a threshold.** Progression to the next level
  considers: required points learned/validated, required skills/domains, mastery/checkpoint evidence, **no
  unresolved critical repairs**, assessment coverage, and **Methodist-defined exit requirements**.
- **No silent promotion.** When a level is sufficiently demonstrated/completed: show completion/validation
  clearly, make the next level **available**, and (per policy) optionally offer a reassessment/level-up
  challenge (which routes back through Placement, not recomputed here).
- Exact exit thresholds/formula are **deferred** (owner open question). The engine consumes a versioned
  **level-exit policy** (Methodist-owned), analogous to placement's threshold policy.
- **Current support:** module-scoped `Checkpoint` (one per module, backed by an `AssessmentDefinition`) exists
  and is the natural evidence source for level/section exit — REUSE. But there is no level-progression state or
  policy today (§29).
- **"Current level" disambiguation (audit M5).** Roadmap owns the learner's **curricular position/progression**
  — *where the learner currently is in the canonical path*. This is **not** automatically the same as their
  **current competence/proficiency level** (a Skills/Mastery recomputable projection, Skills §20) or the
  **recommended study level** (the Placement `…Decision`, Placement §15). Never use a bare "current level" in
  the roadmap contract; say **curricular position** (`LEARNING_SYSTEM_V2.md` §7.1/§7.4). `displayLevel` is a UX
  cache only, never authoritative here.

## 16. Generation algorithm — conceptual

Deterministic where possible; AI only as recommendation-within-constraints. Conceptual pipeline:

1. **Input:** `PlacementDecision` (+ later checkpoint/reassessment evidence) + learner history/evidence.
2. **Select canonical scope:** the subject+track's canonical point graph from `recommendedStart` outward
   (macro spine from the start level; earlier levels only as prerequisite context).
3. **Apply acquisition facts:** mark points `LEARNED` (prior completions) and `VALIDATED` (from
   `validatedAreas`, with provenance) — **without** writing completion rows (§10).
4. **Resolve prerequisites:** compute Availability (`LOCKED`/`AVAILABLE`) via §9 satisfaction (completion OR
   validation OR versioned policy).
5. **Insert repairs:** from `weakAreas`/`prerequisiteGaps`/`recommendedRepairs`, insert targeted repair points
   with provenance (§13); block only dependent points (Scenario D).
6. **Attach attention:** `REVIEW_DUE`/`REPAIR_REQUIRED` from signals/evidence (§12/§14).
7. **Order:** by macro level → canonical section/point order → prerequisite topo-sort → repair priority. (V1's
   `prerequisite-ordering` + gap priority is the reusable kernel here.)
8. **Content availability:** mark points whose blueprint is unpublished `CONTENT_UNAVAILABLE` (§21).
9. **Persist a versioned projection** with generation provenance (source decision + policy/engine version +
   `generatedAt`), superseding the prior projection while preserving durable facts (§17).
- **Determinism & idempotency:** same inputs + same versions → same projection (V1 `generateInitial` is already
  deterministic and idempotent per source; V2 keeps that property per generation).
- **No empty actionable roadmap:** if the start level's content is unavailable, the macro spine still renders
  (visibility, §14) but actionable points are honestly `CONTENT_UNAVAILABLE`, not fabricated (§21).

## 17. Regeneration / reassessment

- Roadmaps **evolve**: initial placement → projection *g1*; after study + checkpoint/reassessment → new gaps →
  projection *g2*. Each generation is **versioned and supersedable**; the prior projection is retained
  (superseded), not deleted.
- **History is durable and never rewritten:** completions, validations, evidence, and past repairs/decisions
  persist across regenerations with their provenance. Regeneration changes *recommendations and projection
  state*, not historical facts.
- **Provenance per generation:** source (placement / checkpoint / reassessment attempt), engine + policy
  version, `generatedAt`, and the change set (what was added/blocked/resolved and why).
- **Substrate already exists (inert):** `RoadmapChange` (`changeType` registry, `changePayload`, `appliedBy`
  SYSTEM/USER, recommendation link) and `LearnerRecommendation` (`proposedChange`, `PROPOSED→ACCEPTED`,
  `signalRefs`) are the audit/regeneration models to build on — EXTEND, not NEW.
- **Current gap:** `LearnerRoadmap` has **no `engineVersion`, no generation number, no supersede semantics**
  (only one `ACTIVE` per subject; regenerating replaces it and would lose the prior projection). This is the
  core regeneration gap (§29).

## 18. Progress model

Three **separate** concepts — never conflated (owner #13):

- **A. Curriculum coverage / proficiency progress** — how much of the canonical journey is *satisfied*
  (learned **or** validated), per level and overall. A learner placed into B2 legitimately shows earlier
  curriculum as satisfied.
- **B. Learning-activity / completion progress** — what the learner actually *studied* (real completions,
  time, XP/IZL). A validated-but-unstudied point contributes to **A**, never to **B**.
- **C. Mastery / evidence progress** — demonstrated competence strength (`LearnerSkillState` mastery, per
  skill/domain/level).

- **Hard rule:** analytics must never say "you completed 120 lessons" when the learner tested in and never
  studied them. Validation shows in **A/C**, not **B**.
- UI needs: total English-journey progress, per-CEFR-level progress, and current point/position — each drawing
  from the appropriate concept (visibility uses A; "what you did" uses B; "how strong" uses C).
- **Exact percentage formula is OPEN** (owner). Recommended direction: compute A/B/C from durable facts
  (validated/learned point counts weighted by required/optional) + `LearnerSkillState`, so progress is a
  **projection over evidence**, recomputable and non-drifting.

## 19. Daily Plan contract (boundary)

- **Roadmap ≠ Daily Plan.** Roadmap = *"what is my journey?"*; Daily Plan = *"what should I do today?"*.
- Roadmap **supplies candidates**: next available required points, repair priorities, review-due items,
  estimated effort. Daily Plan **selects** what fits today's available time/schedule.
- **Do not bake scheduling** ("one topic per day", streaks, time-boxing) into roadmap topology. Scheduling
  mechanics live in the Daily Plan engine.
- **Current support:** `DailyPlan`/`DailyPlanItem` models exist (versioned, `DailyPlanItem.roadmapItemId` links
  plan→roadmap; sections/`availableTimeMin`) but **no daily-plan generator exists** — it is a deferred consumer
  layer. Roadmap V2 defines only the *candidate-supply* contract; the Daily Plan engine is out of scope here.

## 20. Teaching Engine contract (boundary)

- Roadmap hands the Teaching Engine a **point + its teaching blueprint references**; Teaching owns intra-point
  visuals/theory/examples/practice/writing/listening/reading/speaking/remediation and returns mastery +
  completion evidence.
- Roadmap consumes back only **outcomes** (completion, mastery result, per-skill evidence) — it does not model
  the micro path. See §6 boundary. Teaching Engine is **not** specified here.

## 21. Content availability

- Architecture supports A1–C2 now even though **only A1 content exists**; rollout is level-by-level.
- A point with no published teaching blueprint is `CONTENT_UNAVAILABLE` (an Availability value, §12): the
  system **shows/returns a clear unavailable state**, does **not** fabricate content, does **not** silently
  substitute A1, and does **not** corrupt progress (the point simply isn't actionable and doesn't count as
  learned).
- This mirrors Placement's honest degradation (`LEVEL_UNAVAILABLE`, placement §18.3): the macro spine stays
  visible; unavailable points are labeled, not hidden or faked (Scenario G).
- **Authority (audit M4).** Publish-ready teaching availability is owned by **Content Quality / published
  content state** (an approved/published Teaching Blueprint revision + all required content/media dependencies,
  Content Quality §45). Roadmap `CONTENT_UNAVAILABLE` is a **derived Availability projection** over that state —
  Roadmap **must not** maintain an independently editable content-availability truth; when publication or
  withdrawal changes, availability is **recomputed**. This is **teaching-content** availability, distinct from
  **placement/diagnostic** availability (Placement §18.3 `LEVEL_UNAVAILABLE`) — both derive from published-content
  state, not conflated.

## 22. Multi-subject compatibility

- The roadmap architecture is **subject-configurable**, not CEFR-hardcoded. English configures its levels as
  the CEFR ladder; other subjects define their own level/stage semantics:
  - Math: Foundations → Algebra → Geometry → …
  - History: era/period/topic progression.
- "Level", "point", "prerequisite", "point→skill expectation" are **generic** canonical-graph concepts;
  CEFR-specific meaning (A1..C2, level-exit policy) is English **subject configuration**. Do not encode CEFR
  into the engine core.

## 23. Versioning / provenance / audit

Everything the engine produces is **versioned and traceable**:
- **Canonical curriculum version** — the authored graph the projection was built from.
- **Learner roadmap generation/version** — each projection, with source (placement/checkpoint/reassessment),
  engine + policy version, `generatedAt`, active/superseded status.
- **Change provenance** — per change: type, payload, actor (SYSTEM/USER), and (for accepted AI proposals) the
  originating `LearnerRecommendation` (`RoadmapChange.recommendationId` must be ACCEPTED — existing invariant).
- **Durable facts** (completions, validations, evidence) reference their provenance and are immutable across
  regeneration.
- Auditability: one can reconstruct *why* any point is in any state, and *which* decision/version caused it.

## 24. Failure modes

| Failure | Mitigation |
|---|---|
| Faking completion to satisfy a prerequisite | Validation/policy satisfaction is a distinct fact; **never** writes `LearnerLessonCompletion`/XP/IZL (§10). |
| Blanket-validating a whole level from one diagnostic | Only measured points validate; cross-level satisfaction is an explicit versioned policy with provenance (§5/§10). |
| Restarting a level for a strong learner | Validated points are satisfied-skip; only weak areas become repair points (§13). |
| Regeneration erasing history | Projections supersede; completions/validations/evidence are durable (§17). |
| Silent AI roadmap mutation | AI changes flow through `LearnerRecommendation` (accepted) → `RoadmapChange` (provenance); no silent edits (§8). |
| Progress claiming un-studied lessons as done | Three separate progress concepts; validation → A/C, never B (§18). |
| Collapsing multi-state into one status | Three-axis point state (Acquisition/Availability/Attention) (§12). |
| Treating repair and review the same | Distinct provenance/states (§13/§14). |
| Fabricating unavailable content | `CONTENT_UNAVAILABLE` honest state (§21). |
| Roadmap re-deciding placement | Roadmap consumes `PlacementDecision`, never recomputes it (§7). |
| Baking scheduling into roadmap | Daily Plan boundary (§19). |

## 25. Edge cases

- **Start level content unavailable** → macro spine visible; start points `CONTENT_UNAVAILABLE`; no fabricated
  actionable roadmap (Scenario G).
- **Validated point later fails reassessment** → acquisition retains the historical validation fact but the
  point gains `REPAIR_REQUIRED`; provenance shows both.
- **Prerequisite satisfied by policy, then policy version changes** → prior satisfaction keeps its provenance
  (old policy version); new generations use the new policy — history not rewritten.
- **Learner abandons a point mid-study** → `IN_PROGRESS` persists; no partial completion fact; resumable.
- **Optional point** → never blocks progression or level exit; contributes to A/B/C only if engaged.
- **Concurrent regeneration** (e.g. checkpoint + reassessment near-simultaneous) → one active projection wins;
  the other supersedes cleanly (the V1 `ux_active_roadmap` single-active discipline generalizes to
  single-active-generation).
- **Uncovered skill/point** (no reachable eligible content) → surfaced honestly (V1 already returns
  `uncoveredSkillIds`), not silently dropped.

## 26. Required persisted concepts

Durable (survive regeneration): point **acquisition facts** (learned/validated) + provenance; completions
(`LearnerLessonCompletion`); evidence (`SkillMeasurement`); level-progression facts; change history
(`RoadmapChange`); recommendations (`LearnerRecommendation`).
Projection (versioned, supersedable): the learner roadmap generation (selected/ordered points, availability,
attention, repairs) + source decision + engine/policy version + `generatedAt` + active/superseded.
Canonical (authored): the curriculum graph (levels/sections/points/prereqs/expectations/blueprint refs) + its
version. **Exact tables/columns deferred (§27).**

## 27. Potential future schema changes (directional only — not a migration)

Additive, nullable-first, A1-compatible:
- **Canonical curriculum graph**: a point entity + point-prerequisite edges + point→skill expectation
  associations + point→teaching-blueprint refs + level/section grouping, all **versioned**. (New; today only
  the content container chain exists.)
- **Level as governed structure** for English (owner decision, placement §23) — the macro spine, not free-text
  `Level.code`.
- **Learner roadmap projection**: add generation/version + `engineVersion` + source + supersede status to
  `LearnerRoadmap` (today it has none); a point-state representation with the **three axes** (§12) replacing the
  single `RoadmapItemStatus` scalar; validation-fact rows (point + evidence + policy version) distinct from
  completion.
- **Prerequisite-satisfaction policy** + **level-exit policy** as versioned Methodist-owned config objects.
- Reuse `RoadmapChange`/`LearnerRecommendation`/`LearnerSignal`/`Checkpoint` as-is where possible (EXTEND).

## 28. Potential future API changes (additive)

- Generate/regenerate a roadmap projection from a `PlacementDecision`/checkpoint/reassessment (today only
  `POST /api/roadmaps/diagnostics/:attemptId/initial`).
- Read the **macro roadmap** (levels → sections → points with three-axis state) for visibility (§14).
- Read per-level and overall **progress** (A/B/C, §18).
- Supply Daily Plan **candidates** (next/repair/review + effort) (§19).
- Recommendation accept/decline (AI proposals → `RoadmapChange`) (§8).
- All additive; V1's initial-generation + reconcile endpoints keep working for A1.

## 29. V1 reuse / gap analysis

**What breaks if we implement V2 on the flat `RoadmapItem` list unchanged:**
- No level/point grouping → cannot render the A1→C2 spine, per-level progress, or "point" milestones
  (RoadmapItem is per-lesson).
- No validation-skip → a validated learner still gets every mapped lesson (candidate plan only omits lessons
  with an existing `LearnerLessonCompletion`; mastery merely re-orders). Restart-everything.
- Single `RoadmapItemStatus` scalar → cannot hold `LEARNED + REVIEW_DUE`, or distinguish `VALIDATED` vs
  `LEARNED`, or `REPAIR_REQUIRED` vs `REVIEW_DUE`.
- One `ACTIVE` roadmap, no `engineVersion`/generation/supersede → regeneration replaces and loses prior
  projection/provenance; history not preserved as required.
- Progress can only be lesson-count → conflates validated with studied (violates §18).
- Prereqs only per-lesson, satisfied only by completion → no point-level prereqs, no validation/policy
  satisfaction, no cross-level repair injection.
- No canonical-graph/projection split → no authority boundary for AI recommendations.

| Component | Verdict | Notes |
|---|---|---|
| `LearnerRoadmap` | **EXTEND** | keep per-(user,subject,track) + status + source provenance; **add** level/point structure link, `engineVersion`, generation/supersede, completion-or-validation semantics. |
| `RoadmapItem` (flat, per-lesson, single status) | **REPLACE / EXTEND** | introduce **point**-granular projection with three-axis state; per-lesson items become intra-point teaching refs, not the projection unit. |
| `LessonPrerequisite` | **REUSE (rescope)** | keep as within-point content ordering; **add** point-level prerequisites (NEW). |
| `LearnerLessonCompletion` | **REUSE** | completion authority; must **never** be fabricated by validation. |
| `GapRankingEngine` | **REUSE / EXTEND** | ranking kernel reused; extend to domain/level + repair-vs-review, not just ordering. |
| `RoadmapCandidateService` | **EXTEND / REPLACE** | lesson-mapping+prereq closure kernel reused; **must** traverse the point graph and honor validation-skip (today it only omits already-completed lessons). |
| `RoadmapChange` | **EXTEND** | exists, inert → regeneration/change provenance substrate. |
| `LearnerRecommendation` | **EXTEND** | exists, inert → AI-recommend-accept (D-13). |
| `DailyPlan` linkage | **REUSE** | models exist (`DailyPlanItem.roadmapItemId`); roadmap supplies candidates; generator out of scope. |
| `SkillMeasurement` | **REUSE** | evidence substrate (append-only); read-only for roadmap. |
| `LearnerSkillState` | **REUSE** | mastery/confidence/evidence; roadmap reads, never writes (single-writer merge stays). |
| `LearnerSignal` | **REUSE / EXTEND** | `REVIEW_DUE`/`REPEATED_MISTAKE`/`categoryCode` → review vs repair attention. |
| `Checkpoint` | **REUSE** | module-scoped checkpoints → level/section exit evidence. |

## 30. Scenarios

**A — Completely new.** No diagnostic. Full A1→C2 macro spine visible; progress 0%; first A1 point `AVAILABLE`;
future points visible but `LOCKED`; nothing validated. (Placement `FRESH_START`.)

**B — B2 claim, accepted with repairs.** Placement: Grammar 91, Vocabulary 88, Reading 90, Listening 72. →
Strong areas `VALIDATED` where evidence supports; **listening-related B2 repair points** `REPAIR_REQUIRED`
inserted; **do not restart B2**. Study placement at B2; not a certificate.

**C — High B2 + C1 challenge 61.** B2 strongly validated; C1 challenge = 61. → Preserve B2 validation; preserve
C1 evidence (append-only, separate attempt); start near the **B2→C1 transition**; insert C1
prerequisite/repair points; **erase neither diagnostic**.

**D — Lower prerequisite gap.** Studying B2; system discovers a weak **B1** prerequisite. → Insert/activate a
targeted **B1 repair** point; **block only the dependent B2 point(s)**; **do not reset** the roadmap.

**E — Validation vs completion.** Placement validates a point. → Roadmap treats the prerequisite satisfied;
**no `LearnerLessonCompletion`, no lesson XP, no lesson IZL, no fake time-spent**; the point shows
`VALIDATED`, and any genuinely weak sibling (e.g. Conditionals) still enters the required path.

**F — Reassessment after learning.** Learner has completed points, validated points, and review history.
Reassessment produces new gaps. → Regeneration **preserves** all historical completion/validation provenance,
**adds/changes** recommendations and repairs, and **does not rewrite** prior facts (new generation supersedes;
old retained).

**G — Missing B2 content.** Learner qualifies for B2 but B2 content is unpublished. → Roadmap reports
`CONTENT_UNAVAILABLE` honestly; the B2 spine is visible but not actionable; **no fabricated execution**, no A1
substitution, no corrupted progress.

## 31. Acceptance criteria

1. The full A1→C2 macro spine is retrievable and renders even when later levels are `LOCKED`/`CONTENT_UNAVAILABLE`
   (Scenario A/G); a new learner sees the whole road at 0%.
2. Roadmap consumes a `PlacementDecision` (never recomputes placement) and records its version/provenance on
   derived elements (§7).
3. Validated points are satisfied-skipped with provenance and produce **zero** `LearnerLessonCompletion`/XP/IZL
   /time (Scenario E); a fabricated completion is a hard test failure.
4. No blanket validation: only measured points validate; cross-level prerequisite satisfaction is an explicit
   versioned policy with provenance (Scenario B/C; §5/§10).
5. Point state is multi-axis: `LEARNED + REVIEW_DUE` and `VALIDATED + REPAIR_REQUIRED` are representable (§12).
6. Targeted repair (not restart) for weak areas; prerequisite-gap repair blocks only dependent points
   (Scenario B/D); repair and review are distinct (§13/§14).
7. Regeneration preserves all durable facts and provenance; prior projection is superseded, not deleted
   (Scenario F; §17).
8. Progress exposes A/B/C separately; validation never inflates "lessons completed" (§18).
9. Daily Plan gets candidates only; no scheduling logic in roadmap topology (§19).
10. Content-unavailable points are honest (`CONTENT_UNAVAILABLE`), never fabricated (Scenario G; §21).
11. No V1 regression: the A1 initial-generation + reconcile flow behaves identically for single-level content.
12. Canonical graph is authoritative; AI adjustments flow through accepted `LearnerRecommendation` →
    `RoadmapChange`; no silent mutation (§8/§23).

## 32. Open questions (deferred — do not invent final answers)

Genuinely open (owner):
- Exact progress percentage formula(s) for A/B/C and their weighting of validated vs learned.
- Exact schema/table/enum names (canonical point graph, three-axis point state, projection/version rows).
- Exact point-status enum shape.
- Exact CEFR level-exit thresholds / required-point sets per level.
- Exact estimated-duration algorithm.
- Exact regeneration frequency / triggers (which checkpoints/signals force a regeneration).
- Exact number of roadmap points per level (a content-authoring decision).
- The **prerequisite-satisfaction policy** contents (which higher-level competencies satisfy which lower
  prerequisites).

Recommended architectural direction is given inline (three-axis state, projection-over-facts progress,
versioned policies, canonical/projection split, reuse of `RoadmapChange`/`LearnerRecommendation`/`Checkpoint`/
`LearnerSignal`); numeric/nomenclature choices remain owner/Methodist decisions.
