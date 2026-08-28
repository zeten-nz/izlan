# Learning System V2 — Architecture Overview

> **Status:** SPECIFICATION / ARCHITECTURE ONLY. No code, schema, migration, endpoint, or V1 behavior
> change is implied by this document. The current CONTROLLED_RC release (English A1, single diagnostic)
> remains the running system and is untouched.
>
> **Scope of this document:** the umbrella picture — the engines that make Izlan a real self-study teaching
> system, and how they connect. Only the **Placement Engine** is specified in depth (see
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md)). Every other engine here is described at contract
> altitude only; each earns its own deep spec later.
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

### 2.2 Roadmap Engine
- **In:** `PlacementDecision` (demonstrated level, validated areas, weak areas, prerequisite gaps,
  recommended start/repairs).
- **Out:** an ordered plan that honors validated-area **skips**, injects **repair** work for weak areas, and
  respects prerequisites — expressed as `RoadmapItem`s and (later) a `DailyPlan`.
- **Biggest open question:** how validated areas translate into *skipping whole levels/modules* given today's
  strict `LessonPrerequisite` DAG, which has no cross-level edges and no placement-out mechanism (roadmap
  currently only omits lessons the learner already *completed*, never lessons placement deems *known*).

### 2.3 Teaching Engine
- **In:** one roadmap point (a topic / learning path).
- **Out:** the **micro learning path** — an adaptive sequence within the point (see §3), emitting attempts and
  mastery evidence.
- **Biggest open question:** none of the micro-path stages (recognition vs production vs guided writing) are
  modeled as distinct, adaptively-sequenced units today; `Activity` is a flat typed list under a
  `LessonRevision`.

### 2.4 Skills Engine
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

### 2.5 Mastery / Review Engine
- **In:** `SkillMeasurement` history.
- **Out:** merged `LearnerSkillState` (`masteryScoreBp`, `confidenceBp`, `evidenceCount`) + review-due signals.
- **Reuse:** the single-writer merge (`LearningProgressService`, anchors = DIAGNOSTIC/CHECKPOINT) is sound and
  V2 keeps it. **Open:** no decay/half-life field exists yet (needed for "knowledge fades" review).

### 2.6 Content Quality System (cross-cutting)
- Encodes pedagogical principle #8: *if the material failed to explain a concept, don't automatically blame the
  learner.* When many learners miss the same item after the same explanation, flag the **content**, not the
  cohort. Feeds Methodist review. **Fully deferred** — named here only so the other engines emit the signals
  (per-item, per-explanation miss rates) it will later consume.
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
