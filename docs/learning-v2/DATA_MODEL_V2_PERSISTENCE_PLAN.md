# V2 Data Model — Phase 2 (Persistence Contract / Prisma Design Plan)

> **Status:** DESIGN / DOCUMENTATION ONLY. No Prisma schema, migration, API, runtime, test, or deploy change.
> This chooses the **exact candidate persistence contract** so Phase 3 can write Prisma without reopening
> architecture. **Ownership/source-of-truth is already fixed** (`LEARNING_SYSTEM_V2.md` §7 + `DATA_MODEL_V2.md`)
> and is not reopened here. Names below are **candidate** conceptual names, not final. **No Prisma syntax.**
>
> **Inputs:** `DATA_MODEL_V2.md` (Phase 1), the six engine specs + `CROSS_ENGINE_CONSISTENCY_AUDIT.md`, and the
> verified V1 schema (`prisma/schema/{schema,content,learning,core,finance}.prisma`).
>
> **Convention:** `…Revision` = immutable published version; `…Event`/`…Decision` = append-only fact;
> `…Projection` = recomputable; identity+revision pairs mirror V1 `Lesson`/`LessonRevision`. Scores are integer
> **basis points (0..10000)** (reuse V1). All ids `uuid(7)`.

---

## 1. The seven structural resolutions (all RESOLVED)

| # | Question | **Resolution** |
|---|---|---|
| **SQ1** | Level: ladder vs container | **REUSE V1 `Level` as the canonical progression-level identity** (option C): promote it from "display code" to a governed ordered ladder per Track (it already has `@@unique[trackId,code]` + `@@unique[trackId,sortOrder]`). `SkillLevelExpectation` and `RoadmapPoint` FK `Level.id`. Modules/Topics stay underneath as content containers. **No new "ProgressionLevel" entity** (would duplicate Level truth). CEFR stays `Level.code` **data**. |
| **SQ2** | RoadmapPoint ↔ Topic/Module | **Option D: RoadmapPoint belongs to `Level` (canonical parent) with its OWN ordering + prerequisite graph, and an OPTIONAL nullable `topicId` for content reuse.** Ordering/prereqs live on the point, never on lessons; a point orchestrates content via the blueprint (many lessons), not via a topic 1:1. |
| **SQ3** | Point acquisition: event vs event+projection | **Option B: immutable `PointAcquisitionEvent` (source of truth) + a derived `RoadmapPointProjection` (materialized per roadmap generation).** Events are keyed on **canonical point** → survive regeneration. |
| **SQ4** | Mastery Requirement attachment | **Attach to `RoadmapPoint` (identity) as immutable `MasteryRequirementRevision`s** referencing expectations via `MasteryRequirementSkillExpectation`. The **blueprint owns no second requirement** — it is *validated against* the point's requirement at publish. Mastery evaluation pins the requirement revision. |
| **SQ5** | Evidence-integrity scope | **Option A: one `EvidenceIntegrityScope` row per (decision, scope) with typed nullable FKs + XOR CHECK + `scopeKind`** (the proven V1 `DailyMissionCompletionEvidence`/`AiEvaluation` XOR pattern). "Affected evidence" is **matched at recompute** by scope reference — **no measurement rows are updated**. |
| **SQ6** | SkillMeasurement V2 extension | **Option C: hybrid — extend `SkillMeasurement` in place with nullable, query-critical columns** (`evidenceKind`, `independenceLevel`, `expectationRevisionId?`, `aiEvaluationId?`, optional single-source `taskContentRevisionId?`) **+ JSONB `detailMeta`**, **plus a relational `SkillMeasurementEvidenceRef` join for multi-source provenance** (correction 2 — one measurement may summarize N raw facts, e.g. 4 `AssessmentResponse`s). Keep all existing columns, the 3 partial-unique idempotency indexes, and `confidenceBp` = **coverage** unchanged. `ENGINE_RECALC` stays excluded from V2 evidence at the merge layer. |
| **SQ7** | TeachingSession vs LearnerLessonProgress | **Additive coexistence: new `TeachingSession` (per-point, pins blueprint + content-revision set) alongside untouched V1 `LearnerLessonProgress` (per-lesson).** `ActivityAttempt` gains a nullable `teachingSessionId?` (additive, `SetNull`). No fake completion; transition after cutover. |

No question is BLOCKED.

## 2. SQ1 — Level strategy (detail)

- **Direction:** `Level` = canonical **progression identity** (stable `id`), reused as-is; `Track → Level →
  Module → Topic → Lesson` stays. Add nothing that changes V1 reads.
- **English:** the existing A1 `Level` row **is** the A1 progression level; A2–C2 are new `Level` rows under the
  same Track. `Level.code` (CEFR) is data. Other subjects define their own Level rows (Math: Foundations… ).
- **FKs added (additive, nullable-safe):** `SkillLevelExpectation.levelId → Level`; `RoadmapPoint.levelId →
  Level`. Optional `Track.levelSystemCode?` / `Subject` config marks "CEFR" vs other (data, not enum).
- **Historical interpretability:** expectations are versioned (`SkillLevelExpectationRevision`) and measurements
  pin the expectation revision — a `Level` never changes identity, so old evidence stays interpretable.
- **Migration impact on V1 `Level` rows:** **none destructive.** Existing rows are reused as progression
  identities; only additive FKs from new tables reference them. No rename/drop of `Level`.

## 3. SQ2 — RoadmapPoint hierarchy (detail)

`Subject → Track → Level → RoadmapPoint(own order) → (blueprint → many lessons)`. `RoadmapPoint.levelId` is the
canonical parent; `RoadmapPoint.topicId?` is an **optional** content-reuse link; `RoadmapPoint.sortOrder`
+ `pointKey` give ordering/identity; prerequisites are point-level (`RoadmapPointPrerequisite`), independent of
`LessonPrerequisite` (which stays as within-content ordering). A **curriculum "Section"** grouping under Level is
**deferred (LATER)** — points sit directly under Level with `sortOrder` for v1. This keeps macro hierarchy
clear, lets one point orchestrate many lessons, reuses Topic content, and keeps `RoadmapPoint ≠ Lesson`.

## 4. Candidate model inventory & classification

Tier: **C1** = Core V2 (needed for one V2 point flow) · **QF** = Quality Foundation (before V2 publish) ·
**D** = Derived/materialized (optional initially) · **L** = Later.

| Model | SQL table (candidate) | Layer | New/Extend/Reuse | Auth/Derived | Immutable? | Tier | Notes |
|---|---|---|---|---|---|---|---|
| SubjectDomain | `subject_domain` | A | NEW | authoritative | no (status) | **C1** | lookup rows; unique(subjectId, code) |
| Skill | `skill` | A | **EXTEND** | authoritative | no | **C1** | + `primary_domain_id?` |
| SkillFamily / Member | `skill_family` | A | NEW | authoritative | no | **L** | grouping only |
| SkillLevelExpectation | `skill_level_expectation` | A | NEW | authoritative | identity | **C1** | (skill, level, role) identity |
| SkillLevelExpectationRevision | `skill_level_expectation_revision` | A | NEW | authoritative | **yes** | **C1** | evidence-kind/independence/criticality; versionNo |
| Level | `level` | A | **REUSE** | authoritative | no | **C1** | progression identity (SQ1) |
| RoadmapPoint | `roadmap_point` | A | NEW | authoritative | no (draft→publish) | **C1** | belongs to Level; optional topic |
| RoadmapPointPrerequisite | `roadmap_point_prerequisite` | A | NEW | authoritative | append | **C1** | point DAG |
| RoadmapPointSkillExpectation | `roadmap_point_skill_expectation` | A | NEW | authoritative | no | **C1** | role required/supporting/optional |
| TeachingBlueprint | `teaching_blueprint` | A | NEW | authoritative | identity | **C1** | current-revision pointer |
| TeachingBlueprintRevision | `teaching_blueprint_revision` | A | NEW | authoritative | **yes** | **C1** | revision metadata; **ordered stages are relational rows** (below), not one JSON blob |
| TeachingBlueprintStage | `teaching_blueprint_stage` | A | NEW | authoritative | **yes** | **C1** (correction 1) | **stable stage identity/order/type/branch refs** within a pinned revision; intra-stage config JSONB |
| TeachingBlueprintContentBinding | `teaching_blueprint_content_binding` | A | NEW | authoritative | **yes** | **C1** | **stage** ↔ LessonRevision/Activity/Media |
| MasteryRequirement | `mastery_requirement` | A | NEW | authoritative | identity | **C1** | 1:1 point |
| MasteryRequirementRevision | `mastery_requirement_revision` | A | NEW | authoritative | **yes** | **C1** | versionNo |
| MasteryRequirementSkillExpectation | `mastery_requirement_skill_expectation` | A | NEW | authoritative | **yes** | **C1** | role + evidence-kind/independence gates |
| MisconceptionDefinition / Skill / Observation | `misconception_*` | A/B | NEW | authoritative/fact | mixed | **L** | teaching diagnosis later |
| PlacementDecision | `placement_decision` | B | NEW | authoritative | **yes** | **C1** | §19 (snapshot JSONB is descriptive, not the FK graph) |
| PlacementDecisionValidation | `placement_decision_validation` | B | NEW (correction 4) | authoritative | **yes** | **C1** | relational validated targets (expectation-rev / point) — load-bearing for VALIDATED acquisition |
| TeachingSession | `teaching_session` | B | NEW | fact | terminal-immutable | **C1** | SQ7 |
| TeachingSessionContentPin | `teaching_session_content_pin` | B | NEW | fact | **yes** | **C1** | pinned revision set |
| ActivityAttempt | `activity_attempt` | B | **EXTEND** | fact | append | **C1** | + `teaching_session_id?` |
| SkillMeasurement | `skill_measurement` | B | **EXTEND** | fact | **append-only** | **C1** | SQ6 |
| SkillMeasurementEvidenceRef | `skill_measurement_evidence_ref` | B | NEW (correction 2) | fact | **yes** | **C1** | relational multi-source provenance (response/attempt), XOR per row |
| MasteryEvaluation | `mastery_evaluation` | B | NEW | fact | **yes** | **C1** | watermark + relational evidence lineage (§13) |
| MasteryEvaluationEvidence | `mastery_evaluation_evidence` | B | NEW (correction 1) | fact | **yes** | **C1** | pins the exact `SkillMeasurement` set an evaluation used — authoritative audit lineage |
| PointAcquisitionEvent | `point_acquisition_event` | B | NEW | fact | **yes** | **C1** | §21 |
| LearnerRoadmapGeneration | `learner_roadmap_generation` | D | NEW | derived(versioned) | supersedable | **C1** | SQ / §22 (V1 `LearnerRoadmap` untouched) |
| RoadmapPointProjection | `roadmap_point_projection` | D | NEW | derived | rebuildable | **C1** | per generation × point |
| LearnerSkillState | `learner_skill_state` | D | **REUSE** | derived | no | **C1** | +few projection fields |
| Domain/expectation/retention/review/attention/availability/admissibility projections | — | D | compute-on-read v1 | derived | — | **D** | materialize later (§23) |
| EvidenceIntegrityDecision | `evidence_integrity_decision` | C | NEW | authoritative | **yes** | **QF** | §8 |
| EvidenceIntegrityScope | `evidence_integrity_scope` | C | NEW | authoritative | **yes** | **QF** | typed FKs + XOR |
| ContentBrief | `content_brief` | C | NEW | authoritative | no (draft) | **QF** | |
| SourceReference / ContentSourceProvenance | `source_reference` / `content_source_provenance` | C | NEW | authoritative | mostly immutable | **QF** | |
| ContentReview (+ result) | `content_review` | C | NEW | fact | **yes** | **QF** | blocker result JSONB or child |
| ContentQualityPolicyVersion | `content_quality_policy_version` | C | NEW | authoritative | **yes** | **QF** | |
| ContentQualityIssue | `content_quality_issue` | C | NEW | fact+lifecycle | no | **QF** | |
| ContentQualitySignal | `content_quality_signal` | C | NEW | fact | append | **L** | observability |
| ContentApproval provenance | (reuse `StaffAudit`) | C | **REUSE+EXTEND** | fact | append | **QF** | |

**Rejected-for-now (do not create):** `SkillFamily`, misconception tables, Section grouping, materialized
retention/attention/availability caches, `ContentQualitySignal`/analytics, `PlacementDecisionGap`/`RepairTarget`
(gaps/repairs = typed `LearnerSignal`s with relational target for the first flow, §12). **Reason:** none is
required for a single V2 point to be taught, evaluated, and acquired — adding them now is premature normalization
(§34). *(`TeachingBlueprintStage`, `SkillMeasurementEvidenceRef`, `PlacementDecisionValidation`, and
`MasteryEvaluationEvidence` were promoted to CORE — corrections 1/2/4 + final correction 1.)*

## 5. Model-by-model field contracts (Core V2 + key QF)

*(Type cat.: UUID-FK · code/str · int-bp · ts · enum/lookup · JSONB · bool-cache. "Imm?" = immutable after
create/publish.)*

**SubjectDomain** — auth, lookup. `id`; `subject_id`(FK Restrict); `code`(str, uniq w/ subject); `name`;
`sort_order`(int); `status`(enum ACTIVE/ARCHIVED); ts. Idx: (subject_id).

**Skill (EXTEND)** — add `primary_domain_id?`(UUID-FK Restrict, nullable during backfill). Keep everything else;
existing uniques retained.

**SkillLevelExpectation** — auth identity. `id`; `skill_id`(FK Restrict); `level_id`(FK Restrict); `role`(enum
introduced/expected/reinforced/assessed/required_for_exit); `current_revision_id?`(FK, circular). Uniq:
(skill_id, level_id, role).
**SkillLevelExpectationRevision** — **immutable**. `id`; `expectation_id`(FK Restrict); `version_no`(int);
`required_evidence_kinds`(JSONB); `min_independence`(enum/int, null?); `criticality`(enum/int); `descriptor`
(str/JSONB); `published_at`(ts); `published_by`(FK). Uniq:(expectation_id, version_no).

**RoadmapPoint** — auth. `id`; `point_key`(str, uniq within track/curriculum); `subject_id`,`track_id`,
`level_id`(FK Restrict); `topic_id?`(FK Restrict, optional); `title`; `learning_outcome`(str/JSONB);
`sort_order`(int); `required_flag`(bool); `estimated_effort_min?`(int); `status`(ContainerStatus reuse); ts.
Uniq:(track_id/curriculum, point_key); (level_id, sort_order). Idx:(level_id, sort_order).
**RoadmapPointPrerequisite** — `id`; `point_id`(FK Cascade to owning point); `prerequisite_point_id`(FK
Restrict); ts. Uniq:(point_id, prerequisite_point_id). CHECK no-self-loop.
**RoadmapPointSkillExpectation** — `id`; `point_id`(FK Cascade); `expectation_id`(FK Restrict); `role`(enum
required/supporting/optional). Uniq:(point_id, expectation_id).

**TeachingBlueprint** — auth identity. `id`; `roadmap_point_id`(FK Restrict, uniq — 1:1); `published_revision_id?`
(FK, circular @unique).
**TeachingBlueprintRevision** — **immutable**. `id`; `blueprint_id`(FK Restrict); `version_no`(int);
`status`(RevisionStatus reuse); `content_brief_id?`(FK); `reviewed_by?`/`published_by?`(FK SetNull);
`published_at?`; ts. Uniq:(blueprint_id, version_no). **Ordered stages are relational rows** (below), not a JSON
blob (correction 1).
**TeachingBlueprintStage** — **immutable** (correction 1 — **CORE**). `id`; `blueprint_revision_id`(FK Cascade);
`position`(int); `stage_type`(enum concept/visual/rule/example/check/recognition/production/writing/listening/
reading/speaking/mixed/mastery/review); `branch_from_stage_id?`(self-FK Restrict — remediation branch source);
`config`(JSONB — intra-stage config: hint ladders, wording, branch conditions). Uniq:(blueprint_revision_id,
position). Idx:(blueprint_revision_id, position). Gives **stable stage identity within the pinned revision** for
ordering, branching, content bindings, and integrity/quality scoping.
**TeachingBlueprintContentBinding** — **immutable**. `id`; `blueprint_stage_id`(FK Cascade to **stage**);
`lesson_revision_id?`,`activity_id?`,`media_asset_id?`(typed nullable FK Restrict); `role`(enum
teach/practice/evidence/exposure); `position`(int). Uniq:(blueprint_stage_id, position). CHECK: exactly one
typed content FK non-null (XOR).

**MasteryRequirement** — auth identity. `id`; `roadmap_point_id`(FK Restrict, uniq 1:1); `current_revision_id?`.
**MasteryRequirementRevision** — **immutable**. `id`; `requirement_id`(FK Restrict); `version_no`(int);
`gates`(JSONB — critical gates, cumulative rules); `policy_version`(str); `published_at?`/`published_by?`. Uniq:
(requirement_id, version_no).
**MasteryRequirementSkillExpectation** — **immutable**. `id`; `requirement_revision_id`(FK Cascade);
`expectation_id`(FK Restrict); `role`(enum required/supporting/optional); `required_evidence_kinds`(JSONB);
`min_independence`(enum/int). Uniq:(requirement_revision_id, expectation_id).

**PlacementDecision** — **immutable** (§19). `id`; `user_id`(FK Restrict); `subject_id`,`track_id`(FK Restrict);
`source_attempt_id?`(FK Restrict); `policy_version`(str); `recommended_study_level_id?`(FK Level Restrict);
`decision_type`(enum); `supersedes_decision_id?`(self-FK Restrict, **new→old**); `decided_at`(ts);
`snapshot`(JSONB — **descriptive** decision-time snapshot: domain bands/assessment-states, human-readable
reasoning; **not** the authoritative FK graph, correction 4).
Idx:(user_id, subject_id, decided_at). Uniq(idempotency): partial unique on (source_attempt_id, policy_version)
WHERE source_attempt_id IS NOT NULL.
**PlacementDecisionValidation** — **immutable** (correction 4 — **CORE**). `id`; `placement_decision_id`(FK
Cascade); `skill_level_expectation_revision_id?`(FK Restrict) and/or `roadmap_point_id?`(FK Restrict);
`validation_kind`(enum evidence_backed/policy_prereq); `policy_version`(str). Uniq:(placement_decision_id,
target). This is the **load-bearing relational provenance** Roadmap consumes to write `VALIDATED` acquisition —
Roadmap never parses the JSON snapshot to learn what was validated. **Prerequisite gaps / repair targets** are
emitted as typed `LearnerSignal`s (with a relational skill/expectation/point target) generated from the
decision — no per-field table for the first flow (a `PlacementDecisionGap` table is a LATER option).

**TeachingSession** — fact. `id`; `user_id`(FK Restrict); `roadmap_point_id`(FK Restrict);
`blueprint_revision_id`(FK Restrict, pinned); `status`(enum NOT_STARTED/TEACHING/PRACTICING/REMEDIATING/
MASTERY_CHECK/COMPLETED); `current_step`(JSONB — resume: step/branch/hints); `started_at`; `completed_at?`; ts.
Idx:(user_id, status); (user_id, roadmap_point_id, status). Partial uniq: one non-terminal session per
(user_id, roadmap_point_id) [custom SQL].
**TeachingSessionContentPin** — **immutable**. `id`; `teaching_session_id`(FK Cascade); `lesson_revision_id?`/
`activity_id?`/`media_asset_id?`(typed nullable FK Restrict); ts. Uniq:(teaching_session_id, pinned-object).

**ActivityAttempt (EXTEND)** — add `teaching_session_id?`(FK SetNull) alongside existing
`learning_session_id?`/`review_session_id?`/`roadmap_item_id?`. Existing uniques/indexes retained.

**SkillMeasurement (EXTEND)** — add (all nullable): `evidence_kind?`(enum), `independence_level?`(enum/int),
`expectation_revision_id?`(FK Restrict), `ai_evaluation_id?`(FK Restrict), `detail_meta?`(JSONB). Keep
`source/scoreBp/confidenceBp/evidenceCount/observedAt/derivationVersion` + existing provenance FKs
(`attemptId`/`lessonId`/`reviewSessionId`) + **3 partial-unique idempotency indexes** unchanged. `confidenceBp`
semantics unchanged (coverage). **Multi-source provenance is relational via `SkillMeasurementEvidenceRef`
(correction 2), NOT a single content-revision column** — a measurement may summarize N source facts (e.g. one
diagnostic skill measurement over 4 `AssessmentResponse`s). An optional `task_content_revision_id?`(FK Restrict)
may exist **only as an optimization for a genuinely single-source measurement**, never as the general
provenance model.
**SkillMeasurementEvidenceRef** — **immutable** (correction 2 — **CORE**). `id`; `skill_measurement_id`(FK
Cascade — owned by the measurement); `assessment_response_id?`(FK Restrict); `activity_attempt_id?`(FK
Restrict); ts. **CHECK: exactly one source FK non-null (XOR)** (extensible to future atomic sources). Uniq:
partial `(skill_measurement_id, assessment_response_id) WHERE assessment_response_id IS NOT NULL` and the
`activity_attempt_id` equivalent. Idx:(assessment_response_id), (activity_attempt_id), (skill_measurement_id).
The referenced rows remain the **immutable raw facts**.

**MasteryEvaluation** — **immutable** (§20). `id`; `user_id`(FK Restrict); `roadmap_point_id`(FK Restrict);
`requirement_revision_id`(FK Restrict); `policy_version`(str); `evidence_watermark`(JSONB/ts — e.g. max
observed_at + measurement-id boundary considered); `result`(enum SATISFIED/NOT_SATISFIED/INSUFFICIENT);
`gate_summary`(JSONB — which gates passed/failed); `evaluated_at`(ts). Idx:(user_id, roadmap_point_id,
evaluated_at). Idempotency: partial uniq on (user_id, roadmap_point_id, requirement_revision_id, watermark-key).
**MasteryEvaluationEvidence** — **immutable** (correction 1 — **CORE**). `id`; `mastery_evaluation_id`(FK
Cascade — owned child; Cascade acceptable **only because `MasteryEvaluation` is itself a non-deletable historical
fact**); `skill_measurement_id`(FK **Restrict**); `evidence_role?`(enum/int — contribution role, optional);
`created_at`. Uniq:(mastery_evaluation_id, skill_measurement_id). Idx:(skill_measurement_id),
(mastery_evaluation_id). **Pins the exact evidence set** used — does **not** copy `SkillMeasurement` values; the
historical `MasteryEvaluation` and its evidence rows remain immutable.

**PointAcquisitionEvent** — **immutable** (§21). `id`; `user_id`(FK Restrict); `roadmap_point_id`(FK Restrict);
`acquisition_type`(enum LEARNED/VALIDATED); `mastery_evaluation_id?`(FK Restrict); `placement_decision_id?`(FK
Restrict); `policy_version?`(str); `acquired_at`(ts). CHECK: LEARNED ⇒ mastery_evaluation_id set & placement null;
VALIDATED ⇒ placement_decision_id set & mastery null (XOR by type). Idx:(user_id, roadmap_point_id, acquired_at).
Idempotency: partial uniq on (user_id, roadmap_point_id, acquisition_type, provenance_id) — prevents duplicate
write from the *same* cause; a genuine re-validation with a new cause is a new event. **Keyed on canonical point,
not generation → survives regeneration.**

**LearnerRoadmapGeneration** — derived, versioned. `id`; `user_id`(FK Restrict); `subject_id`,`track_id`(FK
Restrict); `generation_no`(int); `engine_version`(str); `source_placement_decision_id?`(FK Restrict);
`status`(enum CURRENT/SUPERSEDED); `supersedes_generation_id?`(self-FK); `generated_at`. Partial uniq: one
CURRENT per (user_id, subject_id) [custom SQL]. Idx:(user_id, subject_id, status).
**RoadmapPointProjection** — derived, rebuildable. `id`; `generation_id`(FK Cascade); `roadmap_point_id`(FK
Restrict); `sort_order`(int); `acquisition`(enum-cache NONE/LEARNED/VALIDATED, derived from events);
`availability`(enum-cache LOCKED/AVAILABLE/IN_PROGRESS/CONTENT_UNAVAILABLE, derived); `attention`(enum-cache
none/REVIEW_DUE/REPAIR_REQUIRED, derived); `reason?`(str/JSONB). Uniq:(generation_id, roadmap_point_id).
Idx:(generation_id, sort_order).

**EvidenceIntegrityDecision** — **immutable** (Layer C). `id`; `content_quality_issue_id?`(FK Restrict);
`outcome`(enum VALID/UNDER_REVIEW/INVALIDATED/QUALIFIED); `policy_version`(str); `reason`(str); `decided_by`(FK);
`decided_at`(ts). Idx:(decided_at).
**EvidenceIntegrityScope** — **immutable** (§8; corrections 3/2). `id`; `decision_id`(FK Cascade);
`scope_kind`(enum/lookup); **exactly one** typed nullable FK Restrict, chosen at the **narrowest** accurate
level:
- **`assessment_item_id?`** — the *immutable `AssessmentItem` itself* is defective (wrong prompt/options/answer
  key/item-scoring content) — affects **every** use of that item across versions.
- **`assessment_version_item_id?`** — the defect is only in the item's **membership/context inside a specific
  `AssessmentDefinitionVersion`** (bad version-specific override, wrong membership/context, version-specific
  presentation/scoring on the membership relation) — affects **only** evidence produced *through that
  version-item*, not other valid uses of the same `AssessmentItem` (correction 2).
- **`assessment_definition_version_id?`** — use **only** when the whole assessment version is affected. **Do not
  use this broad FK when a narrower `assessment_version_item_id` identifies the real defect.**
- plus `activity_id?`, `media_asset_id?`, `lesson_revision_id?`, `blueprint_stage_id?`, and `rubric_version` (via
  `scope_qualifier`).
`scope_qualifier?`(JSONB — answer-key/rubric version, localization variant — **never** hides
`AssessmentVersionItem` identity, which is a real FK). CHECK: exactly one typed FK non-null (XOR) per scope row;
a decision may have **multiple** scope rows for several independently-identified objects. Idx: **one per typed
load-bearing FK** (reverse lookup "which evidence affected by X?").

### 5a. Published AssessmentItem immutability (correction 3)

Audit confirms V1 reproducibility depends on it: `AssessmentAttempt → definitionVersion → AssessmentVersionItem
→ AssessmentItem.payload` (payload = learner-visible question + options + **answer key**). **Invariant
(explicit V2 persistence rule):** a **DRAFT `AssessmentItem` is mutable; once it is PUBLISHED / referenced by a
published `AssessmentDefinitionVersion`, its learner/scoring-relevant `payload` (question, options, answer key)
is IMMUTABLE.** A correction produces a **new `AssessmentItem` row** (and a new
`AssessmentDefinitionVersion`/pool membership where the pool must change) — never a silent in-place payload/
answer-key update on an item already used by historical attempts. The old item row **remains `Restrict`-
referenced** by historical version-membership and `AssessmentResponse`s, keeping `AssessmentAttempt →
definitionVersion → version-item → exact AssessmentItem` reproducible. **The existing `AssessmentItem` row IS
the immutable published unit — no `AssessmentItemRevision` table is introduced** (the audit does not prove one is
needed; item identity + a new-row-on-correction rule suffices, mirroring the existing `RevisionStatus`
DRAFT→PUBLISHED discipline). This immutability is an **application-enforced invariant** (like V1 published
`Activity`); the DB assists via `Restrict` on historical references. `EvidenceIntegrityScope` can therefore
target, at the **narrowest** accurate level (correction 2): the immutable **`AssessmentItem`** (item-level
defect, all versions), the **`AssessmentVersionItem`** membership (defect only within one version's
context/override — leaves other valid uses of the same item untouched), or the whole
**`AssessmentDefinitionVersion`** (only when genuinely version-wide).

**ContentReview** — fact. `id`; `blueprint_revision_id?`/`lesson_revision_id?`/`assessment_definition_version_id?`
(typed nullable FK Restrict, XOR); `policy_version_id`(FK); `outcome`(enum APPROVED/CHANGES_REQUESTED/BLOCKED);
`blockers`(JSONB — coded hard-blocker results); `reviewed_by`(FK); `reviewed_at`. **ContentBrief**,
**SourceReference**, **ContentSourceProvenance**, **ContentQualityPolicyVersion**, **ContentQualityIssue** — as
Phase 1 §C (QF tier); field detail deferred to Phase 3 (not on the critical single-point path).

## 6. Enum vs lookup vs string-registry (§13)

| Vocabulary | Recommendation | Why |
|---|---|---|
| domain status | **enum** (ACTIVE/ARCHIVED) | stable infra state (like `SkillStatus`) |
| subject **domains** themselves | **lookup rows** (`subject_domain`) | subject data, evolves |
| skill-expectation role | **enum** (small, stable pedagogy) | fixed set; extend via migration if ever |
| point acquisition type | **enum** (LEARNED/VALIDATED) | stable, XOR-checked |
| roadmap attention state | **enum** (none/REVIEW_DUE/REPAIR_REQUIRED) | small, stable; stored only as derived cache |
| evidence kind | **enum** (cross-subject, core) | stable core concept; extend rarely |
| independence level | **enum or small int** | ordinal, stable |
| misconception **category** | **lookup/registry** (Methodist) | evolving; matches V1 `categoryCode` string |
| misconception status | **enum** (ACTIVE/RESOLVED/EXPIRED) | reuse `SignalStatus` shape |
| integrity outcome | **enum** | small, stable |
| integrity scope kind | **enum, migration-extensible** (or lookup) | new scope kinds added deliberately |
| mastery evaluation outcome | **enum** | small, stable |
| teaching session status | **enum** | stable lifecycle |
| blueprint revision status | **reuse `RevisionStatus`** | identical semantics |
| quality issue status | **enum** (lifecycle) | stable |
| quality severity / **blocker kind** | **string registry / lookup** | product semantics evolve (like V1 readiness blocker codes) |
| **CEFR levels** | **DATA (`Level.code`)** — never enum | multi-subject; owner decision |

## 7. Unique-constraint plan (§14)

`subject_domain`(subjectId, code) · `skill`(subjectId, code) reused · `skill_family`(subjectId, code) [L] ·
`skill_level_expectation`(skillId, levelId, role) · `skill_level_expectation_revision`(expectationId, versionNo)
· `roadmap_point`(track/curriculum, pointKey) + (levelId, sortOrder) · `roadmap_point_prerequisite`(pointId,
prerequisitePointId) · `roadmap_point_skill_expectation`(pointId, expectationId) · `teaching_blueprint`
(roadmapPointId) · `teaching_blueprint_revision`(blueprintId, versionNo) · `teaching_blueprint_stage`
(blueprintRevisionId, position) · `teaching_blueprint_content_binding`(**blueprintStageId**, position) ·
`mastery_requirement`(roadmapPointId) · `mastery_requirement_revision`(requirementId, versionNo) ·
`mastery_requirement_skill_expectation`(requirementRevisionId, expectationId) · `placement_decision_validation`
(placementDecisionId, target) · `roadmap_point_projection`(generationId, roadmapPointId) ·
`mastery_evaluation_evidence`(masteryEvaluationId, skillMeasurementId) (correction 1 — the exact pinned set, no
duplicate rows). **Do not** force
uniqueness where multiple legitimate facts exist (measurements, attempts, acquisition re-validations, sessions
history). `skill_measurement_evidence_ref` uses partial uniques per source (§8), not a plain unique.

## 8. Partial-unique / CHECK plan (needs raw SQL — Prisma can't express) (§15)

| Constraint | Type | DB or app? |
|---|---|---|
| one non-terminal `TeachingSession` per (user, point) | partial unique | **DB** (custom SQL) |
| one CURRENT `LearnerRoadmapGeneration` per (user, subject) | partial unique | **DB** (mirrors V1 `ux_active_roadmap`) |
| `EvidenceIntegrityScope` exactly one typed FK | XOR CHECK | **DB** |
| `TeachingBlueprintContentBinding` exactly one content FK | XOR CHECK | **DB** |
| `SkillMeasurementEvidenceRef` exactly one source FK + partial uniques per source | XOR CHECK + partial unique | **DB** (correction 2) |
| published `AssessmentItem` payload/answer-key immutability | — | **APP** (new-row-on-correction, §5a) — DB assists via `Restrict` on historical refs (correction 3) |
| `PointAcquisitionEvent` type↔provenance XOR + idempotency | CHECK + partial unique | **DB** |
| `PlacementDecision` idempotency per finalized attempt+policy | partial unique | **DB** |
| `MasteryEvaluation` idempotency per (user, point, requirementRev, watermark) | partial unique | **DB** |
| `SkillMeasurement` existing 3 idempotency indexes + evidence_count>0 | partial unique + CHECK | **DB (retain)** |
| basis-point range 0..10000 (new bp columns) | CHECK | **DB** |
| `roadmap_point_prerequisite` no self-loop | CHECK | **DB** (direct only) |
| **point-graph multi-node DAG acyclicity** | — | **APP** (write-time validation) — *not* a simple CHECK; do not claim DB-enforceable |
| published-revision immutability | — | **APP** (like V1 published `Activity`) |

## 9. FK / onDelete policy (§16)

Archive-first (reuse V1): **Restrict** for canonical/published/history references; **Cascade** only for child
rows owned exclusively by a mutable draft/parent; **SetNull** for optional operational/cache linkage.

| FK | onDelete |
|---|---|
| RoadmapPoint → Level/Track/Topic | **Restrict** |
| BlueprintRevision → Blueprint | **Restrict** |
| BlueprintStage → BlueprintRevision | **Cascade** (owned child of a revision) |
| BlueprintContentBinding → BlueprintStage | **Cascade** (owned child of a stage) |
| BlueprintContentBinding → LessonRevision/Activity/Media | **Restrict** (referenced content) |
| SkillMeasurement → expectationRevision / taskContentRevision(opt) / aiEvaluation | **Restrict** |
| SkillMeasurementEvidenceRef → skillMeasurement | **Cascade**; → AssessmentResponse/ActivityAttempt | **Restrict** (immutable raw facts) |
| MasteryEvaluationEvidence → masteryEvaluation | **Cascade** (owned child — safe *only* because `MasteryEvaluation` is non-deletable, correction 1) |
| MasteryEvaluationEvidence → skillMeasurement | **Restrict** (immutable pinned evidence) |
| PointAcquisitionEvent → point / masteryEvaluation / placementDecision | **Restrict** |
| PlacementDecision → source attempt / supersedes decision | **Restrict** |
| PlacementDecisionValidation → placementDecision | **Cascade**; → expectationRevision/point | **Restrict** |
| TeachingSession → blueprintRevision / point | **Restrict** |
| TeachingSessionContentPin → session | **Cascade**; → content | **Restrict** |
| EvidenceIntegrityScope → decision | **Cascade**; → defective object | **Restrict** |
| ContentQualityIssue → revision/content | **Restrict** |
| RoadmapPointProjection → generation | **Cascade**; → point | **Restrict** |
| ActivityAttempt → teachingSession | **SetNull** (matches V1 session/roadmapItem) |

**Historical learner facts never disappear because canonical content is archived** — content is `ARCHIVED`, not
deleted; pinned revisions keep old sessions valid.

## 10. Index plan (§17)

`skill_measurement`(user_id, skill_id, observed_at) [reuse] · `skill_measurement_evidence_ref`
(assessment_response_id) & (activity_attempt_id) & (skill_measurement_id) [**the integrity-match path**,
correction 2] · `teaching_blueprint_stage`(blueprint_revision_id, position) · `learner_roadmap_generation`
(user_id, subject_id, status) · `roadmap_point_projection`(generation_id, sort_order) · `roadmap_point`
(level_id, sort_order) · `roadmap_point_prerequisite`(point_id) & (prerequisite_point_id) · `teaching_session`
(user_id, status) & (user_id, roadmap_point_id, status) · `point_acquisition_event`(user_id, roadmap_point_id,
acquired_at) · `placement_decision`(user_id, subject_id, decided_at) · `placement_decision_validation`
(placement_decision_id) & (skill_level_expectation_revision_id) · `mastery_evaluation_evidence`
(skill_measurement_id) & (mastery_evaluation_id) [**the evaluation-lineage path**, correction 1 — walk a
measurement forward to every evaluation that used it, and load an evaluation's exact evidence set] ·
`evidence_integrity_scope` one index **per typed FK** (incl. assessment_item_id, **assessment_version_item_id**,
assessment_definition_version_id) · content readiness: blueprint
current-pointer + revision status lookup · review-due: (user_id, status/dueAt) only **if** materialized ·
`content_quality_issue`(target ref, status, created_at). **No speculative per-column indexing.**

## 11. JSONB contracts (§18)

| JSONB field | Why JSONB | Schema-version key? | Contains identity/FK? | Immutable after publish? |
|---|---|---|---|---|
| `PlacementDecision.snapshot` | **descriptive** decision-time band/state + reasoning, audit only | **yes** | **NO** — validated targets are relational (`PlacementDecisionValidation`), evidence FK'd; snapshot is never the FK graph (correction 4) | **yes** |
| `SkillMeasurement.detail_meta` | hint/retry/per-item detail, non-join | yes | no (source provenance is relational — `SkillMeasurementEvidenceRef`, correction 2) | yes (append-only) |
| `TeachingBlueprintStage.config` | intra-stage config (hint ladders, wording, branch conditions) | yes | **no** — stage identity/order/branch-refs/bindings are **relational** (correction 1) | **yes** |
| `MasteryRequirementRevision.gates` | critical-gate/cumulative config | yes | no | **yes** |
| `*.policy config` (threshold/mastery/review/quality) | evolving Methodist tuning | yes | no | per policy version |
| `ContentReview.blockers` | coded blocker results | yes | no | yes |
| `AiEvaluation.rubric/providerMetadata` (reuse) | provider/rubric snapshot | reuse | no | yes |
**Rule:** never put a required join relationship only in JSON — content bindings, evidence provenance, integrity
scope, acquisition provenance are all **relational FKs**, not JSON.

## 12. PlacementDecision snapshot strategy (§19)

**Normalized vs snapshot split (correction 4).** Anything **load-bearing** for authoritative downstream facts is
**relational**, not hidden in JSON:
- **Relational references:** user, subject/track, source attempt, policy version, `supersedes_decision_id`
  (new→old), `recommended_study_level_id`.
- **`PlacementDecisionValidation` rows (relational):** the **validated targets** (`skill_level_expectation_revision_id`
  and/or `roadmap_point_id`) + `validation_kind` — this is what **Roadmap consumes to write `VALIDATED`
  acquisition**. Roadmap **never parses the JSON snapshot** to learn what was validated.
- **Prerequisite gaps / repair targets:** emitted as **typed `LearnerSignal`s** (with a relational
  skill/expectation/point target) generated from the decision — authoritative target identity is relational and
  auditable; no per-field table for the first flow (a `PlacementDecisionGap` table is a LATER option).
- **Snapshot (versioned JSONB) — descriptive only:** domain bands + assessment-state summaries, human-readable
  reasoning, policy output display. **The JSON snapshot is a historical descriptive snapshot, NOT a hidden
  foreign-key graph Roadmap must parse.**
**Why not use current projections later:** current projections are **recomputable and mutate** with new
evidence/policy; the decision must reproduce **what was decided at T under policy V** — a live projection would
give a *different* (later) answer. Hence the decision-time snapshot is captured immutably, raw evidence stays
FK-referenced (not copied), and the load-bearing validated targets are normalized.

## 13. MasteryEvaluation evidence linkage (§20)

**Recommended (correction 1): a relational `MasteryEvaluationEvidence` join is CORE — watermark alone is not
strong enough authoritative lineage.** Because a `MasteryEvaluation` can directly cause a
`PointAcquisitionEvent(LEARNED)`, we must answer *exactly* **"which immutable `SkillMeasurement`s did this
historical evaluation use?"** — **without** reconstructing an old query over a changing database. So the
evaluation **pins the exact evidence set** via `MasteryEvaluationEvidence` (`N → 1 SkillMeasurement`, immutable),
**not** by copying measurement values. `MasteryEvaluation` **also** keeps `evidence_watermark` + `policy_version`
+ `gate_summary` for *additional* reproducibility/query semantics — but the watermark is **not a substitute** for
the exact evidence lineage. Authoritative lineage chain: `SkillMeasurement → MasteryEvaluationEvidence →
MasteryEvaluation → PointAcquisitionEvent`.

## 14. Point-acquisition provenance (§21)

Typed nullable FKs + XOR CHECK (§5): `LEARNED → mastery_evaluation_id`, `VALIDATED → placement_decision_id`;
never opaque JSON for the authoritative cause. Idempotency (§8). **Acquisition is a learner + canonical-point
historical fact — it does NOT depend on a roadmap generation and SURVIVES regeneration.** The
`RoadmapPointProjection` (per generation) merely *reflects* the latest acquisition event.

## 15. Roadmap generation / projection (§22)

**Recommended: Option B — separate V2 `LearnerRoadmapGeneration` + `RoadmapPointProjection`; leave V1
`LearnerRoadmap`/`RoadmapItem` untouched.** Rationale: extending V1 `LearnerRoadmap` risks altering the running
V1 flow (which reads/writes it live); a parallel V2 generation model is strictly additive. Historical
generations preserved (SUPERSEDED); one CURRENT (partial unique); regeneration writes a new generation +
projection but **never rewrites `PointAcquisitionEvent`s**; efficient load via (generation_id, sort_order). V1
flat `RoadmapItem` keeps working until an explicit cutover swaps the read path.

## 16. Derived-projection persistence decisions (§23)

| Projection | Decision (v1) | Rationale |
|---|---|---|
| `LearnerSkillState` | **materialized (reuse)** | already exists; hot read; single-writer merge |
| RoadmapPointProjection | **materialized** | roadmap load is a frequent, multi-point query |
| domain / expectation-satisfaction | **compute-on-read** | cheaper than cache-invalidation; low frequency |
| retention / freshness | **compute-on-read** (reuse `review-due` clock derivation) | recomputable from history+clock |
| review candidate / due | **compute-on-read** initially; materialize if Daily-Plan hot | avoid stale due flags |
| roadmap attention | **compute-on-read**, or cache **on** the point projection | derived from active signals |
| roadmap availability | **cache on point projection**, recomputed on publish/withdraw | needs efficient "teachable?" |
| displayLevel | **cache (reuse column)** | UX only, never authoritative |
| current admissibility | **compute-on-read** | integrity decisions are rare; avoid materializing per-measurement |
**Do not persist everything cacheable** — materialize only `LearnerSkillState` + the roadmap point projection
(availability/attention as cache columns on it) initially.

## 17. Content-Quality persistence minimum (§24)

**Required before safe V2 teaching publication (QF):** `ContentBrief` (or equivalent), `SourceReference` +
`ContentSourceProvenance` (basics), `ContentReview` + result (hard-blocker codes), `ContentQualityPolicyVersion`,
`EvidenceIntegrityDecision` + `EvidenceIntegrityScope`, approval provenance (reuse `StaffAudit`). **Can wait
(L):** `ContentQualitySignal`, item analytics, observability dashboards, rich review workflow. Architecture stays
compatible: the QF minimum is additive and the L items only add read/observe surfaces.

## 18. Migration sequence — additive waves (FK-ordered) (§25)

1. **W1 Canonical vocabulary:** `subject_domain`; `Skill.primary_domain_id?`; `skill_level_expectation(+rev)`;
   `roadmap_point(+prereq+skill_expectation)`; `mastery_requirement(+rev+skill_expectation)`. (Level reused.)
2. **W2 Blueprints:** `teaching_blueprint(+rev)`; **`teaching_blueprint_stage`** (relational, correction 1);
   `teaching_blueprint_content_binding` (→ stage).
3. **W3 Learner immutable facts:** `placement_decision` **+ `placement_decision_validation`** (correction 4);
   `teaching_session(+content_pin)`; `ActivityAttempt.teaching_session_id?`; `SkillMeasurement` V2 columns
   **+ `skill_measurement_evidence_ref`** (correction 2); `mastery_evaluation` **+ `mastery_evaluation_evidence`**
   (correction 1 — pins the exact SkillMeasurement set, FK-ordered after both); `point_acquisition_event`.
   *(Published-`AssessmentItem` immutability (correction 3) is an application invariant — no new table.)*
4. **W4 Roadmap V2:** `learner_roadmap_generation`; `roadmap_point_projection`. (V1 roadmap untouched)
5. **W5 Content-Quality minimum + integrity:** `content_quality_policy_version`; `content_brief`;
   `source_reference(+provenance)`; `content_review`; `content_quality_issue`; `evidence_integrity_decision(+scope)`.
6. **W6 Backfill English A1 mappings** (§19). 7. **W7 Dual-read / shadow compute.** 8. **W8 Controlled cutover.**
**No V1 table is dropped in any wave.** Every wave is additive; new columns are nullable with no V1 semantics.

## 19. Backfill strategy — mechanical vs Methodist (§26)

| A1 V1 data | Backfill | Mechanical or **Methodist**? |
|---|---|---|
| Subject English / Track General English / Level A1 | reuse rows as progression identities | **mechanical** |
| 13 Skills | assign `primary_domain_id` | **Methodist** (which domain each skill belongs to) |
| SubjectDomain rows (Grammar…Pronunciation) | create | **Methodist** (define the set) |
| SkillLevelExpectation @A1 (+rev) | create per skill | **Methodist** (role + evidence kinds) |
| RoadmapPoints for A1 | synthesize over topics/lessons | **Methodist** (point boundaries ≠ lesson boundaries) |
| RoadmapPointSkillExpectation | map points→skills | **Methodist** |
| RoadmapPointPrerequisite | from lesson prereqs as a *hint* | **Methodist** (point-level DAG is a pedagogical decision) |
| TeachingBlueprint(+rev)+bindings | wrap existing A1 `LessonRevision`s | **mechanical scaffold + Methodist review** |
| MasteryRequirement(+rev) | author per point | **Methodist** (evidence/independence gates) |
| LessonSkill/ActivitySkill | reuse; add primary/supporting role | **mechanical + Methodist role** |
| `SkillMeasurementEvidenceRef` for **existing V1** measurements | **not mechanically backfillable** — the existing `attemptId`/`lessonId`/`reviewSessionId` provenance on those rows **stays valid**; V2 populates evidence-refs for **newly-derived V2 measurements only** | **honest gap — documented, not faked** |

**Critical distinction:** only Subject/Track/Level reuse and blueprint-scaffolding are mechanical; **domains,
expectations, point boundaries, prerequisites, and mastery requirements require Methodist-authored data — do not
auto-invent pedagogical mappings.**

## 20. V1 coexistence contract (§27)

Until cutover: V1 continues reading/writing `LearnerRoadmap`, `RoadmapItem`, `LearnerLessonProgress`, and
existing `SkillMeasurement` columns **unchanged**. All V2 additions are **additive**: new tables + **nullable**
new columns with **no V1 semantics/defaults that change behavior**. V2 services may **shadow-compute** (write V2
generation/projection, evaluate requirements) but **must not alter V1 learner-visible behavior** until explicit
cutover. **No destructive rename/drop**; no repurposing of `RoadmapItem`/`LearnerLessonProgress` meaning.

## 21. Reward / finance crossing (§28)

No finance redesign. Persistence boundary only: reward/XP may **later** consume `PointAcquisitionEvent` **only
if** an explicit Reward policy opts in — **`VALIDATED` acquisition must NOT auto-produce lesson-completion
reward, and acquisition alone must NOT auto-grant XP/IZL**. Existing `RewardGrant`/`XpGrant`/
`DailyMissionCompletion` provenance keeps referencing genuine learning facts (`ActivityAttempt`/
`LearningSession`/completion). V2 adds no reward coupling in this plan.

## 22. Performance / scale (§29)

**High-write/high-growth:** `ActivityAttempt`, `AssessmentResponse`, `SkillMeasurement`,
`SkillMeasurementEvidenceRef`, `MasteryEvaluationEvidence`, `TeachingSession` attempts, `PointAcquisitionEvent`,
signals/history. Keep them **narrow + indexed** (reuse V1 index shapes); use `detail_meta` JSONB for detail but
**no giant JSON arrays** for relationships. The two evidence-join tables are the deliberate cost of **queryable
lineage instead of copied values** — each is narrow (two FKs + role) and both directions are indexed (§10).
Integrity incidents cause **zero fan-out writes** to measurements or evaluations (scope-match at recompute, §8).
**Integrity-match query path (corrections 1/2/3):** `EvidenceIntegrityScope` typed target —
`assessment_item_id` (item defect, **all** versions) *or* `assessment_version_item_id` (defect only in **one
version's** membership/context/override, correction 2) *or* `activity_id` / `assessment_definition_version_id` —
→ the affected `AssessmentResponse`s/`ActivityAttempt`s (indexed) → `SkillMeasurementEvidenceRef` (indexed by
source) → the affected `SkillMeasurement`s → **`MasteryEvaluationEvidence` (indexed by measurement) → the exact
historical `MasteryEvaluation`s that used them → their `PointAcquisitionEvent`s** (correction 1) → **targeted**
recompute of just those learners' projections. This whole chain is answerable by **indexed joins over pinned
rows** — never by re-running an old evidence query over a mutated database. **No measurement or evaluation row is
updated.** **No partitioning now** (append-only shape makes it a non-destructive later option).

## 23. Security / audit (§30)

`StaffAudit` (reuse) for: canonical Domain/Skill/Expectation changes, RoadmapPoint publication, Blueprint
publication, MasteryRequirement publication, Content-Quality approval, `EvidenceIntegrityDecision`, critical
withdrawal/deprecation. Learner-generated facts carry their own actor via `user_id`. (No authorization
middleware designed here.)

## 24. Persistence anti-patterns — confirmed rejected (§31)

`Skill.levelId` ✗ (→ `SkillLevelExpectation`) · mutable `SkillMeasurement.isValid` ✗ (→ integrity decision +
derived admissibility) · authoritative `User.currentLevel` ✗ (→ decision/projection/position/cache split) ·
`RoadmapPoint == Lesson` ✗ · `TeachingBlueprint == LessonRevision` ✗ · duplicated MasteryRequirement in Mastery
tables ✗ (→ evaluated only) · `MasteryEvaluation.mastered` as acquisition authority ✗ (→ `PointAcquisitionEvent`)
· validation creating `LearnerLessonCompletion` ✗ · independently-editable roadmap availability boolean ✗ (→
derived) · current admissibility stored as permanent fact ✗ (→ derived) · `ENGINE_RECALC` consumed as evidence ✗
· `oldPlacementDecision.supersededBy` mutation ✗ (→ new→old `supersedes_decision_id`) · `LearnerSignal` as raw
evidence ✗ · Roadmap Attention as reason source ✗ · giant JSON arrays instead of FK relationships ✗ ·
reconstructing which `SkillMeasurement`s an old `MasteryEvaluation` used by **re-running its evidence query over
the current (changed) DB** ✗ (→ pinned `MasteryEvaluationEvidence` rows, correction 1) · **copying full
`SkillMeasurement` values into the evaluation** as a substitute for the lineage FK ✗ (→ reference the immutable
measurement, never duplicate it) · watermark/`evidence_watermark` alone treated as sufficient authoritative
lineage ✗ (→ watermark is *additional* reproducibility, not a replacement for the exact pinned set) ·
`EvidenceIntegrityScope` widening a **single-version** membership/context defect to the whole `AssessmentItem`
(invalidating other valid uses) ✗ (→ target `assessment_version_item_id`, correction 2) · hiding
`AssessmentVersionItem` identity inside `scopeQualifier` JSON ✗ (→ typed, indexed FK).

## 25. Worked persistence trace — Present Simple (§32)

**Canonical (W1–W2):** `subject_domain(Grammar)`; `skill(apply-3SG, …, primary_domain=Grammar)`;
`skill_level_expectation(3SG,@A1,assessed)` + `_revision v1`; `roadmap_point(present-simple, level=A1)` +
`roadmap_point_skill_expectation`; `teaching_blueprint` → `_revision v3` → **`teaching_blueprint_stage`s**
(concept/visual/rule/check/production/mastery, ordered) → `teaching_blueprint_content_binding`(stage → A1
`LessonRevision`s/activities); `mastery_requirement` → `_revision v1` + `mastery_requirement_skill_expectation`
(3SG required, independent-production).
**Learner (W3):** `teaching_session`(user, point, pins blueprint v3) + `teaching_session_content_pin`;
`activity_attempt`s (teaching_session_id set) → `skill_measurement`s (evidence_kind, independence,
expectation_rev v1) each with `skill_measurement_evidence_ref`s → the contributing `activity_attempt`(s);
`mastery_evaluation`(requirement rev v1, watermark, SATISFIED) **+ `mastery_evaluation_evidence` rows pinning the
exact `skill_measurement`s this evaluation used** (correction 1) → **`point_acquisition_event(LEARNED,
mastery_evaluation_id)`**. **Derived:** `learner_skill_state` recomputes; `roadmap_point_projection.acquisition=
LEARNED`.
**Review:** `learner_review_session` → attempts → measurements (review-recall, own evidence-refs) → freshness
recompute → possible `learner_signal(REVIEW_DUE)` → projection attention.
**Defect:** `content_quality_issue` → `evidence_integrity_decision(INVALIDATED)` + `evidence_integrity_scope`
(activity_id = the bad item) → **join** scope → affected `activity_attempt`s → `skill_measurement_evidence_ref`
→ affected `skill_measurement`s → **`mastery_evaluation_evidence` → the exact historical `mastery_evaluation`s
that relied on them → their `point_acquisition_event(LEARNED)` rows are now *identifiable*** (correction 1) →
recompute **excludes/qualifies** the tainted measurements → `learner_skill_state`/projection update, and any
now-unsupported acquisition is flagged for re-evaluation. **Historical `skill_measurement`, `activity_attempt`,
`teaching_session`, `mastery_evaluation`, and the `point_acquisition_event` rows are NOT modified** — the lineage
is *read*, never rewritten. **Scope narrowness (correction 2):** had the defect instead been an *assessment*
item, the decision would scope to `assessment_item_id` when the item itself is wrong (taints **every** version's
uses) but to `assessment_version_item_id` when only **one version's** membership/context/override is wrong —
leaving other valid uses of the same item, and their measurements/evaluations/acquisitions, untouched.

## 26. Worked persistence trace — Claimed B2 (§33)

`assessment_attempt`(REASSESSMENT, pins version) → **4 `assessment_response`s** → one `skill_measurement`
(DIAGNOSTIC) per skill, each linked to its contributing responses via **`skill_measurement_evidence_ref`s
(4→1)** → domain **projections** (compute-on-read) → **`placement_decision`** (recommended_study_level=B2;
policy version; source attempt FK; `supersedes_decision_id` if a prior decision; **descriptive** `snapshot` =
{Grammar/Reading strong, Listening weak, Writing/Speaking `NOT_ASSESSED`}) + **`placement_decision_validation`
rows** (relational: the validated expectation-revs/points — the load-bearing targets, correction 4) → Roadmap
reads the **validation rows** (not the JSON) → new `learner_roadmap_generation` + `roadmap_point_projection`s →
**`point_acquisition_event(VALIDATED, placement_decision_id)`** for validated points (**no
`learner_lesson_completion`**) → `learner_signal`(REPAIR/prereq, relational Listening target) → projection
attention. Writing/Speaking remain `NOT_ASSESSED` (never 0). No fake completion rows.

## 27. Final model count & complexity review (§34)

**~21 new CORE tables** for one V2 point flow — up 4 from the corrections: **`TeachingBlueprintStage`**
(promoted to CORE, correction 1 of the first round), **`SkillMeasurementEvidenceRef`** (correction 2 of the first
round), **`PlacementDecisionValidation`** (correction 4 of the first round), and now **`MasteryEvaluationEvidence`**
(promoted to CORE, correction 1 of this round — pins the exact `SkillMeasurement` set an evaluation used). Six
identity+revision pairs drive much of the count (the established V1 `Lesson`/`LessonRevision` two-table pattern).
**~7 QF tables** before V2 publish. **~8 LATER/derived** deferred (misconception/family/signal-analytics/gap
tables, Section) — **`MasteryEvaluationEvidence` is no longer among them** (it is now CORE). **Complexity check:**
a learner can still be taught → evaluated → acquire a point using **CORE only** (no misconception/family/
signal-analytics tables). The four added tables are **load-bearing relational joins** (stage identity, evidence
provenance, validated targets, evaluation-evidence lineage) — deliberately chosen over opaque JSON / copied
values / future destructive redesign. If Phase 3 finds the CORE
identity+revision pairs excessive, the fallback is to collapse the lowest-risk pairs (expectation, requirement)
into single versioned tables with a current-pointer — but the pair pattern is preferred for reproducibility and
V1 consistency. **Verdict: practical, not over-normalized; a few load-bearing joins beat hidden JSON.**

## 28. Remaining open questions (non-structural — deferred by design)

Numeric thresholds/floors/intervals/hint-weights (policy config); exact JSONB schemas per policy; whether
attention/availability materialize on the projection vs compute-on-read at scale; exact evidence-kind/scope-kind
enum values; STT/AI provider; rubric schema; item-analytics. **None reopens ownership or the seven structural
decisions.**

## 29. Recommended next phase (§36)

**DATA MODEL V2 — PHASE 3: Prisma Schema Change Plan** — exact Prisma model/field definitions, migration
ordering (the W1–W8 waves), custom-SQL constraints (§8 list), backfill plan (§19 mechanical-vs-Methodist),
shadow-verification + rollback boundaries — **with owner review before any migration is executed.** No Prisma is
written until then.
