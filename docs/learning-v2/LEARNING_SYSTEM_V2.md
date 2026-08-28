# Learning System V2 — Architecture Overview

> **Status:** SPECIFICATION / ARCHITECTURE ONLY. No code, schema, migration, endpoint, or V1 behavior
> change is implied by this document. The current CONTROLLED_RC release (English A1, single diagnostic)
> remains the running system and is untouched.
>
> **Scope of this document:** the umbrella picture — the engines that make Izlan a real self-study teaching
> system, and how they connect. **All six V2 architecture layers are now specified in depth:** the **Placement
> Engine** (see [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md)), the **Roadmap Engine** (see
> [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md)), the **Teaching Engine** (see
> [`TEACHING_ENGINE_V2.md`](./TEACHING_ENGINE_V2.md)), the **Skills Engine** (see
> [`SKILLS_ENGINE_V2.md`](./SKILLS_ENGINE_V2.md)), the **Mastery & Review Engine** (see
> [`MASTERY_REVIEW_ENGINE_V2.md`](./MASTERY_REVIEW_ENGINE_V2.md)), and the **Content Quality System** (see
> [`CONTENT_QUALITY_SYSTEM_V2.md`](./CONTENT_QUALITY_SYSTEM_V2.md)).
>
> **Architecture/specification complete ≠ V2 implemented.** These documents define the target architecture; no
> V2 runtime, schema, or endpoint has been built, and V1 / CONTROLLED_RC remains the running system.
>
> **Grounding.** This builds on the accepted product decisions (`docs/PRODUCT_DECISIONS.md` D-01…D-43) and
> the existing implementation (`src/assessment/**`, `src/skill-profile/**`, `src/roadmap/**`,
> `src/learning-progress/**`, `prisma/schema/{content,learning}.prisma`). Where it extends them it says so;
> it does not restate the superseded original brief (`loyiha.md`, S-01…S-07).

---

## 1. Why V2 exists

V1 delivers the spine of the accepted architecture (D-01): `Assessment → Skill Profile → Roadmap → Lesson →
Mastery`. But as built it behaves close to the shape the owner explicitly rejects —
*placement → result → lesson → test → next lesson* — because three things are missing:

1. **No level structure.** Content has a `Level` container (`Track → Level → Module → Topic → Lesson`), but
   skills, evidence, and placement carry **no CEFR/level** (`Skill` is flat and subject-scoped;
   `LearnerSkillState.displayLevel` is `null` in v1). There is no A1→C2 ladder a learner can be placed on.
2. **No teaching depth inside a topic.** A lesson is a static ordered list of activities. There is no
   *micro learning path* (concept → visual → rule → recognition → production → mastery) modeled as a
   learner-adaptive sequence.
3. **Placement decides nothing.** It emits per-skill evidence only; it does not say *where to start*, *what to
   skip*, or *what to repair*. The roadmap then includes every mapped lesson regardless of demonstrated
   mastery (mastery only re-orders, never skips).

V2 closes these three gaps. This document frames the whole; the Placement Engine spec starts the work because
every downstream engine depends on a placement output rich enough to act on.

---

## 2. The engine hierarchy

```
                       ┌─────────────────────────────────────────────┐
   learner entry  ───▶ │  PLACEMENT ENGINE   (specified in depth now) │
                       │  claimed/new/unsure → diagnostics → decision │
                       └───────────────┬─────────────────────────────┘
                                       │  PlacementDecision (contract §15 of the placement spec)
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  ROADMAP ENGINE     (macro + micro)          │
                       │  levels → modules/topics → learning paths    │
                       └───────────────┬─────────────────────────────┘
                                       │  RoadmapItem stream / DailyPlan
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  TEACHING ENGINE    (inside one roadmap point)│
                       │  concept → practice → production → mastery   │
                       └───────────────┬─────────────────────────────┘
                                       │  attempts, answers, mastery tests
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  SKILLS ENGINE      (evidence attribution)   │
                       │  per-skill + per-domain + per-level evidence │
                       └───────────────┬─────────────────────────────┘
                                       │  SkillMeasurement (append-only)
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  MASTERY / REVIEW ENGINE                     │
                       │  merge → LearnerSkillState, decay, review-due│
                       └───────────────┬─────────────────────────────┘
                                       │  weak-skill signals feed back ↑ roadmap & placement (reassessment)
                                       ▼
                       ┌─────────────────────────────────────────────┐
                       │  CONTENT QUALITY SYSTEM  (cross-cutting)     │
                       │  "did the material teach it?" not "learner   │
                       │  failed" — flags weak explanations           │
                       └─────────────────────────────────────────────┘
```

Each engine below is a **contract sketch only** — inputs, outputs, and the single biggest open question. None
is specified for implementation here except Placement.

### 2.1 Placement Engine — *specified now*
Decides **where the learner starts**. Turns entry context + diagnostic evidence into a structured
`PlacementDecision`. Full spec: [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md).

### 2.2 Roadmap Engine — *specified now*
Turns a `PlacementDecision` into a personalized, versioned journey over a macro A1→C2 spine of pedagogical
**points**, honoring validation-skip, targeted repair, prerequisites, and regeneration-without-history-loss.
Full spec: [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md).
- **In:** `PlacementDecision` (demonstrated level, validated areas, weak areas, prerequisite gaps,
  recommended start/repairs) — consumed, never recomputed.
- **Out:** a versioned **learner roadmap projection** over a Methodist-authored **canonical curriculum graph** —
  points with multi-axis state (acquisition/availability/attention), validated-area skips, inserted repair, and
  Daily-Plan candidates (never scheduling).
- **Central redesign:** V1's flat single-`ACTIVE` `RoadmapItem` list cannot express levels/points, validation-
  skip (it only omits already-*completed* lessons, never lessons placement deems *known*), multi-axis state, or
  regeneration history — see the spec's §29 gap analysis.

### 2.3 Teaching Engine — *specified now*
Owns *how* a point is taught: a Methodist-authored **Teaching Blueprint** driving a micro path that teaches,
checks understanding early, **diagnoses misconceptions**, remediates with contrasting examples, scaffolds
practice from recognition to production across skills, and emits recognition-vs-production evidence. Full spec:
[`TEACHING_ENGINE_V2.md`](./TEACHING_ENGINE_V2.md).
- **In:** one roadmap point + its pinned blueprint revision.
- **Out:** a taught session emitting attempts + mastery evidence (recognition vs production, scaffold usage,
  misconception signals) — never scheduling, never re-deciding the point.
- **Central redesign:** today a lesson is present-and-test — the whole `Activity[]` shown at once, only
  objective (`single/multiple/true_false`) items answerable, deterministic score → next, no
  checks/remediation/hints/productive-listening-reading-speaking and no teaching-session lifecycle (spec §34
  gap analysis).

### 2.4 Skills Engine — *specified now*
The shared vocabulary of ability every other engine speaks: subject **domains**, skills with a primary domain,
**skill↔level expectations** (not one owning level), a typed **evidence taxonomy** (recognition vs production,
independence, exposure≠evidence, NOT_ASSESSED≠0), and domain/level **projections over evidence**. Full spec:
[`SKILLS_ENGINE_V2.md`](./SKILLS_ENGINE_V2.md).
- **In:** attempts/answers from Teaching + Placement.
- **Out:** append-only `SkillMeasurement` evidence, attributed via `ActivitySkill`/`LessonSkill`.
- **V2 extension (owner decisions):** attribution must roll up to two new dimensions `Skill` cannot express
  today:
  - **Domain** — first-class and **subject-scoped** (English: Grammar, Vocabulary, Reading, Listening, Writing,
    Speaking, Pronunciation; other Subjects define their own — **no** architecture-wide English-only enum). A
    skill has a **primary diagnostic domain**; cross-domain work is modeled as **multiple skills**, not one
    score spread across domains.
  - **CEFR level via association, not a single owning level** — a skill is *introduced* at one level and
    *expected/reinforced/assessed* at later levels (Present Simple: introduced A1, still assessed at B2). The
    model is a **skill↔level association** (introduced/expected/reinforced/validation-expectations), not
    `Skill.levelId`.
  This domain+level roll-up is the pivotal shared dependency between Placement and Roadmap. Exact schema is
  deferred.

### 2.5 Mastery / Review Engine — *specified now*
Decides whether a skill/point is sufficiently demonstrated (with what evidence kind + independence), whether the
knowledge is still fresh, and when/what to review — separating **demonstrated mastery** (durable) from
**retention/freshness** (current). Full spec:
[`MASTERY_REVIEW_ENGINE_V2.md`](./MASTERY_REVIEW_ENGINE_V2.md).
- **In:** append-only `SkillMeasurement` evidence (kind/independence-aware in V2).
- **Out:** recomputed current projection (mastery + freshness + sufficiency + misconception), point-mastery
  evaluations, and prioritized review candidates for Daily Plan.
- **Reuse + rework:** V2 keeps the **single-writer recompute discipline** (`LearningProgressService`) and
  append-only evidence, but the **merge blending needs rework** — today it drops pre-anchor evidence, blends all
  evidence kinds into one `masteryScoreBp`, and lets review recall (confidence hard-coded 10000) move mastery
  like a lesson; historical evidence must never decay (spec §29 risk analysis).

### 2.6 Content Quality System (cross-cutting) — *specified now*
Governs how content becomes trustworthy — research → provenance → multidimensional review → publish → post-
publication feedback → correction — with **pedagogical hard blockers that override any average score**, and
strict boundaries (authoring research ≠ runtime authority; AI never self-publishes; automated validity ≠ human
pedagogical approval). Full spec: [`CONTENT_QUALITY_SYSTEM_V2.md`](./CONTENT_QUALITY_SYSTEM_V2.md).
- Encodes pedagogical principle #8: *if the material failed to explain a concept, don't automatically blame the
  learner.* When many learners miss the same item after the same explanation, flag the **content**, not the
  cohort — a quality **signal that triggers review, never an auto-edit** of canonical content.
- Consumes signals from Teaching / Mastery-Review / Placement (per-item, per-explanation miss rates,
  misconception distributions); today V1 validates only **structure** (`PublicationReadinessService`), so
  factual/pedagogical/alignment/mastery/localization/provenance review is the V2 build.
- **Mistake taxonomy is Methodist / verified-content owned** (owner decision): the canonical set of error
  categories is authored by Methodists (verified content = authority, D-05). **AI may classify** a learner's
  error into an *approved* category and personalize the explanation, but **must not silently invent new
  canonical categories.** This powers the future Teaching Engine feedback loop: *wrong answer → determine the
  likely misunderstanding → explain **why** → give a simpler rule/example → immediately re-check in a different
  example.* Ownership is decided; only the taxonomy's **initial contents** remain to be authored.

---

## 3. Macro roadmap vs micro roadmap

The owner's central structural requirement. V2 separates two planning altitudes that V1 conflates into one
flat `RoadmapItem.position` list.

### 3.1 MACRO roadmap — the level ladder
```
English (Subject)
  └─ Track (learning goal: General English / IELTS / …)
       └─ A1 → A2 → B1 → B2 → C1 → C2        ← the CEFR ladder (macro roadmap points)
            └─ Module → Topic                ← a macro point resolves to modules/topics
```
- **For English, the CEFR ladder A1→C2 is a first-class product spine** (owner decision), not display metadata.
  `Track` still represents goals (General English / IELTS / Speaking Focus); for **General English the CEFR
  progression is the canonical learning spine**. A macro roadmap point ≈ a **CEFR level** (or a module inside
  it). Placement's `recommendedStart` names a macro point; `validatedAreas` can mark earlier macro points
  **satisfied** — as *validation*, never as fake completion (§4a).
- **Today (compatibility history, not the V2 target):** the `Level` container exists but is **free-text display
  data** (`Level.code`, "enum EMAS — data", TD-27) with no skill mapping and no learner-level progression
  object. That free-text behavior is **V1 compatibility history**; V2 makes the English ladder **real,
  governed, ordered structure**. The macro ladder has **no home model yet** — this is a V2 build. Exact schema
  is deferred (see the placement spec §23).

### 3.2 MICRO roadmap — the learning path inside one point
For a single point, e.g. *Present Simple*:
```
concept → visual explanation → rule → examples →
recognition → sentence building → guided writing →
listening → reading → speaking → mixed practice → mastery check
```
- This is the **Teaching Engine's** domain. It turns a topic into a taught path with recognition-before-
  production ordering and per-stage evidence.
- **Today:** a lesson is a flat `Activity[]` (types: `TEXT | EXPLANATION | EXAMPLE | MINI_QUESTION | PRACTICE |
  MASTERY_TEST`). The micro stages are not modeled as adaptive units; the A1 pilot hand-authors this sequence
  per lesson. V2 formalizes it — deferred beyond the placement spec.

> V2 does **not** attempt to fully specify the Teaching/Roadmap micro engines yet. Placement Engine V2 is the
> first deep specification because it produces the contract everything downstream consumes.

---

## 4. What V2 keeps, extends, and must build (system level)

| Layer | V1 today | V2 |
|---|---|---|
| Evidence substrate | `SkillMeasurement` (append-only) → `LearnerSkillState` merge, integer bp | **REUSE** — the substrate is correct; V2 adds roll-up dimensions, not a rewrite |
| Skill identity | `Skill` flat, subject-scoped, no domain/level | **EXTEND** — add domain + CEFR-level association (the shared blocker) |
| Placement output | evidence-only counts; `displayLevel` null; no decision | **REPLACE the boundary** — add a `PlacementDecision` projection (placement spec §15) |
| Level ladder (macro) | `Level.code` free-text, no learner progression | **NEW** — macro roadmap model |
| Learning path (micro) | flat `Activity[]` per lesson | **NEW** — Teaching Engine (deferred) |
| Roadmap | flat `RoadmapItem.position`, no skip/level grouping | **EXTEND** — consume decision, honor validated-skip, group by level |
| Content coverage | A1 only (13 skills, 12 lessons) | **NEW content** — A2–C2 authoring (Methodist work, not engine work) |

---

## 4a. Validated-by-assessment ≠ completed-by-learning

A system-wide semantic distinction (owner decision) that both the Placement→Roadmap contract and the
Roadmap/Mastery engines must honor:

- **`COMPLETED_BY_LEARNING`** — the learner actually worked through a roadmap point's activities (today's
  `LearnerLessonCompletion`, with its XP / IZL / time-spent side effects).
- **`VALIDATED_BY_ASSESSMENT`** — placement/assessment evidence shows the competency is already held, so the
  point may be **satisfied without study**.

Rules:
- Testing out **must not fabricate learning history**: no lesson-completion XP, no IZL, no time-spent, no
  pretend-executed activities, no synthetic `LearnerLessonCompletion` rows. (This also protects reward
  integrity — IZL is earned only through real learning, D-25 — and anti-farming sequencing, D-27.)
- Roadmap V2 **may** treat a `VALIDATED_BY_ASSESSMENT` marker as satisfying a prerequisite / skipping a point —
  a **distinct state** from "completed".
- Exact enum/table names are deferred; the *distinction* is fixed. See the placement spec §15a and Scenario E.

## 5. Cross-cutting principles (apply to every engine)

Carried from the owner's pedagogical principles and accepted decisions (D-05, D-12, D-13, D-14):

1. **Purpose over label** — every engine exists to decide *what to learn next*, not to attach a badge.
2. **Evidence, not vibes** — learner state lives in structured backend evidence (`SkillMeasurement`), never in
   LLM conversation memory (D-14).
3. **Absence of evidence ≠ failure** — "not assessed" is a first-class value, never coerced to 0 (critical for
   speaking/writing, which V2 must not fake).
4. **Verified content is the authority; AI assists** (D-05/D-13) — AI never silently changes a plan.
5. **Determinism where possible** (D-12) — closed-answer scoring is deterministic; AI only where a rubric
   genuinely needs it.
6. **Non-punitive framing** — high scores *unlock opportunity*, they do not force advancement; low scores
   trigger *support*, not a "failed" label.
7. **Explain the why** — feedback teaches the reasoning, and when many learners miss the same well-explained
   item, the Content Quality System questions the *material*, not the learner.

---

## 6. Relationship to the current release (compatibility)

- CONTROLLED_RC (English A1) keeps running unchanged. The current single diagnostic becomes, conceptually, the
  **A1 level diagnostic** under V2's multi-level model.
- The **new-learner path** ("I am completely new") is essentially today's flow (start at A1) plus macro-roadmap
  generation — the lowest-risk V2 slice.
- Every V2 extension (domain/level associations, `PlacementDecision`, macro model) is designed to be
  **additive and nullable-first**, so A1 keeps working while A2–C2 and the richer decision are built
  incrementally.
- **Design for A1–C2 now; roll out level-by-level** (owner decision). Missing A2–C2 content must not weaken the
  architecture. When a learner claims a level whose diagnostic/content is not published, the product **says so
  honestly** — it never silently substitutes A1 or fabricates a result (placement spec §18.3, `LEVEL_UNAVAILABLE`).

See the Placement Engine spec's §24 (migration/compatibility) and §21–23 (reuse / can't-support / likely
schema+API changes) for the concrete, per-field plan.

---

## 7. Cross-engine source-of-truth contract (canonical)

> This is the **canonical cross-engine summary** produced by the reconciliation pass over
> `CROSS_ENGINE_CONSISTENCY_AUDIT.md` (findings M1–M7, m1–m5). Every engine spec follows it; detailed mechanics
> stay in the engine specs. **One canonical owner per concept; immutable fact vs recomputable projection kept
> distinct; one write-authority per truth; no competing mutable truth in another engine.** Schema/table/enum
> names remain deferred — this fixes ownership and semantics only.

### 7.1 Source-of-truth table

| Concept | Authoritative fact / owner | Derived view (recomputable) | Consumers |
|---|---|---|---|
| **Learner response** | immutable evidence fact (lesson-exec / assessment / review) | — | scoring, evidence |
| **`PlacementDecision`** | Placement — **immutable versioned decision** (recommended study level, validated/weak/prereq areas, policy+provenance) | — | Roadmap, UX, audit |
| **Assessment validation** | Placement decision (above) + the `SkillMeasurement` evidence behind it | — | Roadmap (records a point VALIDATION event, M1) |
| **`SkillMeasurement`** | **immutable append-only** evidence fact (+ kind/independence/derivationVersion) | — | Skills, Mastery |
| **Current `LearnerSkillState` / competence projection** | single-writer merge (`LearningProgressService`) | **projection** over measurements + policy | Placement, Roadmap, Mastery, UX |
| **Current domain / skill / level-expectation projection** | Skills — projection over evidence (+ Mastery evaluation) | **projection** | Placement, Roadmap, UX |
| **Mastery Requirement** | **Methodist / canonical curriculum content** — authored once, versioned (M6) | — | Content Quality (validate), Teaching (read), Mastery (evaluate), Roadmap (consume) |
| **Mastery evaluation** | Mastery & Review — versioned evaluation of evidence vs pinned requirement | **projection** (recomputable) | Roadmap |
| **`LearnerLessonCompletion`** | lesson-exec — **immutable per-lesson** completion fact (+XP/IZL/time) | — | Roadmap, rewards |
| **TeachingSession completion** | Teaching — **immutable per-session** terminal-state fact | — | Mastery, Roadmap |
| **Roadmap Point acquisition** (`LEARNED`/`VALIDATED`) | **Roadmap** — sole writer of the durable acquisition **event** (after Mastery eval / Placement validation), with provenance (M1/M2) | acquisition *state* view | UX, DailyPlan |
| **`REVIEW_DUE` / `REPAIR_REQUIRED` (Roadmap Attention)** | the underlying **signals/causes** (Mastery / Placement-prereq, with provenance) are the fact | **derived** Roadmap Attention over active signals + policy (M3) | UX, DailyPlan |
| **Content publication / readiness** | **Content Quality / published content state** (approved Blueprint revision + required deps) | — | Roadmap, Teaching, Placement |
| **Content availability projection** | derived from publication state (M4) | Roadmap `CONTENT_UNAVAILABLE`; Placement diagnostic-availability | UX |
| **Evidence-integrity decision** | **Content Quality** — immutable/versioned scoped decision (M7) | — | Skills/Mastery recompute; Placement/Roadmap regenerate |
| **Current evidence admissibility** | — | **derived** over evidence + integrity decisions + policy (M7) | Skills, Mastery |
| **Recommended study level** | Placement `PlacementDecision.recommendedStudyLevel` — **decision** (M5.A) | — | Roadmap, UX |
| **Roadmap curricular position** | Roadmap — progression state through the canonical path (M5.C) | projection | UX, DailyPlan |
| **`displayLevel`** | — | **cache/denormalized display projection only** (M5.D); never authoritative | UX |

### 7.2 Write-authority (one writer per truth)

Immutable facts are **appended, never mutated**: responses, `SkillMeasurement`, `LearnerLessonCompletion`,
TeachingSession completion, `PlacementDecision`, Roadmap acquisition events, Content-Quality integrity
decisions. Recomputable projections have **exactly one recompute owner**: `LearnerSkillState`/competence →
merge; domain/level projections → Skills; mastery evaluation → Mastery; Roadmap projection + Attention +
Availability → Roadmap; current admissibility → Skills/Mastery recompute (per CQ decision). **No engine writes
another engine's truth** — notably Content Quality **never** rewrites `LearnerSkillState`, `PlacementDecision`,
Roadmap acquisition, or Roadmap attention; it emits decisions the others *consume by recomputing* (M7).

### 7.3 The source-of-truth chain (M1–M7)

`Teaching → response/session fact (immutable) → scoring/eval → SkillMeasurement (immutable) → Skills evidence
semantics + current projection → Mastery evaluates the pinned Mastery Requirement → Roadmap applies the result
to point acquisition (event) + projection → Mastery/Placement/prereq produce actionable signals/reasons →
Roadmap derives Attention (REVIEW_DUE/REPAIR_REQUIRED) → Content Quality owns publication/quality/integrity
decisions → integrity decisions influence recomputation without rewriting history.` There is **no competing
writer for any single truth**.

### 7.4 Naming / terminology convention (conceptual, not schema)

To prevent overloaded words at implementation time, qualify concepts by role (these are *semantics*, not
required suffixes):
- **…Decision** — a versioned decision an owning engine made at a time (`PlacementDecision`, integrity
  decision).
- **…Event / historical fact** — an immutable record that something occurred (completion, acquisition event).
- **…Measurement / Evidence** — an immutable observed/evaluated evidence fact (`SkillMeasurement`).
- **…Projection** — a recomputable current interpretation (`LearnerSkillState`, domain/level projection,
  attention, availability, current admissibility).
- **…Signal** — an actionable interpretation with reason/category/**provenance**/lifecycle (`LearnerSignal`).
- **…Requirement / Policy** — a versioned canonical rule (Mastery Requirement, threshold/quality policy).
- **…Revision** — an immutable published content/config revision (`LessonRevision`, Blueprint revision).

**Never use unqualified** *level · mastery · validation · confidence · completion · availability · review ·
repair* inside an engine/persistence contract — always say *which* (e.g. "recommended **study** level" vs
"current competence **projection**" vs "curricular **position**"; "`confidenceBp` = evidence **coverage**", not
certainty).

### 7.5 State families (keep distinct — never collapse)

Distinct dimensions that may share adjectives; qualify in prose whenever a word recurs:
content **revision status** · Teaching **session status** · Roadmap **acquisition** (`LEARNED`/`VALIDATED`) ·
Roadmap **availability** (`AVAILABLE`/`LOCKED`/`CONTENT_UNAVAILABLE`) · Roadmap **attention**
(`REVIEW_DUE`/`REPAIR_REQUIRED`) · assessment/evidence **sufficiency** (`NOT_ASSESSED`/`INSUFFICIENT_EVIDENCE`/
`SUFFICIENTLY_ASSESSED`) · **current competence** projection · **retention/freshness** · **review session**
state · **misconception signal** state · content **quality-review** state · **quality-issue** lifecycle ·
**evidence-integrity decision** / current **admissibility**. A value from one family must never be stored on
another family's axis.
