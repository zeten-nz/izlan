# V2 Data Model — Phase 3 (Prisma Schema Change Plan)

> **Status:** DESIGN / DOCUMENTATION ONLY. **No** Prisma schema edit, migration, `migrate`/`db push`/`generate`,
> runtime, API, test, or deploy change. This plan makes the persistence contract **mechanical** for Phase 4: the
> next phase can write Prisma models + SQL migrations from these tables without making a new architectural
> decision.
>
> **Inputs (read in full):** `DATA_MODEL_V2.md` (Phase 1), `DATA_MODEL_V2_PERSISTENCE_PLAN.md` (Phase 2), the six
> engine specs + `CROSS_ENGINE_CONSISTENCY_AUDIT.md`, and the verified V1 schema
> `prisma/schema/{schema,content,learning,core,finance,community}.prisma` + `prisma/migrations/*` +
> `prisma/migrations/_custom_constraints.reference.sql`.
>
> **Ownership / source-of-truth architecture is CLOSED.** The seven Phase-2 structural decisions are LOCKED
> (§0). Nothing here reopens them. Exactly one decision that Phase 2 left under-specified — **canonical
> roadmap-graph versioning** — is *resolved* here (§12) because Phase 1 §18 already required it and Phase 4 cannot
> proceed without it; this is a within-SQ2 persistence refinement, **not** an ownership change.
>
> **No Prisma syntax blocks.** Contracts are field tables; a Phase-4 author translates them to Prisma.

---

## Repository conventions reused (verbatim, do not reinvent)

Confirmed by reading the live schema; every new model MUST follow these:

- **PK:** `id String @id @default(uuid(7)) @db.Uuid` (all tables).
- **snake_case** table + column via `@map` / `@@map`. Tables are singular-ish snake (`skill_measurement`).
- **Timestamps:** `createdAt DateTime @default(now()) @map("created_at")`; `updatedAt DateTime @updatedAt
  @map("updated_at")` (no explicit `@db.Timestamptz` in V1 — match that; DateTime → `timestamp(3)`).
- **Actor columns:** `createdBy String @map("created_by") @db.Uuid` + `createdByUser User @relation("XCreatedBy",
  …, onDelete: Restrict)`; reviewer/publisher use `@map(...) @db.Uuid` + `onDelete: SetNull` (see `LessonRevision`).
- **Circular current/published pointer:** `publishedRevisionId String? @unique @map("...") @db.Uuid` + two
  **named relations** (`"XPublishedRevision"` for the pointer, `"XRevisions"` for the children), pointer
  `onDelete: Restrict` (see `Lesson.publishedRevisionId`, `AssessmentDefinition.currentVersionId`).
- **Basis points:** `Int`, range enforced by custom-SQL CHECK `BETWEEN 0 AND 10000` (see `chk_sm_score_bp`).
- **XOR of typed nullable FKs:** custom-SQL CHECK `(("a" IS NOT NULL)::int + ("b" IS NOT NULL)::int) = 1` (see
  `chk_aieval_xor`, `chk_mission_evidence_xor`).
- **"One active/current" invariant:** partial unique index `CREATE UNIQUE INDEX ... WHERE status = '…'` (see
  `ux_active_roadmap`, `uq_review_session_active`).
- **Idempotency:** partial unique on the **natural provenance key** `WHERE <provenance> IS NOT NULL` (see the 3
  `uq_skill_measurement_*_idempotency` indexes). Never a random UUID.
- **Nonempty string CHECK** for load-bearing version/policy strings (see `chk_sm_derivation_version_nonempty`).
- **Custom SQL location:** each migration's `migration.sql`; the canonical catalogue is
  `prisma/migrations/_custom_constraints.reference.sql`. Constraint naming: `chk_*` (CHECK), `uq_*`/`ux_*`
  (partial unique index). **Prisma has zero DB triggers today** — immutability is app-enforced + `Restrict`.
- **Multi-file schema:** `prisma/schema/` already holds 6 fragments read by one generator (Prisma 7 folder
  mode). Adding a 7th fragment needs **no tooling change** (§5).
- **onDelete house rule (archive-first):** `Restrict` for canonical/published/history refs; `Cascade` only for a
  child owned exclusively by a mutable/append parent; `SetNull` for optional operational/cache linkage.

---

## 0. Locked Structural Decisions (all LOCKED — not reopened)

| # | Decision | Status |
|---|---|---|
| **SQ1** | Reuse current `Level` as the canonical progression identity (no new ProgressionLevel; CEFR = `Level.code` data). | **LOCKED** |
| **SQ2** | `RoadmapPoint` belongs to `Level` with its own ordering + prerequisite graph and an optional `topicId`. | **LOCKED** |
| **SQ3** | `PointAcquisitionEvent` is authoritative history (keyed on canonical point) + `RoadmapPointProjection` materialized per roadmap generation. | **LOCKED** |
| **SQ4** | `MasteryRequirement` is point-owned, versioned canonical policy (immutable revisions). | **LOCKED** |
| **SQ5** | `EvidenceIntegrityScope` uses typed nullable FKs + exactly-one-target XOR. | **LOCKED** |
| **SQ6** | `SkillMeasurement` extended additively in place + `SkillMeasurementEvidenceRef` relational raw-evidence provenance. | **LOCKED** |
| **SQ7** | `TeachingSession` is additive V2 execution state; `LearnerLessonProgress` remains V1, untouched. | **LOCKED** |
| L-a | `TeachingBlueprintStage` = CORE relational (stage identity/order/type/branch within a pinned revision). | **LOCKED** |
| L-b | `MasteryEvaluationEvidence` = CORE relational (pins the exact `SkillMeasurement` set an evaluation used). | **LOCKED** |
| L-c | `PlacementDecisionValidation` = CORE relational (validated targets Roadmap consumes; never JSON). | **LOCKED** |
| L-d | Published `AssessmentItem` learner/scoring content is immutable (new-row-on-correction; app-enforced). | **LOCKED** |
| L-e | `AssessmentVersionItem` is usable as a **narrow** integrity scope (defect in one version's membership only). | **LOCKED** |
| L-f | `ENGINE_RECALC` is **not** recursive V2 learner evidence (merge-layer exclusion, app rule). | **LOCKED** |

**One resolved gap (not a reopen):** canonical roadmap-graph versioning → **stable `RoadmapPoint` + immutable
`RoadmapPointRevision`**, generations pin the point-revision (§12). Consistent with SQ2/SQ3 and Phase 1 §18.

---

## 1. Reading confirmation

Read in full: `DATA_MODEL_V2.md`, `DATA_MODEL_V2_PERSISTENCE_PLAN.md`, and (for grounding, carried from Phases
1–2) `LEARNING_SYSTEM_V2.md` §7, the five engine specs, `CONTENT_QUALITY_SYSTEM_V2.md`. Re-inspected live:
`schema.prisma` (all enums + datasource/generator), `learning.prisma`, `content.prisma`, `core.prisma`,
`finance.prisma`/`community.prisma` (boundary only), all 24 migrations, and `_custom_constraints.reference.sql`.
Conventions above are transcribed from that inspection.

---

## 2. Prisma file placement (task §5)

| Fragment | Gets | Why |
|---|---|---|
| `prisma/schema/schema.prisma` | **all new enums** | every shared enum already lives here (datasource/generator + enums fragment). |
| `prisma/schema/content.prisma` | `SubjectDomain`, `Skill` extension, `SkillLevelExpectation(+Revision)`, `RoadmapPoint(+Revision)`, `RoadmapPointPrerequisite`, `RoadmapPointSkillExpectation`, `TeachingBlueprint(+Revision)`, `TeachingBlueprintStage`, `TeachingBlueprintContentBinding`, `MasteryRequirement(+Revision)`, `MasteryRequirementSkillExpectation` | canonical Methodist-authored curriculum/policy — same layer as Subject→…→Activity + Skill. |
| `prisma/schema/learning.prisma` | `PlacementDecision(+Validation)`, `TeachingSession(+ContentPin)`, `ActivityAttempt` ext, `SkillMeasurement` ext, `SkillMeasurementEvidenceRef`, `MasteryEvaluation(+Evidence)`, `PointAcquisitionEvent`, `LearnerRoadmapGeneration`, `RoadmapPointProjection` | learner facts + derived roadmap projections — same layer as SkillMeasurement/ActivityAttempt/LearnerRoadmap. |
| `prisma/schema/quality.prisma` **(NEW fragment)** | `ContentQualityPolicyVersion`, `ContentBrief`, `SourceReference`, `ContentSourceProvenance`, `ContentReview`, `ContentQualityIssue`, `EvidenceIntegrityDecision`, `EvidenceIntegrityScope` | distinct authoring/governance domain; keeps `content.prisma` focused; the integrity models cross-reference content **and** assessment tables, so a dedicated fragment is cleaner than either. |

**New fragment is tooling-safe.** Prisma 7 folder mode already compiles 6 co-located `*.prisma` files under one
`generator`/`datasource`; a 7th is read automatically — **no** `prisma.config.ts` change, no generator change,
no `migration_lock.toml` change. (If Phase 4 prefers minimal surface, these 8 models MAY instead live in
`content.prisma`; the recommendation is the new fragment.) Enum-vs-fragment note: Prisma enums are global to the
schema regardless of fragment, so cross-fragment enum use (e.g. `RevisionStatus`) is already how V1 works.

---

## 3. Enum plan (task §6)

**NEW Prisma enums (recommended — each challenged):**

| Enum | Values | Stable enough? | Used by |
|---|---|---|---|
| `PointAcquisitionType` | `LEARNED`, `VALIDATED` | **Yes** — closed, XOR-checked provenance kinds. | `PointAcquisitionEvent.acquisitionType`; reused **nullable** as the projection acquisition cache. |
| `TeachingSessionStatus` | `NOT_STARTED`, `TEACHING`, `PRACTICING`, `REMEDIATING`, `MASTERY_CHECK`, `COMPLETED`, `ABANDONED` | **Yes** — a defined execution state machine (TD-90 "closed state machines are enums"); migration-extensible. | `TeachingSession.status`. |
| `MasteryEvaluationOutcome` | `SATISFIED`, `NOT_SATISFIED`, `INSUFFICIENT_EVIDENCE` | **Yes** — small, stable. | `MasteryEvaluation.outcome`. |
| `EvidenceIntegrityOutcome` | `VALID`, `UNDER_REVIEW`, `INVALIDATED`, `QUALIFIED` | **Yes** — small, stable. | `EvidenceIntegrityDecision.outcome`. |
| `SkillContributionRole` | `REQUIRED`, `SUPPORTING`, `OPTIONAL` | **Yes** — small, stable; **shared**. | `RoadmapPointSkillExpectation.role`, `MasteryRequirementSkillExpectation.role`. |
| `BlueprintBindingRole` | `TEACH`, `PRACTICE`, `EVIDENCE`, `EXPOSURE` | **Yes** — small, stable. | `TeachingBlueprintContentBinding.role`. |
| `PlacementValidationKind` | `EVIDENCE_BACKED`, `POLICY_PREREQ` | **Yes** — small; migration-extensible. | `PlacementDecisionValidation.validationKind`. |
| `PlacementValidationTargetKind` | `EXPECTATION_REVISION`, `ROADMAP_POINT` | **Yes** — XOR discriminator. | `PlacementDecisionValidation.targetKind`. |
| `RoadmapGenerationStatus` | `CURRENT`, `SUPERSEDED` | **Yes** — 2-state lifecycle (values coincide with `DailyPlanStatus` but **not reused** — cross-domain enum reuse is a coupling smell; V1 already defines per-domain status enums with coinciding values). | `LearnerRoadmapGeneration.status`. |
| `RoadmapAvailabilityState` | `LOCKED`, `AVAILABLE`, `IN_PROGRESS`, `CONTENT_UNAVAILABLE` | **Yes** — small; stored only as a **derived cache**. | `RoadmapPointProjection.availability`. |
| `RoadmapAttentionState` | `NONE`, `REVIEW_DUE`, `REPAIR_REQUIRED` | **Yes** — small; stored only as a **derived cache**. | `RoadmapPointProjection.attention`. |

**Deliberately NOT Prisma enums (string registry / lookup / ordinal — conservative refinement of Phase 2 §6):**

| Vocabulary | Persistence | Why NOT an enum |
|---|---|---|
| `evidenceKind` (recognition / controlled-production / free-production / review-recall / listening / reading …) | **string registry** column, app-validated (like V1 `categoryCode`, `missionCode`, `changeType`) | pedagogical/semantic axis that **expands per subject**; promoting to enum later is a migration if it proves closed. |
| `independenceLevel` / `minIndependence` | **`smallint` ordinal** (0=guided … 2=independent) + range CHECK | gates do numeric `>=` comparisons; an ordinal integer is cleaner than an enum and directly comparable between measurement and requirement. |
| `stageType` (concept/visual/rule/example/check/production/…/mastery/review) | **string registry** column, app-validated | large + pedagogically evolving + subject-specific; a closed enum would churn. |
| `scopeKind` (integrity) | **string registry** or lookup | new scope kinds added deliberately; but the **target itself is a typed FK** (§25), so `scopeKind` is only a label. |
| CEFR levels `A1…C2` | **DATA** (`Level.code`) | multi-subject owner decision (SQ1) — never an enum. |
| subject **domains** | **lookup rows** (`subject_domain`) | subject data, evolves. |
| policy versions (placement/mastery/review/quality/derivation) | **version-string columns + JSONB config** | tuning knobs; already the V1 pattern (`derivationVersion`, `policy_version`). |

**Reused existing enums:** `RevisionStatus` (`SkillLevelExpectationRevision`, `TeachingBlueprintRevision`,
`MasteryRequirementRevision`, `RoadmapPointRevision`, `ContentReview` gate? no — see §27); `ContainerStatus`
(`RoadmapPoint`, `TeachingBlueprint`, `MasteryRequirement`, `ContentBrief` identity lifecycle);
`SkillStatus` (`SubjectDomain.status`); `SignalStatus` shape (misconception — LATER, not built now).

**QF enums (Wave E, kept minimal):** `ContentReviewOutcome` {`APPROVED`,`CHANGES_REQUESTED`,`BLOCKED`};
`ContentQualityIssueStatus` {`OPEN`,`UNDER_REVIEW`,`RESOLVED`,`DISMISSED`}. (Deferred detail — not on the
single-point critical path.)

---

## 4. Field-contract legend

Field tables use: **Field** · **Prisma type** · **DB** (`@db.*` where non-default) · **Null** · **Default** ·
**@map** · **Rel/onDelete** · **Notes**. `uuid(7)` PK + `created_at`/`updated_at` per conventions are **implied**
and only listed when they carry a rule. "Imm" = immutable after publish/create. No Prisma syntax appears.

---

## 5. SubjectDomain + Skill extension (task §7)

**`SubjectDomain`** → `@@map("subject_domain")` · content.prisma · Wave A · write owner **Methodist** ·
lifecycle: mutable metadata, `ARCHIVED` not deleted.

| Field | Prisma | DB | Null | Default | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|---|
| subjectId | String | Uuid | no | — | subject_id | Subject / **Restrict** | archive-first. |
| code | String | — | no | — | code | — | stable identifier. |
| name | String | — | no | — | name | — | display. |
| description | String | — | yes | — | description | — | |
| sortOrder | Int | — | no | 0 | sort_order | — | match `Skill.sortOrder` default 0. |
| status | SkillStatus | — | no | ACTIVE | status | — | reuse `SkillStatus` {ACTIVE,ARCHIVED}. |
| createdBy | String | Uuid | no | — | created_by | User("SubjectDomainCreatedBy") / Restrict | governance actor. |

- **Unique:** `@@unique([subjectId, code])`. **`sortOrder` uniqueness:** **NO** DB unique on `(subjectId,
  sortOrder)` — domains are a small unordered-ish lookup; a display collision is harmless (unlike `Level`, whose
  ordering is progression-authoritative). (Documented choice; add later only if UI needs strict ordering.)
- **Index:** `@@index([subjectId])`.
- **onDelete into Subject:** Restrict.

**`Skill` (EXTEND)** — content.prisma · Wave A. Add **one nullable** column; remove nothing.

| Field | Prisma | DB | Null | Default | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|---|
| primaryDomainId | String? | Uuid | **yes** | — | primary_domain_id | SubjectDomain / **Restrict** | nullable during backfill (Wave F). **`subjectId` stays** — Skill remains subject-scoped. |

- Existing `@@unique([subjectId, name])`, `@@unique([subjectId, code])`, `@@index([subjectId])` **retained**.
- App invariant (not DB): `primaryDomain.subjectId == skill.subjectId` (cross-subject guard; a composite FK is not
  worth it — matches V1's app-level cross-scope guards).

---

## 6. SkillLevelExpectation (+Revision) (task §8)

Stable identity + immutable revision + circular current-pointer (mirrors `Lesson`/`LessonRevision`).

**`SkillLevelExpectation`** → `@@map("skill_level_expectation")` · content.prisma · Wave A · Methodist.
**Stable identity = one Skill at one progression Level (correction 1).**

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| skillId | String | Uuid | no | skill_id | Skill / **Restrict** | |
| levelId | String | Uuid | no | level_id | Level / **Restrict** | SQ1 — `Level` reused as-is. |
| currentRevisionId | String? | Uuid | yes (`@unique`) | current_revision_id | SkillLevelExpectationRevision("ExpectationCurrentRevision") / **Restrict** | circular pointer. |

- **Unique:** `@@unique([skillId, levelId])` — **one stable expectation per (skill, level)** (correction 1). The
  introduced/expected/reinforced/assessed/required-for-exit facets are **versioned expectation semantics** (they
  may coexist for the same skill+level and change over time) → they live on the **revision**, never in the
  identity key. Plus the `@unique` on `currentRevisionId`.
- **Index:** `@@index([skillId])`, `@@index([levelId])`.

**`SkillLevelExpectationRevision`** → `@@map("skill_level_expectation_revision")` · **Imm** · Wave A.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| expectationId | String | Uuid | no | expectation_id | SkillLevelExpectation("ExpectationRevisions") / **Restrict** | |
| versionNo | Int | — | no | version_no | — | |
| status | RevisionStatus | — | no (`@default(DRAFT)`) | status | — | reuse. |
| isIntroduced | Boolean | — | no (`@default(false)`) | is_introduced | — | **versioned semantics (correction 1)** — coexist freely. |
| isExpected | Boolean | — | no (`@default(false)`) | is_expected | — | versioned semantics. |
| isReinforced | Boolean | — | no (`@default(false)`) | is_reinforced | — | versioned semantics. |
| isAssessed | Boolean | — | no (`@default(false)`) | is_assessed | — | versioned semantics. |
| isRequiredForExit | Boolean | — | no (`@default(false)`) | is_required_for_exit | — | versioned semantics. |
| requiredEvidenceKinds | Json | JsonB | no | required_evidence_kinds | — | array of evidence-kind registry strings. |
| minIndependence | Int? | SmallInt | yes | min_independence | — | ordinal; CHECK range. |
| criticality | Int | SmallInt | no (`@default(0)`) | criticality | — | ordinal (exit-weight). |
| descriptor | Json? | JsonB | yes | descriptor | — | can-do descriptor text/struct. |
| reviewedBy | String? | Uuid | yes | reviewed_by | User("ExpectationRevReviewedBy") / **SetNull** | |
| publishedBy | String? | Uuid | yes | published_by | User("ExpectationRevPublishedBy") / **SetNull** | |
| publishedAt | DateTime? | — | yes | published_at | — | |

- **Five explicit boolean facets** carry the role semantics that Phase 2 had wrongly encoded in the identity key
  (correction 1): introduced/expected/reinforced/assessed/required-for-exit are **not** separate stable
  identities — one skill+level expectation may be simultaneously e.g. `isAssessed` and `isRequiredForExit`, and
  these change by revision. (An equivalent explicit versioned representation — e.g. a small typed facet child
  table — is acceptable if a later canonical spec demands it; the boolean set is the preferred first shape.)
- **`SkillContributionRole` stays distinct** and is **not** this facet set: it is the REQUIRED/SUPPORTING/OPTIONAL
  role used when an expectation is **consumed** by a `RoadmapPointSkillExpectation` / `MasteryRequirementSkillExpectation`.
- **Unique:** `@@unique([expectationId, versionNo])`. **Historical pin:** `SkillMeasurement`,
  `MasteryRequirementSkillExpectation`, `PlacementDecisionValidation` reference **this revision id** (not merely
  the stable expectation identity) → history interpretable across expectation changes (Phase 1 §8).
- **Circular pointer convention:** `currentRevisionId` on the identity, named relations both sides, `Restrict` —
  same as `AssessmentDefinition.currentVersionId` / `Lesson.publishedRevisionId`.

---

## 7. RoadmapPoint (+Revision) & the canonical-graph decision (task §9, §11, §12)

### 12. Canonical roadmap-graph versioning — **RESOLVED: Option A** (stable identity + immutable revision)

**Chosen:** stable **`RoadmapPoint`** identity + immutable **`RoadmapPointRevision`** + revision-scoped canonical
membership joins; each **`RoadmapPointProjection`** row (per generation × point) **pins the exact
`roadmapPointRevisionId`** it reflected. **Rejected** Option B (new identity per semantic change — would fragment
learner acquisition of the *same concept* across identities and break "survives regeneration", SQ3) and Option C
(global curriculum-graph-version entity — heavier, and unnecessary once each projection row pins its point
revision). **No opaque JSON graph snapshot** is used.

Why required (not optional): Phase 1 §18 lists "Roadmap canonical graph / RoadmapPoint → versioned **yes**,
immutable revision **yes**, referenced from **roadmap generations**." A past `LearnerRoadmapGeneration` must stay
reproducible against the exact graph (titles, ordering, **skill-expectation membership**, **prerequisite edges**,
topic link) it was built from; otherwise "why did generation G contain/order these points" becomes a re-query
over a mutated graph — the very anti-pattern §24 rejects for mastery evidence.

**What lives where (the split):**
- **`RoadmapPoint` (stable identity)** carries only what never changes meaning: `pointKey`, **`levelId`**,
  `status`, `publishedRevisionId?`. **Subject and Track are NOT persisted here** (correction 2) — they are derived
  through `RoadmapPoint.level → Level.track → Track.subject`. **Learner acquisition / sessions / evaluations FK
  the stable `roadmapPointId`** → survive both regeneration and graph revisions.
- **`RoadmapPointRevision` (immutable)** carries the versioned semantics: title, outcome, default order, topic
  link, effort, required flag, and **owns** the skill-expectation membership + prerequisite edges of that
  version.
- **`RoadmapPointProjection`** pins `roadmapPointRevisionId` → a generation's graph is fully reconstructable from
  its projection rows (no separate graph-version table, no JSON).
- **Historical learner facts also pin `roadmapPointRevisionId` (correction 3):** `TeachingSession`,
  `MasteryEvaluation`, `PointAcquisitionEvent`, and point-target `PlacementDecisionValidation` each pin the exact
  point revision in force — the durable `roadmapPointId` gives identity, the `roadmapPointRevisionId` gives the
  canonical-graph context under which the fact happened. The revision FK is `Restrict` and never generation-scoped.

The outcome-determining pins are separate facts: mastery = `masteryRequirementRevisionId` + exact measurement
set; teaching = `blueprintRevisionId`; placement expectation-target = `skillLevelExpectationRevisionId`. The
`roadmapPointRevisionId` sits **alongside** these as the point-context history — one fact identifies the canonical
point context, the other identifies the exact contract/content evaluated. `MasteryRequirement`/`TeachingBlueprint`
stay **point-identity owned** (their content is versioned in their own revisions).

**`RoadmapPoint`** → `@@map("roadmap_point")` · content.prisma · Wave B · Methodist.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| pointKey | String | — | no (`@unique`) | point_key | — | immutable business key, **globally unique** (mirrors `Lesson.contentKey`). |
| levelId | String | Uuid | no | level_id | Level / **Restrict** | canonical parent (SQ2) — **sole ownership FK; Subject/Track derived through it** (correction 2). |
| status | ContainerStatus | — | no (`@default(DRAFT)`) | status | — | identity lifecycle DRAFT→PUBLISHED→ARCHIVED. |
| publishedRevisionId | String? | Uuid | yes (`@unique`) | published_revision_id | RoadmapPointRevision("RoadmapPointPublishedRevision") / **Restrict** | circular pointer. |
| createdBy | String | Uuid | no | created_by | User("RoadmapPointCreatedBy") / Restrict | |

- **No `subjectId`/`trackId` on this table (correction 2).** `Level → Track → Subject` already determines both;
  duplicating them would create a **second canonical ownership fact** that could drift. Subject/Track are reached
  via `RoadmapPoint.level → Level.track → Track.subject`. This is a **low-volume canonical** table, so the join is
  cheap and correctness beats a denormalized copy. **If** a future read path ever needs a denormalized cache, it
  must be **explicitly derived and consistency-enforced** (recompute on Level move), never a second authoritative
  column.
- **Unique:** `pointKey` **global** unique — a deliberate globally stable business key (like `Lesson.contentKey`);
  no `(trackId, pointKey)` scoping is needed or wanted. Ordering uniqueness is **on the revision**
  (`sortOrderDefault`), not the identity.
- **Index:** `@@index([levelId])`.
- **No current-state on identity:** no acquisition/mastery/availability columns (§24 anti-pattern).

**`RoadmapPointRevision`** → `@@map("roadmap_point_revision")` · **Imm** · Wave B.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint("RoadmapPointRevisions") / **Restrict** | |
| versionNo | Int | — | no | version_no | — | |
| status | RevisionStatus | — | no (`@default(DRAFT)`) | status | — | |
| title | String | — | no | title | — | versioned. |
| learningOutcome | Json? | JsonB | yes | learning_outcome | — | structured can-do. |
| topicId | String? | Uuid | yes | topic_id | Topic / **Restrict** | optional content-reuse link (SQ2), versioned (re-scoping is semantic). |
| sortOrderDefault | Int | — | no | sort_order_default | — | canonical order at publish. |
| requiredFlag | Boolean | — | no (`@default(true)`) | required_flag | — | |
| estimatedEffortMin | Int? | — | yes | estimated_effort_min | — | |
| reviewedBy / publishedBy | String? | Uuid | yes | reviewed_by / published_by | User(SetNull) | provenance. |
| publishedAt | DateTime? | — | yes | published_at | — | |

- **Unique:** `@@unique([roadmapPointId, versionNo])`; app invariant one PUBLISHED default order per level
  (`sortOrderDefault` uniqueness is **soft** — projection order is per-generation).
- **Index:** `@@index([roadmapPointId, status])`.

### RoadmapPointPrerequisite (task §10) → `@@map("roadmap_point_prerequisite")` · Wave B

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Cascade** | edges owned by the revision → history-frozen. |
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint / **Restrict** | **denormalized owner** so the self-loop CHECK is a row CHECK. |
| prerequisitePointId | String | Uuid | no | prerequisite_point_id | RoadmapPoint("RoadmapPointRequiredBy") / **Restrict** | edge target = stable point. |

- **Unique:** `@@unique([roadmapPointRevisionId, prerequisitePointId])`.
- **Index:** `@@index([prerequisitePointId])` (reverse "what unlocks after X").
- **Custom SQL CHECK:** `chk_roadmap_point_prereq_no_self` = `roadmap_point_id <> prerequisite_point_id` (mirrors
  `chk_prereq_no_self`). **Multi-node DAG acyclicity (A→B→C→A) = application write-time validation, NOT a DB
  CHECK** (identical to the documented `LessonPrerequisite` stance).

### RoadmapPointSkillExpectation (task §11) → `@@map("roadmap_point_skill_expectation")` · Wave B

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Cascade** | membership frozen per point revision. |
| skillLevelExpectationId | String | Uuid | no | skill_level_expectation_id | SkillLevelExpectation / **Restrict** | references **stable expectation identity**, not a revision. |
| role | SkillContributionRole | — | no | role | — | required/supporting/optional. |

- **References stable expectation identity (not the revision):** the point-graph mapping is an *identity-level*
  association ("present-simple involves the 3SG expectation, role REQUIRED"). The **exact expectation revision in
  force** is pinned by the outcome facts that need it (`SkillMeasurement.expectationRevisionId`,
  `MasteryRequirementSkillExpectation`, `PlacementDecisionValidation`) — not by this membership row. This keeps
  the point graph stable while evaluation stays revision-exact.
- **Unique:** `@@unique([roadmapPointRevisionId, skillLevelExpectationId])`.
- **Index:** `@@index([skillLevelExpectationId])`.

---

## 8. TeachingBlueprint / Revision / Stage / ContentBinding (task §13)

All content.prisma · Wave B · Methodist · immutable revisions.

**`TeachingBlueprint`** → `@@map("teaching_blueprint")`

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| roadmapPointId | String | Uuid | no (`@unique`) | roadmap_point_id | RoadmapPoint / **Restrict** | 1:1 point (SQ4-parallel). |
| status | ContainerStatus | — | no (`@default(DRAFT)`) | status | — | identity lifecycle. |
| publishedRevisionId | String? | Uuid | yes (`@unique`) | published_revision_id | TeachingBlueprintRevision("BlueprintPublishedRevision") / **Restrict** | circular pointer. |
| createdBy | String | Uuid | no | created_by | User("BlueprintCreatedBy") / Restrict | |

**`TeachingBlueprintRevision`** → `@@map("teaching_blueprint_revision")` · **Imm**

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| blueprintId | String | Uuid | no | blueprint_id | TeachingBlueprint("BlueprintRevisions") / **Restrict** | |
| versionNo | Int | — | no | version_no | — | |
| status | RevisionStatus | — | no | status | — | |
| contentBriefId | String? | Uuid | yes | content_brief_id | ContentBrief / **Restrict** | QF link (nullable). |
| estimatedDurationMin | Int? | — | yes | estimated_duration_min | — | |
| reviewedBy / publishedBy | String? | Uuid | yes | reviewed_by / published_by | User(SetNull) | |
| publishedAt | DateTime? | — | yes | published_at | — | |

- **Unique:** `@@unique([blueprintId, versionNo])`. Ordered stages are **relational rows** (below), not JSON.

**`TeachingBlueprintStage`** → `@@map("teaching_blueprint_stage")` · **Imm** · CORE

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| blueprintRevisionId | String | Uuid | no | blueprint_revision_id | TeachingBlueprintRevision / **Cascade** | owned by the revision. |
| stageKey | String? | — | yes | stage_key | — | optional stable label within revision. |
| position | Int | — | no | position | — | 1-based order. |
| stageType | String | — | no | stage_type | — | **string registry** (§3), app-validated. |
| branchFromStageId | String? | Uuid | yes | branch_from_stage_id | TeachingBlueprintStage("StageBranch") / **Restrict** | remediation branch source (self-FK, same revision). |
| config | Json | JsonB | no | config | — | intra-stage config (hint ladders, wording, branch conditions). |

- **Unique:** `@@unique([blueprintRevisionId, position])`; optional `@@unique([blueprintRevisionId, stageKey])`
  when `stageKey` used (partial unique WHERE stage_key IS NOT NULL).
- **Index:** `@@index([blueprintRevisionId, position])`.
- **CHECK:** `chk_blueprint_stage_no_self_branch` = `branch_from_stage_id IS NULL OR branch_from_stage_id <> id`.
  **"branch target in the same revision" = app invariant** (a cross-revision self-FK CHECK is not row-expressible;
  documented, like the DAG stance).

**`TeachingBlueprintContentBinding`** → `@@map("teaching_blueprint_content_binding")` · **Imm**

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| blueprintStageId | String | Uuid | no | blueprint_stage_id | TeachingBlueprintStage / **Cascade** | bound to **stage**, not revision. |
| lessonRevisionId | String? | Uuid | yes | lesson_revision_id | LessonRevision / **Restrict** | typed content FK. |
| activityId | String? | Uuid | yes | activity_id | Activity / **Restrict** | typed content FK. |
| mediaAssetId | String? | Uuid | yes | media_asset_id | MediaAsset / **Restrict** | typed content FK. |
| role | BlueprintBindingRole | — | no | role | — | teach/practice/evidence/exposure. |
| position | Int | — | no | position | — | |

- **Unique:** `@@unique([blueprintStageId, position])`.
- **CHECK (XOR):** `chk_blueprint_binding_content_xor` = exactly one of `{lesson_revision_id, activity_id,
  media_asset_id}` non-null. **Required canonical content identities are typed FKs, never JSON** (§13).

---

## 9. MasteryRequirement (+Revision) (task §14) — content.prisma · Wave B

**Ownership (task §14):** **`MasteryRequirement.roadmapPointId` is `@unique`** (requirement→point), **not**
`RoadmapPoint.masteryRequirementId`. Reason: the requirement is the dependent that must have a point; keeps
`RoadmapPoint` identity free of downstream pointers; mirrors `TeachingBlueprint.roadmapPointId @unique`. One
unambiguous 1:1 direction.

**`MasteryRequirement`** → `@@map("mastery_requirement")`: `roadmapPointId`(FK Restrict, `@unique`);
`status`(ContainerStatus); `currentRevisionId?`(FK `@unique`, circular, "RequirementCurrentRevision"/Restrict);
`createdBy`(FK Restrict).

**`MasteryRequirementRevision`** → `@@map("mastery_requirement_revision")` · **Imm**: `requirementId`(FK
"RequirementRevisions"/Restrict); `versionNo`; `status`(RevisionStatus); `gates`(JsonB — critical/cumulative
gates); `policyVersion`(String, nonempty CHECK); `reviewedBy?`/`publishedBy?`(SetNull); `publishedAt?`.
`@@unique([requirementId, versionNo])`.

**`MasteryRequirementSkillExpectation`** → `@@map("mastery_requirement_skill_expectation")` · **Imm**:
`requirementRevisionId`(FK Cascade); `skillLevelExpectationRevisionId`(FK **Restrict** — pins the **exact
expectation revision** the gate was authored against); `role`(SkillContributionRole);
`requiredEvidenceKinds`(JsonB); `minIndependence`(SmallInt?). `@@unique([requirementRevisionId,
skillLevelExpectationRevisionId])`. **No requirement semantics are duplicated in `MasteryEvaluation`** (§20).

---

## 10. PlacementDecision (+Validation) (task §15) — learning.prisma · Wave C · **append-only**

**`PlacementDecision`** → `@@map("placement_decision")`

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| userId | String | Uuid | no | user_id | User / **Restrict** | |
| subjectId | String | Uuid | no | subject_id | Subject / **Restrict** | |
| trackId | String? | Uuid | yes | track_id | Track / **Restrict** | |
| sourceAttemptId | String? | Uuid | yes | source_assessment_attempt_id | AssessmentAttempt / **Restrict** | nullable (manual/no-attempt decision possible). |
| policyVersion | String | — | no | policy_version | — | nonempty CHECK. |
| recommendedStudyLevelId | String? | Uuid | yes | recommended_study_level_id | Level / **Restrict** | |
| supersedesDecisionId | String? | Uuid | yes | supersedes_decision_id | PlacementDecision("PlacementSupersession") / **Restrict** | **new→old**; old row never mutated. |
| clientRequestId | String? | — | yes | client_request_id | — | idempotency fallback when no attempt. |
| snapshot | Json | JsonB | no | snapshot | — | **descriptive** band/state/reasoning; **NOT** the FK graph. |
| decidedAt | DateTime | — | no (`@default(now())`) | decided_at | — | |

- **Index:** `@@index([userId, subjectId, decidedAt])`.
- **Idempotency (custom SQL):** `uq_placement_decision_attempt_policy` = unique `(source_assessment_attempt_id,
  policy_version) WHERE source_assessment_attempt_id IS NOT NULL`; plus `uq_placement_decision_client_request` =
  unique `(user_id, client_request_id) WHERE client_request_id IS NOT NULL` for attempt-less decisions. Legitimate
  reassessment (new attempt) → new decision (not blocked).

**`PlacementDecisionValidation`** → `@@map("placement_decision_validation")` · **Imm** · CORE. **Task §15 XOR
decision: exactly one target per row** (refines Phase 2's "and/or" to one clean normalized shape, matching the
house XOR pattern).

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| placementDecisionId | String | Uuid | no | placement_decision_id | PlacementDecision / **Cascade** | owned child of an append-only fact. |
| targetKind | PlacementValidationTargetKind | — | no | target_kind | — | discriminator. |
| skillLevelExpectationRevisionId | String? | Uuid | yes | skill_level_expectation_revision_id | SkillLevelExpectationRevision / **Restrict** | XOR target — expectation-target pins the **exact expectation revision**. |
| roadmapPointId | String? | Uuid | yes | roadmap_point_id | RoadmapPoint / **Restrict** | XOR target — stable point that Roadmap consumes to write VALIDATED. |
| roadmapPointRevisionId | String? | Uuid | yes | roadmap_point_revision_id | RoadmapPointRevision / **Restrict** | **when the target is a point, pin the exact revision validated (correction 3)** — set iff `roadmapPointId` set. |
| validationKind | PlacementValidationKind | — | no | validation_kind | — | evidence_backed/policy_prereq. |
| policyVersion | String | — | no | policy_version | — | |

- **CHECK (XOR):** `chk_placement_validation_target_xor` = exactly one of `{skill_level_expectation_revision_id,
  roadmap_point_id}` non-null (and consistent with `target_kind`). **Point-target companion CHECK:**
  `chk_pdv_point_revision_paired` = `roadmap_point_revision_id IS NOT NULL` **iff** `roadmap_point_id IS NOT NULL`
  (a point-target validation always pins its exact revision, correction 3); **app invariant:** that revision
  belongs to that point.
- **Unique (custom SQL, per target):** `uq_pdv_point (placement_decision_id, roadmap_point_id) WHERE
  roadmap_point_id IS NOT NULL`; `uq_pdv_expectation (placement_decision_id, skill_level_expectation_revision_id)
  WHERE ... IS NOT NULL`. **No validation IDs inside the snapshot JSON** — Roadmap reads rows, never JSON.
- **Prereq gaps / repair targets** → typed `LearnerSignal`s (relational target), not a table (Phase 2 §12).

---

## 11. TeachingSession (+ContentPin) (task §16, §17) — learning.prisma · Wave C

**`TeachingSession`** → `@@map("teaching_session")` · fact (terminal-immutable).

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| userId | String | Uuid | no | user_id | User / **Restrict** | |
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint / **Restrict** | durable point identity. |
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Restrict** | **point-context history** — the exact canonical-graph revision in force (correction 3). |
| blueprintRevisionId | String | Uuid | no | blueprint_revision_id | TeachingBlueprintRevision / **Restrict** | **teaching-content history** — authoritative for what was taught. |
| roadmapGenerationId | String? | Uuid | yes | roadmap_generation_id | LearnerRoadmapGeneration / **SetNull** | operational link; session survives regeneration. |
| status | TeachingSessionStatus | — | no (`@default(NOT_STARTED)`) | status | — | |
| currentStep | Json? | JsonB | yes | current_step | — | resume: step/branch/hints. |
| startedAt | DateTime? | — | yes | started_at | — | |
| completedAt | DateTime? | — | yes | completed_at | — | |

- **Point-revision pin (correction 3 — revises the earlier §16 decision):** the session pins **BOTH**
  `roadmapPointRevisionId` (point-context history) **and** `blueprintRevisionId` (teaching-content history) —
  these are **separate facts** (the canonical point may evolve independently of its blueprint). It references the
  stable `roadmapPointId` for durable identity. **App invariant:** `roadmapPointRevisionId` belongs to
  `roadmapPointId`. The revision FK is `Restrict` (historical) and **not** generation-scoped, so a session stays
  interpretable and survives roadmap regeneration.
- **Index:** `@@index([userId, status])`, `@@index([userId, roadmapPointId, status])`.
- **Partial unique (custom SQL):** `uq_teaching_session_nonterminal (user_id, roadmap_point_id) WHERE status NOT
  IN ('COMPLETED','ABANDONED')` — one resumable session per learner+point (mirrors `uq_review_session_active`).
  Resumable ≠ concurrent: a learner resumes the one open session; history keeps terminal ones. Not over-constrained.
- **`ActivityAttempt.teachingSessionId?`** (EXTEND, §18) is additive/nullable/`SetNull`.

**`TeachingSessionContentPin`** → `@@map("teaching_session_content_pin")` · **Imm** · **DECISION: KEEP** (task §17).

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| teachingSessionId | String | Uuid | no | teaching_session_id | TeachingSession / **Cascade** | |
| lessonRevisionId? / activityId? / mediaAssetId? | String? | Uuid | yes | ... | LessonRevision/Activity/MediaAsset / **Restrict** | typed pinned content (XOR). |

- **KEEP — with narrowed semantics (not a duplicate of blueprint bindings).** The blueprint revision's bindings
  are the **possible** content; because stages **branch** (`branchFromStageId` is CORE), the set a learner
  actually encountered is a per-session **fact** (a subset/variant). The pin records the **resolved/encountered
  content-revision set** — the same reason V1 keeps `LearnerReviewSessionActivity` even though it is derivable.
  **CHECK:** `chk_teaching_session_pin_xor` (exactly one typed FK). **Unique:** per (session, pinned object) via
  per-target partial uniques.
- **Redundancy caveat (honest):** for a *purely linear* blueprint (no branches), the pin adds nothing over
  `blueprintRevisionId` + bindings. If Phase 4's Wave-A/early A1 blueprints are linear, this table MAY be deferred
  to the teaching-execution wave (still Wave C) and built when branching ships. **Recommendation: KEEP**, since
  branching is CORE in the blueprint model.

---

## 12. SkillMeasurement extension (task §18) — learning.prisma · Wave C · **append-only, keep all V1**

Add (all **nullable**, additive): `evidenceKind?` (String — registry, `@map("evidence_kind")`);
`independenceLevel?` (Int `@db.SmallInt`, `@map("independence_level")`, range CHECK); `expectationRevisionId?`
(FK SkillLevelExpectationRevision **Restrict**, `@map("skill_level_expectation_revision_id")`); `aiEvaluationId?`
(FK AiEvaluation **Restrict**, `@map("ai_evaluation_id")`); `detailMeta?` (JsonB, `@map("detail_meta")`);
**optional** `taskContentRevisionId?` (FK LessonRevision **Restrict**) — **single-source optimization only**,
never the general provenance model.

- **Keep unchanged:** `source`, `scoreBp`, **`confidenceBp` = coverage (NOT redefined)**, `evidenceCount`,
  `observedAt`, `derivationVersion`, existing provenance FKs (`attemptId`/`lessonId`/`reviewSessionId`), the **3
  partial-unique idempotency indexes**, `chk_sm_evidence_count_positive`, `chk_sm_score_bp`,
  `chk_sm_confidence_bp`, `chk_sm_derivation_version_nonempty`. Remove **no** provenance field.
- **Multi-source provenance is relational** via `SkillMeasurementEvidenceRef` (§13), not a column.
- **`ENGINE_RECALC` exclusion = application merge rule** (V2 merge does not consume `source=ENGINE_RECALC` as
  evidence). **No DB deletion, no enum change** — the value stays for V1 compatibility (Phase 1 §13, L-f).

---

## 13. SkillMeasurementEvidenceRef (task §19) — learning.prisma · Wave C · **Imm** · CORE

`@@map("skill_measurement_evidence_ref")`

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| skillMeasurementId | String | Uuid | no | skill_measurement_id | SkillMeasurement / **Cascade** | owned by the measurement. |
| assessmentResponseId | String? | Uuid | yes | assessment_response_id | AssessmentResponse / **Restrict** | immutable raw fact. |
| activityAttemptId | String? | Uuid | yes | activity_attempt_id | ActivityAttempt / **Restrict** | immutable raw fact. |

- **CHECK (XOR):** `chk_smer_source_xor` = exactly one source FK non-null (extensible to future atomic sources).
- **Multi-skill evidence = YES.** One `AssessmentResponse`/`ActivityAttempt` **can** contribute to **several**
  `SkillMeasurement`s (one activity maps to multiple skills). Therefore **NOT** globally unique on the source row.
  Uniqueness is **scoped by measurement + source** (custom SQL): `uq_smer_response (skill_measurement_id,
  assessment_response_id) WHERE assessment_response_id IS NOT NULL`; `uq_smer_attempt (skill_measurement_id,
  activity_attempt_id) WHERE activity_attempt_id IS NOT NULL`.
- **Index (reverse — the integrity-match path):** `@@index([assessmentResponseId])`,
  `@@index([activityAttemptId])`, `@@index([skillMeasurementId])`.

---

## 14. MasteryEvaluation (+Evidence) (task §20, §21) — learning.prisma · Wave C · **Imm**

**`MasteryEvaluation`** → `@@map("mastery_evaluation")`

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| userId | String | Uuid | no | user_id | User / **Restrict** | |
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint / **Restrict** | durable point identity. |
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Restrict** | **canonical point context** at evaluation (correction 3). |
| requirementRevisionId | String | Uuid | no | mastery_requirement_revision_id | MasteryRequirementRevision / **Restrict** | **the exact mastery contract** evaluated. |
| outcome | MasteryEvaluationOutcome | — | no | outcome | — | **not** acquisition truth. |
| policyVersion | String | — | no | policy_version | — | nonempty CHECK. |
| evidenceCutoffAt | DateTime | — | no | evidence_cutoff_at | — | **concrete indexable watermark** (max observed_at considered). |
| evidenceBoundaryKey | String? | — | yes | evidence_boundary_key | — | optional tie-break id for idempotency. |
| gateSummary | Json | JsonB | no | gate_summary | — | which gates passed/failed (descriptive). |
| evaluatedAt | DateTime | — | no (`@default(now())`) | evaluated_at | — | |

- **Immutable historical evaluation** — outcome is never acquisition (Roadmap writes acquisition from it, §22).
- **Pins BOTH revisions (correction 3 — revises the earlier §20 decision):** `roadmapPointRevisionId` (canonical
  point context) **and** `requirementRevisionId` (the exact gate). This is **intentional** — one identifies the
  point context under which the learner was evaluated, the other identifies the mastery contract that was tested.
  **App invariant:** `roadmapPointRevisionId` belongs to `roadmapPointId`. Both are `Restrict` historical FKs.
- **Index:** `@@index([userId, roadmapPointId, evaluatedAt])`.
- **Idempotency (custom SQL):** `uq_mastery_evaluation_idem (user_id, roadmap_point_id,
  mastery_requirement_revision_id, evidence_cutoff_at)` — same cause → no duplicate. (Point-revision is context,
  not part of the idempotency key — a re-evaluation under the same requirement revision + cutoff is the same
  evaluation regardless of point-metadata churn.)

**`MasteryEvaluationEvidence`** → `@@map("mastery_evaluation_evidence")` · **Imm** · CORE

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| masteryEvaluationId | String | Uuid | no | mastery_evaluation_id | MasteryEvaluation / **Cascade** | owned child — safe **only** because `MasteryEvaluation` is non-deletable. |
| skillMeasurementId | String | Uuid | no | skill_measurement_id | SkillMeasurement / **Restrict** | pins the exact measurement. |
| evidenceRole | Int? | SmallInt | yes | evidence_role | — | optional contribution role. |

- **Unique:** `@@unique([masteryEvaluationId, skillMeasurementId])` (Prisma — plain unique, the exact set).
- **Index:** `@@index([skillMeasurementId])`, `@@index([masteryEvaluationId])`.
- **Does NOT copy** `SkillMeasurement` score/detail — reference only (the whole point of the join, L-b).

---

## 15. PointAcquisitionEvent (task §22) — learning.prisma · Wave C · **Imm**

`@@map("point_acquisition_event")`

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| userId | String | Uuid | no | user_id | User / **Restrict** | |
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint / **Restrict** | **durable acquisition identity — no `generationId`** → survives regeneration. |
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Restrict** | **historical context under which the acquisition was applied** (correction 3) — NOT generation-scoped, never makes old acquisition disappear. |
| acquisitionType | PointAcquisitionType | — | no | acquisition_type | — | LEARNED/VALIDATED. |
| masteryEvaluationId | String? | Uuid | yes | mastery_evaluation_id | MasteryEvaluation / **Restrict** | LEARNED provenance. |
| placementDecisionId | String? | Uuid | yes | placement_decision_id | PlacementDecision / **Restrict** | VALIDATED root-decision provenance (mapping detail = `PointAcquisitionValidationRef`, §15a). |
| validationApplicationPolicyVersion | String? | — | yes | validation_application_policy_version | — | **VALIDATED only** — the Roadmap mapping/application policy that turned validated inputs into this acquisition (correction 4). |
| policyVersion | String? | — | yes | policy_version | — | |
| acquiredAt | DateTime | — | no (`@default(now())`) | acquired_at | — | |

- **Stable-point vs revision (correction 3):** `roadmapPointId` = the **durable** acquisition identity (survives
  regeneration and point-graph revisions); `roadmapPointRevisionId` = the **historical context** the acquisition
  was applied under. The revision FK is `Restrict` and **not** generation-scoped → old acquisition history never
  disappears after regeneration and is never rewritten. **App invariant:** the revision belongs to the point.
- **CHECK (provenance XOR + type-consistency):** `chk_pae_provenance` = `(acquisition_type='LEARNED' AND
  mastery_evaluation_id IS NOT NULL AND placement_decision_id IS NULL) OR (acquisition_type='VALIDATED' AND
  placement_decision_id IS NOT NULL AND mastery_evaluation_id IS NULL)`.
- **Idempotency (cause-based, custom SQL):** `uq_pae_learned (user_id, roadmap_point_id, mastery_evaluation_id)
  WHERE mastery_evaluation_id IS NOT NULL`; `uq_pae_validated (user_id, roadmap_point_id, placement_decision_id)
  WHERE placement_decision_id IS NOT NULL`. **NOT** globally unique on `(user, point, type)` — a genuine
  re-validation/re-acquisition under a **new cause** is a legitimate new event.
- **No acquisition column on any generation/projection** as truth (SQ3). Projection *reflects* the latest event.

### 15a. PointAcquisitionValidationRef (task §4 / correction 4) — learning.prisma · Wave C · **Imm** · CORE

`@@map("point_acquisition_validation_ref")` — the **VALIDATED lineage join**: one `PointAcquisitionEvent(VALIDATED)`
1→N `PointAcquisitionValidationRef` N→1 `PlacementDecisionValidation`. It pins the **exact immutable
`PlacementDecisionValidation` facts** the Roadmap mapping consumed (a `PlacementDecision` may hold many validated
areas — the broad `placementDecisionId` alone is not the lineage). This makes VALIDATED symmetrical to LEARNED.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| pointAcquisitionEventId | String | Uuid | no | point_acquisition_event_id | PointAcquisitionEvent / **Cascade** | owned child — safe **only** because `PointAcquisitionEvent` is non-deletable. |
| placementDecisionValidationId | String | Uuid | no | placement_decision_validation_id | PlacementDecisionValidation / **Restrict** | the exact validated input consumed. |

- **Unique:** `@@unique([pointAcquisitionEventId, placementDecisionValidationId])`.
- **Index:** `@@index([placementDecisionValidationId])` (reverse — "which acquisitions consumed this validation?"),
  `@@index([pointAcquisitionEventId])`.
- **App invariants:** (i) every referenced `PlacementDecisionValidation` belongs to the event's
  `placementDecisionId`; (ii) every `VALIDATED` event has **≥1** validation ref; (iii)
  `validationApplicationPolicyVersion` explains how those validated inputs satisfied the target
  `RoadmapPointRevision`. **Roadmap remains the writer** of `PointAcquisitionEvent` — Placement never decides
  Roadmap acquisition; this join records what Roadmap consumed, not a Placement command.
- **Symmetrical lineage:** LEARNED = raw facts → `SkillMeasurementEvidenceRef` → `SkillMeasurement` →
  `MasteryEvaluationEvidence` → `MasteryEvaluation` → event; VALIDATED = assessment evidence → `PlacementDecision`
  → `PlacementDecisionValidation` → **`PointAcquisitionValidationRef`** → event.

---

## 16. LearnerRoadmapGeneration + RoadmapPointProjection (task §23, §24) — learning.prisma · Wave D · derived

**`LearnerRoadmapGeneration`** → `@@map("learner_roadmap_generation")` · derived, versioned. **Lifecycle mutation
`CURRENT→SUPERSEDED` is acceptable** (task §23) — this is a projection-generation record, not immutable learner
evidence; the immutable facts (`PointAcquisitionEvent`) are never rewritten.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| userId | String | Uuid | no | user_id | User / **Restrict** | |
| subjectId | String | Uuid | no | subject_id | Subject / **Restrict** | |
| trackId | String | Uuid | no | track_id | Track / **Restrict** | |
| generationNo | Int | — | no | generation_no | — | monotonic per (user, subject). |
| engineVersion | String | — | no | engine_version | — | nonempty CHECK. |
| sourcePlacementDecisionId | String? | Uuid | yes | source_placement_decision_id | PlacementDecision / **Restrict** | |
| status | RoadmapGenerationStatus | — | no (`@default(CURRENT)`) | status | — | |
| supersedesGenerationId | String? | Uuid | yes | supersedes_generation_id | LearnerRoadmapGeneration("GenerationSupersession") / **SetNull** | new→old. |
| generatedAt | DateTime | — | no (`@default(now())`) | generated_at | — | |

- **Partial unique (custom SQL):** `uq_roadmap_generation_current (user_id, subject_id) WHERE status='CURRENT'`
  (mirrors `ux_active_roadmap`). Also `@@unique([userId, subjectId, generationNo])`.
- **Index:** `@@index([userId, subjectId, status])`.
- **V1 `LearnerRoadmap`/`RoadmapItem` untouched.**

**`RoadmapPointProjection`** → `@@map("roadmap_point_projection")` · derived, rebuildable.

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| roadmapGenerationId | String | Uuid | no | roadmap_generation_id | LearnerRoadmapGeneration / **Cascade** | owned by generation. |
| roadmapPointId | String | Uuid | no | roadmap_point_id | RoadmapPoint / **Restrict** | |
| roadmapPointRevisionId | String | Uuid | no | roadmap_point_revision_id | RoadmapPointRevision / **Restrict** | **§12 graph-version pin** — the exact point revision reflected. |
| sortOrder | Int | — | no | sort_order | — | generation-specific order. |
| acquisition | PointAcquisitionType? | — | yes | acquisition | — | **derived cache** (NULL = none). |
| availability | RoadmapAvailabilityState | — | no | availability | — | **derived cache**. |
| attention | RoadmapAttentionState | — | no (`@default(NONE)`) | attention | — | **derived cache**. |
| derivedMeta | Json? | JsonB | yes | derived_meta | — | reason/explainability. |

- **All three states explicitly NON-authoritative** (rebuild from `PointAcquisitionEvent` + publication +
  signals). **No generic `mastered` boolean.**
- **Unique:** `@@unique([roadmapGenerationId, roadmapPointId])`. **Index:** `@@index([roadmapGenerationId,
  sortOrder])`.

---

## 17. Evidence Integrity (task §25) — quality.prisma · Wave E · **Imm**

**`EvidenceIntegrityDecision`** → `@@map("evidence_integrity_decision")`. **Decision-revisions? NO — append-only +
supersession** (prefer new→old, like `PlacementDecision`; a re-decision such as `UNDER_REVIEW→INVALIDATED` or a
reversal is a **new** decision referencing the prior).

| Field | Prisma | DB | Null | @map | Rel/onDelete | Notes |
|---|---|---|---|---|---|---|
| contentQualityIssueId | String? | Uuid | yes | content_quality_issue_id | ContentQualityIssue / **Restrict** | |
| outcome | EvidenceIntegrityOutcome | — | no | outcome | — | VALID/UNDER_REVIEW/INVALIDATED/QUALIFIED. |
| policyVersion | String | — | no | policy_version | — | nonempty CHECK. |
| reasonCode | String | — | no | reason_code | — | registry. |
| supersedesDecisionId | String? | Uuid | yes | supersedes_decision_id | EvidenceIntegrityDecision("IntegritySupersession") / **Restrict** | new→old. |
| details | Json? | JsonB | yes | details | — | descriptive. |
| decidedBy | String | Uuid | no | decided_by | User("IntegrityDecidedBy") / **Restrict** | |
| clientRequestId | String? | — | yes | client_request_id | — | command idempotency. |
| decidedAt | DateTime | — | no (`@default(now())`) | decided_at | — | |

- **Index:** `@@index([decidedAt])`. **No mutable `isValid` on `SkillMeasurement`** — admissibility is derived.

**`EvidenceIntegrityScope`** → `@@map("evidence_integrity_scope")` · **Imm** · typed nullable FKs + XOR (SQ5, L-e).

| Field | Prisma | DB | Null | @map | Rel/onDelete |
|---|---|---|---|---|---|
| decisionId | String | Uuid | no | decision_id | EvidenceIntegrityDecision / **Cascade** |
| scopeKind | String | — | no | scope_kind | (registry label) |
| assessmentItemId | String? | Uuid | yes | assessment_item_id | AssessmentItem / **Restrict** |
| assessmentVersionItemId | String? | Uuid | yes | assessment_version_item_id | AssessmentVersionItem / **Restrict** |
| assessmentDefinitionVersionId | String? | Uuid | yes | assessment_definition_version_id | AssessmentDefinitionVersion / **Restrict** |
| activityId | String? | Uuid | yes | activity_id | Activity / **Restrict** |
| mediaAssetId | String? | Uuid | yes | media_asset_id | MediaAsset / **Restrict** |
| lessonRevisionId | String? | Uuid | yes | lesson_revision_id | LessonRevision / **Restrict** |
| blueprintStageId | String? | Uuid | yes | teaching_blueprint_stage_id | TeachingBlueprintStage / **Restrict** |
| scopeQualifier | Json? | JsonB | yes | scope_qualifier | (answer-key/rubric version, locale — **never hides an FK identity**) |

- **Scope narrowness (L-e):** `assessmentItemId` = item defective across **all** versions; `assessmentVersionItemId`
  = defect only in **one version's** membership/context/override (leaves other valid uses untouched);
  `assessmentDefinitionVersionId` = **only** when the whole version is affected.
- **CHECK (XOR):** `chk_eis_target_xor` = exactly one typed FK non-null. A decision may have **multiple** scope
  rows (several independently-identified objects).
- **Unique (custom SQL, per target):** one `(decision_id, <target>)` partial unique per typed FK (dedup).
- **Index:** **one per typed load-bearing FK** (reverse "which evidence is affected by X?").

---

## 18. AssessmentItem immutability (task §26) — application invariant, **no schema change**

**Contract (L-d):** DRAFT `AssessmentItem` is mutable; once **PUBLISHED / referenced by a published
`AssessmentDefinitionVersion`**, its learner/scoring-relevant `payload` (question, options, **answer key**) is
**immutable**. A correction produces a **new `AssessmentItem` row** (+ new `AssessmentDefinitionVersion`/pool
membership where the pool changes) — never an in-place payload/answer-key update on an item already used by
historical attempts.

- **Trigger? NO.** Prefer **application invariant + tests**, consistent with how V1 already enforces published
  `Activity`/`LessonRevision` immutability (the repo has **zero DB triggers**). A DB trigger is *possible* but not
  justified — the payload lives in JSONB and "published-ness" is a multi-row condition (item + version
  membership) awkward for a row trigger; app enforcement is the established pattern.
- **DB assists (already present):** `AssessmentVersionItem.item → Restrict` and `AssessmentResponse.item →
  Restrict` keep `AssessmentAttempt → definitionVersion → versionItem → exact AssessmentItem` reproducible.
- **No `AssessmentItemRevision` table** — item identity + new-row-on-correction + `RevisionStatus`
  DRAFT→PUBLISHED discipline suffice (the audit does not prove a revision table is needed).

---

## 19. Content Quality foundation (task §27, §28) — quality.prisma · Wave E

**First-wave classification (challenged):**

| Model | Class | Rationale |
|---|---|---|
| `ContentQualityPolicyVersion` | **QF-REQUIRED-BEFORE-PUBLISH** | reviews reference the policy version they passed under. |
| `ContentReview` (+ result) | **QF-REQUIRED-BEFORE-PUBLISH** | the hard-blocker publish gate. |
| `EvidenceIntegrityDecision` | **QF-REQUIRED-BEFORE-PUBLISH** | defect response is not production-safe without it. |
| `EvidenceIntegrityScope` | **QF-REQUIRED-BEFORE-PUBLISH** | the scope-match reverse lookup depends on it. |
| `ContentQualityIssue` | **QF-REQUIRED** (with integrity) | the issue that triggers an integrity decision. |
| `SourceReference` + `ContentSourceProvenance` | **QF-REQUIRED-BEFORE-PUBLISH** (correction 5) | the V2 Content-Quality publication contract requires trustworthy source/research provenance + original instructional synthesis; the **persistence capability + provenance workflow must exist before publish is claimed safe**. Content policy MAY rule that a specific artifact legitimately needs zero external references, but the *capability* is not optional. Kept **typed/relational** (§20) — never `StaffAudit` or opaque JSON. |
| `ContentBrief` | **QF-LATER / optional** | authoring aid; the review gate can run without a persisted brief — architecture permits deferral. |
| `ContentQualitySignal` | **QF-LATER** | observability/analytics — not a gate. |

**`ContentReview`** → `@@map("content_review")` · fact · **Imm**: typed nullable XOR target
{`blueprintRevisionId?` / `lessonRevisionId?` / `assessmentDefinitionVersionId?`} + `chk_content_review_target_xor`;
`policyVersionId`(FK Restrict); `outcome`(ContentReviewOutcome); `blockers`(JsonB — coded hard-blocker results);
`reviewedBy`(FK Restrict); `reviewedAt`.

**`ContentQualityPolicyVersion`** → `@@map("content_quality_policy_version")` · **Imm**: `code`,
`status`(reuse `PolicyVersionStatus` {DRAFT,ACTIVE,ARCHIVED} from finance — **or** a dedicated one; choose reuse
since the shape is identical and it is a policy-version lifecycle), `config`(JsonB), `createdBy`(FK Restrict).
**Note:** confirm the reuse of finance's `PolicyVersionStatus` is acceptable cross-domain, else define
`ContentPolicyStatus`; recommendation = **dedicated `ContentPolicyStatus`** to avoid cross-domain coupling (same
call as `RoadmapGenerationStatus`).

**`ContentBrief`** → `@@map("content_brief")` · `roadmapPointId?`(FK Restrict); `status`(ContainerStatus);
`spec`(JsonB); `createdBy`(FK Restrict). **`ContentQualityIssue`** → `@@map("content_quality_issue")` · lifecycle
`status`(ContentQualityIssueStatus); typed target (reuse the same XOR target set as scope, first wave narrow);
`severityCode`(String registry); `createdBy`(FK Restrict). *(QF field detail beyond the gate is deferred — not on
the single-point critical path.)*

---

## 20. SourceReference / Provenance (task §28) — quality.prisma · Wave E

**`SourceReference`** → `@@map("source_reference")` — canonical bibliographic metadata: `title`, `kind`(registry),
`locator`(String — **not** a raw fetched URL as identity; store the citation locator/DOI/ISBN or object key),
`metadata`(JsonB), `createdBy`(FK Restrict). **Careful with URLs/external research:** persist a **locator +
metadata**, never auto-fetch external content into the DB; no crawler here.

**`ContentSourceProvenance`** → `@@map("content_source_provenance")` — **typed join, NOT polymorphic**. First-wave
**narrow** typed targets + XOR (avoids a nullable-FK explosion): `sourceReferenceId`(FK Restrict) +
{`blueprintRevisionId?` / `lessonRevisionId?`} + `chk_content_provenance_target_xor` + `claimRole`(registry).
**Reject `target_type`+`target_id` as the only authoritative relation** — Prisma cannot enforce a polymorphic FK
(unlike `StaffAudit`, which is audit, not load-bearing). Add more typed target columns by migration as new
artifact types genuinely need provenance. If the typed-FK set would explode, keep the **narrow first-wave** set
(blueprint/lesson revisions) and expand deliberately.

---

## 21. StaffAudit governance (task §29) — REUSE, no new audit table

All V2 publish/governance actions route through the existing append-only `StaffAudit` (`actionCode` registry,
polymorphic `targetType`/`targetId`, real `actorUserId` FK Restrict) — **no new general-purpose audit table**:
domain publish/archive · expectation publish · **roadmap point/graph publish** (point + point-revision) ·
blueprint publish · mastery-requirement publish · content-review decision · **evidence-integrity decision** ·
content withdrawal/deprecation. New `actionCode` values are registry strings (TD-90), not schema.

---

## 22. Custom SQL constraint inventory (task §30)

**NEW (Phase 4 writes these as raw SQL appended to the relevant migration, catalogued in
`_custom_constraints.reference.sql`):**

| Constraint | Table | Type | SQL intent | Why Prisma alone insufficient | Wave |
|---|---|---|---|---|---|
| `chk_roadmap_point_prereq_no_self` | roadmap_point_prerequisite | CHECK | `roadmap_point_id <> prerequisite_point_id` | row CHECK not expressible in Prisma | B |
| `chk_blueprint_stage_no_self_branch` | teaching_blueprint_stage | CHECK | `branch_from_stage_id IS NULL OR branch_from_stage_id <> id` | self-referential CHECK | B |
| `chk_blueprint_binding_content_xor` | teaching_blueprint_content_binding | CHECK | exactly one of lesson_revision/activity/media non-null | XOR CHECK | B |
| `uq_placement_decision_attempt_policy` | placement_decision | partial unique | idempotent decision per finalized attempt+policy | partial index | C |
| `uq_placement_decision_client_request` | placement_decision | partial unique | attempt-less decision dedup | partial index | C |
| `chk_placement_validation_target_xor` | placement_decision_validation | CHECK | exactly one target (+targetKind consistency) | XOR CHECK | C |
| `chk_pdv_point_revision_paired` | placement_decision_validation | CHECK | `roadmap_point_revision_id` set iff `roadmap_point_id` set (correction 3) | conditional pairing CHECK | C |
| `uq_pdv_point` / `uq_pdv_expectation` | placement_decision_validation | partial unique | dedup per (decision, target) | partial index | C |
| `uq_teaching_session_nonterminal` | teaching_session | partial unique | one resumable session per (user, point) | partial index (status predicate) | C |
| `chk_teaching_session_pin_xor` | teaching_session_content_pin | CHECK | exactly one pinned content FK | XOR CHECK | C |
| `chk_smer_source_xor` | skill_measurement_evidence_ref | CHECK | exactly one source (response/attempt) | XOR CHECK | C |
| `uq_smer_response` / `uq_smer_attempt` | skill_measurement_evidence_ref | partial unique | dedup per (measurement, source) — NOT global | partial index | C |
| `chk_sm_independence_level_range` | skill_measurement | CHECK | `independence_level IS NULL OR BETWEEN 0 AND N` | range CHECK on new col | C |
| `uq_mastery_evaluation_idem` | mastery_evaluation | partial/plain unique | idempotent per (user, point, req-rev, cutoff) | multi-col unique w/ watermark | C |
| `chk_me_policy_version_nonempty` | mastery_evaluation | CHECK | nonempty policy_version | nonempty CHECK | C |
| `chk_pae_provenance` | point_acquisition_event | CHECK | LEARNED⇒eval set/placement null; VALIDATED⇒inverse | typed XOR + consistency | C |
| `uq_pae_learned` / `uq_pae_validated` | point_acquisition_event | partial unique | cause-based idempotency (not global) | partial index | C |
| `uq_pavr_event_validation` | point_acquisition_validation_ref | unique | dedup `(event, validation)` (correction 4) | Prisma `@@unique` | C |
| `uq_roadmap_generation_current` | learner_roadmap_generation | partial unique | one CURRENT per (user, subject) | partial index | D |
| `chk_gen_engine_version_nonempty` | learner_roadmap_generation | CHECK | nonempty engine_version | nonempty CHECK | D |
| `chk_eis_target_xor` | evidence_integrity_scope | CHECK | exactly one typed target FK | XOR CHECK | E |
| `uq_eis_<target>` (per typed FK) | evidence_integrity_scope | partial unique | dedup per (decision, target) | partial index | E |
| `chk_content_review_target_xor` | content_review | CHECK | exactly one review target | XOR CHECK | E |
| `chk_content_provenance_target_xor` | content_source_provenance | CHECK | exactly one provenance target | XOR CHECK | E |
| nonempty CHECKs | expectation/requirement/blueprint revisions, placement, policy | CHECK | nonempty version/policy strings | mirrors `chk_sm_derivation_version_nonempty` | A–E |

Plus Prisma-expressible (NOT custom SQL, listed for completeness): every `@@unique` and `@@index` above, and the
plain `@@unique([masteryEvaluationId, skillMeasurementId])`.

**EXISTING custom constraints that MUST remain untouched:** all in `_custom_constraints.reference.sql` — in
particular the 3 `uq_skill_measurement_*_idempotency` partial uniques, `chk_sm_evidence_count_positive`,
`chk_sm_score_bp`, `chk_sm_confidence_bp`, `chk_sm_derivation_version_nonempty`, `ux_active_roadmap`,
`uq_review_session_active`, `chk_prereq_no_self`, and every finance/community constraint. V2 is **purely
additive** to this catalogue.

---

## 23. Idempotency key inventory (task §31)

| Writer | Natural source key | Candidate unique | Client request id? |
|---|---|---|---|
| SkillMeasurement | (provenance, skill, source, derivationVersion) | **reuse** 3 existing partial uniques | no (natural). |
| SkillMeasurementEvidenceRef | (measurement, source-row) | `uq_smer_response` / `uq_smer_attempt` | no. |
| PlacementDecision | (source_attempt, policy) | `uq_placement_decision_attempt_policy` | **yes** — fallback `uq_..._client_request` when attempt-less. |
| PlacementDecisionValidation | (decision, target) | `uq_pdv_point` / `uq_pdv_expectation` | no. |
| MasteryEvaluation | (user, point, req-rev, cutoff) | `uq_mastery_evaluation_idem` | no (watermark = cause). |
| MasteryEvaluationEvidence | (evaluation, measurement) | `@@unique(...)` | no. |
| PointAcquisitionEvent | (user, point, provenance-id) | `uq_pae_learned` / `uq_pae_validated` | no (provenance = cause). |
| PointAcquisitionValidationRef | (event, validation) | `uq_pavr_event_validation` | no (natural). |
| TeachingSession start/resume | (user, point, non-terminal) | `uq_teaching_session_nonterminal` (= resume key) | **yes** — for create-dedup on retry. |
| LearnerRoadmapGeneration | one CURRENT per (user, subject) + monotonic generation_no | `uq_roadmap_generation_current` + `@@unique(user,subject,generationNo)` | **yes** — dedup a regenerate command. |
| EvidenceIntegrityDecision | (staff command — no natural attempt key) | `clientRequestId` partial unique | **yes** — required (no natural key). |

**Rule:** a random `uuid(7)` PK is **never** the idempotency key — every writer above has a natural key or an
explicit `clientRequestId`, matching V1 (`ux_attempt_client_request`, the payment `client_request_id` indexes).

---

## 24. Immutability matrix (task §32)

| Model | Draft mutable? | Published/final mutable? | Append-only? | Supersedable? | Derived/rebuildable? | Hard delete? |
|---|---|---|---|---|---|---|
| SubjectDomain | yes (metadata) | n/a (lookup; ARCHIVE) | no | no | no | **NO** (archive) |
| Skill (ext) | yes | metadata only | no | no | no | **NO** |
| SkillLevelExpectation / (…Revision) | yes / — | no / **immutable** | no / rows appended | via new revision | no | **NO** |
| RoadmapPoint / (…Revision) | yes / — | identity metadata only / **immutable** | no / appended | via new revision | no | **NO** |
| RoadmapPointPrerequisite / …SkillExpectation | — | **immutable** (owned by revision) | appended | with revision | no | draft-cascade only |
| TeachingBlueprint / Revision / Stage / Binding | yes / — / — / — | no / **immutable** ×3 | appended | via new revision | no | draft-cascade only |
| MasteryRequirement / Revision / SkillExpectation | yes / — / — | no / **immutable** ×2 | appended | via new revision | no | draft-cascade only |
| PlacementDecision / Validation | — | **immutable** | **yes** | **new→old** | no | **NO** |
| TeachingSession | live (status) | terminal → **immutable** | no (updates until terminal) | no | no | **NO** |
| TeachingSessionContentPin | — | **immutable** | **yes** | no | no | **NO** |
| SkillMeasurement (ext) / EvidenceRef | — | **immutable** | **yes** | no | no | **NO** |
| MasteryEvaluation / Evidence | — | **immutable** | **yes** | no | no | **NO** |
| PointAcquisitionEvent / ValidationRef | — | **immutable** | **yes** | no | no | **NO** |
| LearnerRoadmapGeneration | — | status `CURRENT→SUPERSEDED` allowed | no | **yes** | **rebuildable** | drop/rebuild ok |
| RoadmapPointProjection | — | updated by recompute | no | with generation | **rebuildable** | drop/rebuild ok |
| EvidenceIntegrityDecision / Scope | — | **immutable** | **yes** | **new→old** | no | **NO** |
| ContentReview / QualityIssue / Brief / Source / Provenance | draft yes | review/decision **immutable**; issue has lifecycle | mixed | — | no | **NO** (archive) |

**All historical learner facts: hard delete = NO** (archive-first, `onDelete: Restrict`). Draft child rows
(stages/bindings/membership) may `Cascade` **before** publish only.

---

## 25. Delete / archive (onDelete) matrix (task §33)

| Relation | onDelete | Class |
|---|---|---|
| SubjectDomain → Subject; Skill.primaryDomain → SubjectDomain | **Restrict** | canonical |
| SkillLevelExpectation → Skill/Level; …Revision → Expectation | **Restrict** | canonical |
| RoadmapPoint → **Level only** (Subject/Track derived, correction 2); …Revision → Point; Point.topic (rev) → Topic | **Restrict** | canonical |
| RoadmapPointPrerequisite → **Revision** | **Cascade** | draft child of a revision |
| RoadmapPointPrerequisite → RoadmapPoint (owner + prereq) | **Restrict** | edge targets |
| RoadmapPointSkillExpectation → **Revision** (Cascade); → SkillLevelExpectation (Restrict) | mixed | |
| TeachingBlueprint → RoadmapPoint; Revision → Blueprint | **Restrict** | canonical |
| Stage → Revision (Cascade); Binding → Stage (Cascade); Binding → content revisions | **Cascade / Restrict** | owned child / referenced content |
| MasteryRequirement → RoadmapPoint; Revision → Requirement | **Restrict** | canonical |
| MasteryRequirementSkillExpectation → Revision (Cascade); → expectationRevision (Restrict) | mixed | |
| PlacementDecision → user/attempt/level/supersedes | **Restrict** | history |
| PlacementDecisionValidation → decision (Cascade); → point/**pointRevision**/expectationRev (Restrict) | mixed | owned child of append-only |
| TeachingSession → point/**pointRevision**/blueprintRevision (Restrict); → generation (**SetNull**) | mixed | fact / operational |
| TeachingSessionContentPin → session (Cascade); → content (Restrict) | mixed | |
| ActivityAttempt.teachingSession (ext) | **SetNull** | operational (matches session/roadmapItem) |
| SkillMeasurement.expectationRevision/aiEvaluation/taskContentRevision (ext) | **Restrict** | provenance |
| SkillMeasurementEvidenceRef → measurement (Cascade); → response/attempt (Restrict) | mixed | owned by measurement / raw facts |
| MasteryEvaluation → point/**pointRevision**/requirementRevision (Restrict) | **Restrict** | history |
| MasteryEvaluationEvidence → evaluation (Cascade); → measurement (Restrict) | mixed | owned child (eval non-deletable) |
| PointAcquisitionEvent → point/**pointRevision**/evaluation/placement (Restrict) | **Restrict** | history |
| PointAcquisitionValidationRef → event (Cascade); → placementDecisionValidation (Restrict) | mixed | owned child (event non-deletable) / immutable validated input |
| LearnerRoadmapGeneration → user/subject/track/placement/supersedes | **Restrict / SetNull** | derived |
| RoadmapPointProjection → generation (Cascade); → point/pointRevision (Restrict) | mixed | derived child |
| EvidenceIntegrityScope → decision (Cascade); → every content target | **Cascade / Restrict** | owned child / defective objects |
| ContentReview/Provenance/Issue → content/source targets | **Restrict** | canonical/history |

**Historical learner facts survive canonical archival** — content is `ARCHIVED`, never deleted; pinned revisions
keep old sessions/evaluations valid.

---

## 26. Exact migration waves (task §34)

Dependency-safe order; every wave **additive**, no V1 table dropped, new columns nullable with no V1 semantics.

| Wave | New models | Extensions | New enums | Custom SQL | Backfill | Runtime dep | Rollback boundary |
|---|---|---|---|---|---|---|---|
| **A — canonical skill/progression** | SubjectDomain; SkillLevelExpectation(+Revision) | Skill `+primaryDomainId?` | `SkillContributionRole` (expectation facets = booleans, correction 1 — no `SkillExpectationRole` enum) | nonempty CHECKs; expectation `min_independence`/`criticality` range CHECKs | none | none | drop new tables/column (no learner facts) |
| **B — roadmap/mastery/blueprint canonical** | RoadmapPoint(+Revision), RoadmapPointPrerequisite, RoadmapPointSkillExpectation, TeachingBlueprint(+Revision), TeachingBlueprintStage, TeachingBlueprintContentBinding, MasteryRequirement(+Revision), MasteryRequirementSkillExpectation | — | `BlueprintBindingRole` (stageType/scopeKind = registry) | prereq self-loop, stage self-branch, binding XOR, nonempty CHECKs | none (Methodist → Wave F) | Wave A tables | additive drop |
| **C — learner evidence + teaching/mastery/acquisition** | PlacementDecision(+Validation), TeachingSession(+ContentPin), SkillMeasurementEvidenceRef, MasteryEvaluation(+Evidence), PointAcquisitionEvent, **PointAcquisitionValidationRef** (correction 4) | ActivityAttempt `+teachingSessionId?`; SkillMeasurement V2 columns; **TeachingSession/MasteryEvaluation/PointAcquisitionEvent `+roadmapPointRevisionId`; PlacementDecisionValidation `+roadmapPointRevisionId`; PointAcquisitionEvent `+validationApplicationPolicyVersion`** (correction 3/4) | `TeachingSessionStatus`, `PointAcquisitionType`, `MasteryEvaluationOutcome`, `PlacementValidationKind`, `PlacementValidationTargetKind` | all §22 Wave-C rows (incl. `chk_pdv_point_revision_paired`, `uq_pavr_event_validation`) | none (facts created at runtime) | Waves A–B (point-revision FKs need Wave B) | additive drop; drop nullable ActivityAttempt col |
| **D — V2 roadmap projections** | LearnerRoadmapGeneration, RoadmapPointProjection | — | `RoadmapGenerationStatus`, `RoadmapAvailabilityState`, `RoadmapAttentionState` | one-CURRENT partial unique, nonempty CHECK | none | Waves B–C | additive drop (projections rebuildable) |
| **E — content quality / integrity** | ContentQualityPolicyVersion, **SourceReference, ContentSourceProvenance (QF-REQUIRED, correction 5)**, ContentReview, ContentQualityIssue, EvidenceIntegrityDecision, EvidenceIntegrityScope; ContentBrief (QF-LATER — may defer) | — | `EvidenceIntegrityOutcome`, `ContentReviewOutcome`, `ContentQualityIssueStatus`, `ContentPolicyStatus` | scope XOR + per-target uniques, review/provenance XOR | none | Waves A–B (content refs) | additive drop |
| **F — Methodist A1 mappings (DATA only)** | — | — | — | — | **§35 table** (create domain/expectation/point(+rev)/mapping/prereq/requirement rows; blueprint scaffolds+bindings) | Waves A–E schema | delete authored rows (pre-launch: no learner facts yet) |
| **G — shadow runtime (no schema)** | — | — | — | — | — | Waves A–F | disable V2 writers/readers |
| **H — controlled cutover (config flag, no schema)** | — | — | — | — | — | Wave G validated | switch read path back to V1; additive tables remain |

New Prisma **fragment `quality.prisma`** is introduced at Wave E (or created empty earlier — harmless).

---

## 27. A1 backfill — mechanical vs Methodist (task §35) — Wave F

| A1 object | Class | Notes |
|---|---|---|
| Subject (English) / Track (General English) / **Level A1** | **MECHANICAL** | reuse existing rows as progression identities (SQ1). |
| Skill (13) → `primaryDomainId` | **METHODIST** | which domain each skill belongs to. |
| SubjectDomain rows (Grammar…Pronunciation) | **METHODIST** | define the set. |
| SkillLevelExpectation(+Revision) @A1 | **METHODIST** | one stable identity per (skill, A1) (correction 1); the revision sets the `is*` facets + evidence kinds + independence + criticality. |
| RoadmapPoint(+Revision) for A1 | **METHODIST** | point boundaries ≠ lesson boundaries; publish a v1 revision (learner facts pin that revision, correction 3). |
| RoadmapPointSkillExpectation | **METHODIST** | point→skill mapping. |
| RoadmapPointPrerequisite | **METHODIST** | point DAG (lesson prereqs are a *hint*, not the truth). |
| TeachingBlueprint(+Revision)+Stage+Binding | **MECHANICAL scaffold + METHODIST review** | wrap existing A1 `LessonRevision`s as bindings **only after** Methodist defines stages/point-to-content mapping. |
| MasteryRequirement(+Revision) | **METHODIST** | evidence/independence gates. |
| Lesson / LessonRevision / Activity | **NO BACKFILL** (reuse in place) | referenced as binding targets; unchanged. |
| LessonSkill / ActivitySkill | **MECHANICAL reuse + METHODIST role** | add primary/supporting role later (EXTEND is LATER, not Wave F-critical). |
| LessonPrerequisite | **NO BACKFILL** | stays within-content ordering (rescoped, not migrated). |
| `SkillMeasurementEvidenceRef` for existing V1 measurements | **NO BACKFILL (documented gap)** | existing `attemptId`/`lessonId`/`reviewSessionId` provenance stays valid; evidence-refs populate for **new V2** measurements only. |
| MasteryEvaluationEvidence / PointAcquisitionEvent / **PointAcquisitionValidationRef** for pre-V2 history | **NO BACKFILL** | no synthetic historical acquisition or validation lineage; V2 facts start at cutover. |

**Never infer pedagogy from current sort order** — domains/expectations/point boundaries/prereqs/requirements are
Methodist-authored; only Subject/Track/Level reuse and blueprint scaffolding are mechanical.

---

## 28. Shadow verification contract (task §36) — Wave G (metrics/invariants, not runtime)

Runnable in shadow before any learner-visible cutover:
- **Generate** V2 skill projections from new evidence; V2 `LearnerRoadmapGeneration`/`RoadmapPointProjection`;
  evaluate `MasteryRequirement` — **without** replacing the V1 response.
- **Compare** V1 vs V2 roadmap/skill outputs; log divergences (no user impact).
- **Invariants to assert:** (i) every `SkillMeasurement` used by an evaluation has a
  `MasteryEvaluationEvidence` row (lineage completeness); (ii) no duplicate `PointAcquisitionEvent` per cause
  (idempotency holds); (iii) integrity reverse-lookup `scope → responses/attempts → EvidenceRef → measurements →
  MasteryEvaluationEvidence → evaluations → acquisitions` returns the expected set (both item-level and
  version-item-level scopes); (iv) every projection row's `roadmapPointRevisionId` resolves to a PUBLISHED point
  revision (graph-version pin valid); (v) full **rebuild-from-facts** of `LearnerSkillState` + projections
  reproduces the materialized rows; (vi) one CURRENT generation per (user, subject).
- **Roadmap-revision history cross-check (correction 3):** for a point `P` with revisions `P-v2` then `P-v3` —
  every historical `TeachingSession`/`MasteryEvaluation`/`PointAcquisitionEvent`/`PlacementDecisionValidation`
  that used `P-v2` still resolves to `P-v2` after `P-v3` publishes; acquisition still belongs to **stable `P`**;
  the CURRENT generation may reference `P-v3`; **no** historical learner row is rewritten; every
  `roadmapPointRevisionId` belongs to its `roadmapPointId`.
- **VALIDATED-lineage cross-check (correction 4):** every `PointAcquisitionEvent(VALIDATED)` has ≥1
  `PointAcquisitionValidationRef`; every referenced `PlacementDecisionValidation` belongs to the event's
  `placementDecisionId`; the chain `AssessmentAttempt → SkillMeasurements/decision inputs → PlacementDecision →
  PlacementDecisionValidation → PointAcquisitionValidationRef → PointAcquisitionEvent(VALIDATED) → stable point +
  exact point revision` resolves — and **no** `LearnerLessonCompletion`/`TeachingSession`/XP/IZL/time-spent row is
  produced by validation.

---

## 29. Rollback boundaries (task §37)

Additive design ⇒ rollback = **disable, not drop**:
- **Waves A–E (schema):** early rollback disables V2 writers/readers and **leaves additive tables intact**;
  learner traffic returns to the V1 path. Drop-table rollback is allowed **only** while a wave's tables hold **no
  learner facts** (canonical Waves A–B, projection Wave D pre-shadow) — **never** drop `skill_measurement*`,
  `mastery_evaluation*`, `point_acquisition_event`, `placement_decision*`, `teaching_session*` once they hold
  facts.
- **Wave F (data):** delete Methodist-authored rows only while pre-launch (no learner facts reference them);
  after facts exist, archive instead.
- **Waves G–H (no schema):** flip the config flag back to the V1 read path.
- **Never** a destructive rollback of learner evidence. Projections may always be dropped and rebuilt.

---

## 30. Performance / index review (task §38)

**Fastest-growing new tables:** `SkillMeasurementEvidenceRef`, `MasteryEvaluationEvidence`, `TeachingSession`
(+attempts via `ActivityAttempt`), `PointAcquisitionEvent`, `RoadmapPointProjection`. Keep them **narrow** (2–3
FKs + a small payload); no giant JSON arrays for relationships.

**Required lineage paths served by the planned indexes (no full scans):**
- **raw evidence → measurement:** `skill_measurement_evidence_ref(assessment_response_id)` /
  `(activity_attempt_id)` → `(skill_measurement_id)`.
- **measurement → evaluation:** `mastery_evaluation_evidence(skill_measurement_id)` → `(mastery_evaluation_id)`.
- **evaluation → acquisition (LEARNED):** `point_acquisition_event(mastery_evaluation_id)` via `uq_pae_learned`;
  `(user_id, roadmap_point_id, acquired_at)` for history reads.
- **validated-input → acquisition (VALIDATED, correction 4):** `point_acquisition_validation_ref
  (placement_decision_validation_id)` (reverse) → `(point_acquisition_event_id)`; `point_acquisition_event
  (placement_decision_id)` via `uq_pae_validated`.
- **roadmap load:** `roadmap_point_projection(roadmap_generation_id, sort_order)`;
  `learner_roadmap_generation(user_id, subject_id, status)`.
- **integrity reverse lookup:** one index per typed `evidence_integrity_scope` FK.

**No over-indexing:** no speculative per-column indexes; review-due/attention indexes only if those projections
are materialized. **Partitioning:** not now — the append-only shape makes time/tenant partitioning a
**non-destructive later** option for the five hot tables.

---

## 31. Final implementation model count (task §39)

| Class | Count | Members |
|---|---|---|
| **NEW CORE** | **25** | SubjectDomain, SkillLevelExpectation, SkillLevelExpectationRevision, RoadmapPoint, **RoadmapPointRevision**, RoadmapPointPrerequisite, RoadmapPointSkillExpectation, TeachingBlueprint, TeachingBlueprintRevision, TeachingBlueprintStage, TeachingBlueprintContentBinding, MasteryRequirement, MasteryRequirementRevision, MasteryRequirementSkillExpectation, PlacementDecision, PlacementDecisionValidation, TeachingSession, TeachingSessionContentPin, SkillMeasurementEvidenceRef, MasteryEvaluation, MasteryEvaluationEvidence, PointAcquisitionEvent, **PointAcquisitionValidationRef**, LearnerRoadmapGeneration, RoadmapPointProjection |
| **EXTENDED EXISTING** | **3 (+1 optional)** | Skill (+primaryDomainId), SkillMeasurement (+6 nullable cols), ActivityAttempt (+teachingSessionId); optional LearnerSkillState (+projection fields, LATER). *(Note: several new CORE facts now also carry `roadmapPointRevisionId` — corrections 3/4 — a field change, not a new model.)* |
| **QF-REQUIRED (pre-publish)** | **7** | ContentQualityPolicyVersion, ContentReview, ContentQualityIssue, EvidenceIntegrityDecision, EvidenceIntegrityScope, **SourceReference, ContentSourceProvenance** (correction 5) |
| **QF-LATER / not publish-blocking** | **2** | ContentBrief, ContentQualitySignal |
| **DERIVED MATERIALIZED** | **3** | LearnerSkillState (reuse), LearnerRoadmapGeneration, RoadmapPointProjection |
| **NEW enums** | **11** | (correction 1 removed `SkillExpectationRole`) — see §3. |

**Difference vs the pre-correction Phase 3 count (24 core):** **+1 = `PointAcquisitionValidationRef`** (the
VALIDATED lineage join, correction 4) → **25 NEW CORE**. This load-bearing join is **not** rejected to keep the
table count lower — it gives VALIDATED the same auditable lineage LEARNED already has. Enum count **12 → 11**
(`SkillExpectationRole` removed, correction 1). QF-required **5 → 7** and QF-later **4 → 2** (SourceReference +
ContentSourceProvenance promoted, correction 5). Versus **Phase 2** the net new-core delta is **+2**
(`RoadmapPointRevision` §12 + `PointAcquisitionValidationRef`), both implementation-driven, neither reopening
ownership.

---

## 32. Implementation readiness gate (task §40)

| Gate | Status |
|---|---|
| Structural questions locked (SQ1–SQ7 + L-a…L-f) | **PASS** |
| Canonical graph versioning resolved | **PASS** (§12 — Option A) |
| Exact model inventory resolved | **PASS** (25 core + ext + 7 QF) |
| Exact fields resolved | **PASS** (§5–§20 field tables) |
| Enum choices resolved | **PASS** (§3 — 11 new + registries + reuse) |
| FK / onDelete resolved | **PASS** (§25) |
| Custom constraints resolved | **PASS** (§22) |
| Idempotency resolved | **PASS** (§23) |
| Evidence lineage resolved (LEARNED **and** VALIDATED) | **PASS** (EvidenceRef + EvaluationEvidence + acquisition XOR; PlacementDecisionValidation + PointAcquisitionValidationRef) |
| Canonical-point revision pinning resolved | **PASS** (session/evaluation/acquisition/validation pin point-revision, §11/§14/§15/§10) |
| Assessment immutability resolved | **PASS** (§18 — app invariant, no trigger, no revision table) |
| Migration waves resolved | **PASS** (§26 — A–H) |
| V1 coexistence preserved | **PASS** (additive only; V1 roadmap/progress untouched) |
| A1 backfill boundary clear | **PASS** (§27 — mechanical vs Methodist) |
| Shadow verification defined | **PASS** (§28) |
| Rollback boundary defined | **PASS** (§29 — disable-not-drop) |

**No gate BLOCKED → Prisma implementation is ready to begin (Wave A only).**

---

## 33. Recommended next phase (task §41)

**V2 DATA MODEL — PHASE 4: PRISMA SCHEMA IMPLEMENTATION — WAVE A ONLY.** Implement **only** the first additive
wave — enum `SkillContributionRole` (schema.prisma; the expectation facets are **booleans on the revision**, not
an enum — correction 1); `SubjectDomain` + `Skill.primaryDomainId?` + `SkillLevelExpectation(+Revision)` with its
five `is*` facet booleans (content.prisma); the Wave-A nonempty + range CHECKs (custom SQL) — generate **one**
additive migration, verify additivity against the running V1 schema, **then STOP for owner review**. Do **NOT**
implement all waves at once; each subsequent wave is a separate reviewed phase.

## 34. Open (non-structural, deferred by design)

Exact JSONB schemas per policy/config; numeric thresholds/floors/intervals/hint weights; whether
attention/availability materialize on the projection vs compute-on-read at scale; final `stageType`/`evidenceKind`
registry value sets; STT/AI provider; rubric schema; item analytics; misconception/family/section tables (LATER).
**None reopens ownership or the seven structural decisions.**
