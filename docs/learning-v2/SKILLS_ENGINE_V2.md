# Skills Engine V2 — Specification

> **Status:** SPECIFICATION ONLY. No code, Prisma/schema, migration, endpoint, runtime, test, or deployment
> change is implied. V1 / CONTROLLED_RC keeps running unchanged.
>
> **Companions:** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md),
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md), [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md),
> [`TEACHING_ENGINE_V2.md`](./TEACHING_ENGINE_V2.md).
>
> **Grounding (verified against current code):** `Skill` (`content.prisma:226-251`: `subjectId`, `name`,
> `code?`, `description?`, `sortOrder`, `status` — **no domain/level/family/prerequisite/expectation**);
> `LessonSkill`/`ActivitySkill` (`:253-277`: bare join tables); `LessonPrerequisite` (`:283`, per-lesson DAG);
> `LearnerSkillState` (`learning.prisma:213-229`: `masteryScoreBp`, `confidenceBp?`, `evidenceCount`,
> `displayLevel?` derived cache — no FK to `Level`, `lastMeasurementAt`); `SkillMeasurement` (`:231-261`:
> append-only; `source`, provenance FKs, `scoreBp`, `confidenceBp?`, `evidenceCount>0`, `observedAt`,
> `derivationVersion` — no evidence-kind/independence/expectation/task-context); derivations
> `DiagnosticSkillProfileEngine` (`skill-profile-diagnostic-v1`: difficulty-aware, `coverageConfidenceBp`),
> `deriveLessonMastery` (`lesson-mastery-v1`: mean best MASTERY_TEST, `confidenceBp` hard-coded 10000),
> `deriveReviewMastery` (`review-mastery-v1`), merge `mergeSkillV2` (single writer `LearningProgressService`;
> anchors DIAGNOSTIC|CHECKPOINT, incrementals LESSON_MASTERY|REVIEW_MASTERY; `effectiveWeight = evidenceCount ×
> confidenceBp`). Accepted decisions cited D-xx. **Exact schema/enum names deferred** (owner) — this fixes the
> *domain contract*, not identifiers.

---

## 1. Purpose

The Skills Engine is the **shared vocabulary of ability** every other engine speaks. It answers: what abilities
does a subject contain? which **domain** does a skill belong to? at which **levels** is a skill introduced /
expected / reinforced / assessed? what **kinds of evidence** can demonstrate it, and **how strong** is that
evidence? what is **not yet measured**? how do per-skill facts **aggregate** into domain/level projections? — so
Placement, Roadmap, Teaching, and Mastery/Review all talk about the *same* skill with the *same* evidence
semantics.

It must **not** decide: the learner's daily schedule, the detailed Teaching session flow, long-term review
timing, or formal certification. It **owns the model of skills and evidence**; other engines own the decisions
made from it.

## 2. Principles

1. **Subject → Domain → Skill.** Domains are first-class and **subject-scoped** (no architecture-wide English
   enum). A skill has a **primary domain home** (§4).
2. **A skill is a stable pedagogical ability, not a level and not a title.** Stable identity ≠ learner-facing
   text (§5).
3. **Skill ↔ Level is an association, not ownership.** A skill is introduced at one level and expected/
   reinforced/assessed at later ones (§8).
4. **Recognition ≠ production**; **exposure ≠ practice ≠ evidence**; **NOT_ASSESSED ≠ 0** — three hard
   invariants (§12/§13/§18).
5. **Evidence has a *kind* and *independence*, not just a score.** Scaffolded evidence ≠ unaided evidence
   (§11/§14).
6. **`confidenceBp` is coverage, not certainty** — four distinct notions kept separate (§17).
7. **Domain/level scores are projections over skill evidence**, never an independent truth that can contradict
   the skills (§19/§20).
8. **Canonical skills/domains/expectations are Methodist/verified-content owned**; AI classifies/suggests, never
   invents (§ authoring, §26-28 contracts).
9. **History is durable and interpretable**: append-only measurements are evidence facts; learner state is a
   recomputable projection; expectation/policy versions keep old evidence meaningful (§25).
10. **Skills Engine models; other engines decide** — clear contracts, no competing placement/roadmap/review
    decisions (§26-29).

## 3. Definitions

| Term | Meaning |
|---|---|
| **Domain** | A subject-scoped competency area (English: Grammar, Vocabulary, Reading, Listening, Writing, Speaking, Pronunciation). |
| **Skill** | A stable, actionable pedagogical ability with a primary domain (e.g. "apply 3rd-person singular *-s*"). |
| **Skill family** | An authoring/UI/reporting grouping of related skills (e.g. the *to be* family) (§7). |
| **Skill-level expectation** | What performance on a skill *means* at a given level — introduced/expected/reinforced/assessed + required evidence kinds/independence/complexity (§8). |
| **Evidence** | A response/result supporting an inference about a skill, with a **kind** and **provenance** (§11). |
| **Measurement** | A persisted evidence fact (append-only `SkillMeasurement` today; richer in V2, §15). |
| **Learner skill state** | A compact, recomputable *current* projection over a learner's measurements (§16). |
| **Projection** | A derived read (domain band, level band, progress) computed from skill evidence — never a competing store (§19/§20). |

## 4. Subject domains

- **Subject → Domains → Skills.** Domains are **first-class and subject-scoped**; English's initial set:
  Grammar, Vocabulary, Reading, Listening, Writing, Speaking, Pronunciation.
- Other subjects define their own: *Math* → Arithmetic / Algebra / Geometry / Problem Solving; *History* →
  Chronology / Source Analysis / Historical Reasoning / Topic Knowledge. **No architecture-wide English-only
  domain enum.**
- **A skill has a primary diagnostic/domain home.** Genuinely cross-domain teaching is represented through
  **multiple skill mappings** (§20), not by pretending one skill score belongs to several domains
  automatically.
- **Current gap:** `Skill` has `subjectId` only — **no domain**. Domain is NEW (§32/§35).

## 5. Skill identity

A skill is a **stable pedagogical ability/concept**, e.g. `ENG-GRAMMAR-BE-AFFIRMATIVE`,
`ENG-GRAMMAR-PRESENT-SIMPLE-3SG`, `ENG-READING-MAIN-IDEA`, `ENG-LISTENING-SPECIFIC-DETAIL`.
- Identity is a **stable key/code**, never the learner-facing title/text.
- Conceptually a skill needs: stable key/code · subject · **primary domain** · title/name · description ·
  pedagogical meaning · status · version/metadata where needed.
- **Current support:** `Skill.code?` exists (a "recommended stable identifier") and `@@unique([subjectId,
  code])` — reuse it as the stable key; make `code` first-class and required in V2. `name` must not be identity
  (it is learner-facing). EXTEND.

## 6. Skill granularity

A skill must be at a **useful, actionable** grain:
- **Too broad (those are domains):** "Grammar", "Writing" — reject as skills.
- **Too microscopic:** "uses word X correctly in sentence Y" — reject.
- A skill is right-sized when **Placement can diagnose it, Teaching can target it, Roadmap can repair it, Review
  can revisit it, and evidence can be attributed to it.**
- **Split/merge guidance:** split when two abilities have *different level expectations, different evidence
  kinds, or different misconceptions* (e.g. "form Present Simple affirmative" vs "apply 3SG *-s*"); merge when
  they are always taught, practiced, and assessed together with the same expectation.

## 7. Skill families / groups

- Related skills form a **family** for **authoring, UI, diagnostics, reporting** — e.g. *to be* {affirmative,
  negative, questions}; *Present Simple* {use, affirmative, 3SG, negative, questions}.
- Families aid organization and reporting; **individual evidence still targets real skills**, never the family
  as a blob.
- Conceptual grouping mechanism (schema deferred, §32); NEW.

## 8. Skill-level expectations

A skill relates to **multiple** CEFR levels via a **Skill-Level Expectation** (not `Skill.levelId`). It may
express: **introduced** · **expected** · **reinforced/reviewed** · **assessed** · **required for level exit**.
- Example: *Present Simple* introduced at A1, still expected at A2, reinforced inside larger tasks at B1 — the
  same stable skill, different expectations per level (§30).
- **An expectation is more than a tag** (§4 of the owner brief): it can carry *required evidence kinds*,
  *expected independence*, *expected complexity*, *allowed scaffolding*, *task difficulty/context*, *required
  consistency*, *exit importance/criticality*. "Writing a sentence at A1" ≠ "writing an argument at B2" even for
  a related skill.
- **Current gap:** no skill↔level association at all (`displayLevel` is a nullable derived cache with no FK).
  NEW (§32/§35). Exact thresholds/descriptors deferred.

## 9. CEFR / product-level semantics

- For English, A1–C2 are **first-class learner-facing levels** (owner; `PLACEMENT_ENGINE_V2.md`/
  `ROADMAP_ENGINE_V2.md`). The Skills Engine must eventually answer *"what does B2 performance on this skill
  mean?"* via the expectation model (§8), not merely "skill X is tagged B2".
- Level meaning is **subject configuration** (CEFR for English), not engine-hardcoded (§ multi-subject).
- CEFR descriptors themselves are **Methodist/verified-content**; product-model illustrations in this doc (§18)
  are labeled as such, not an official standard.

## 10. Knowledge / receptive / productive / pronunciation distinctions

Skills differ in kind, and **evidence rules must differ accordingly**:
- **Knowledge / conceptual:** understands Present Simple form; recognizes subject pronouns.
- **Receptive performance:** reading comprehension; listening comprehension.
- **Productive performance:** writing; speaking.
- **Pronunciation / perception:** distinguishes sounds; produces a word intelligibly.
Do **not** force identical evidence requirements across these — a knowledge skill may be satisfiable by
recognition; a productive skill requires production evidence (§12).

## 11. Evidence taxonomy

Today a measurement records only `scoreBp` + `confidenceBp` + `evidenceCount` + `source`. V2 must reason about
**what kind** of evidence produced the score. Conceptual **evidence kinds** (enum names deferred): `RECOGNITION`
· `CONTROLLED_PRODUCTION` · `GUIDED_PRODUCTION` · `INDEPENDENT_PRODUCTION` · `READING_COMPREHENSION` ·
`LISTENING_COMPREHENSION` · `SPEAKING_PERFORMANCE` · `PRONUNCIATION_PERFORMANCE` · `REVIEW_RECALL`.

Every measurement also retains **provenance**: placement diagnostic · teaching session · mastery check ·
checkpoint · reassessment · review · AI/rubric evaluation (where allowed). (Today `SkillMeasurementSource`
carries the coarse source; V2 adds the finer *evidence kind* + task context.)

## 12. Recognition ≠ production

A strong invariant. *Choosing "She **is** a doctor"* does **not** prove the learner can independently write
*"My sister is a student."* Recognition evidence may satisfy some knowledge skills/tasks but is **not
automatically** productive mastery.
- The **Skill-Level Expectation** declares **required evidence diversity** (e.g. a B2 writing expectation
  requires `INDEPENDENT_PRODUCTION`, not just `RECOGNITION`).
- Aggregation/derivation must respect evidence kind: recognition-only evidence cannot satisfy an expectation
  that requires production (§20; Scenario A).

## 13. Exposure ≠ practice ≠ evidence

Four distinct semantics:
- **Exposure:** the learner saw/heard content (e.g. an audio model, an explanation card).
- **Practice:** the learner attempted a task.
- **Evidence:** a response/result that supports an inference about a skill.
- **Mastery evidence:** evidence meeting stronger requirements (kind + independence + sufficiency).
- **Do not treat media consumption as skill proof.** Listening to an audio model = exposure; answering a
  listening comprehension question = evidence; an independent speaking response evaluated under rubric =
  productive evidence (§20; Scenario H).

## 14. Scaffolding / independence

A correct answer after heavy scaffolding is useful, but **not identical** to an independent one:
`INDEPENDENT correct > correct after one small hint > correct after a worked example > copied/completed answer.`
- Evidence semantics must **preserve**: hints used · scaffold level · retries · remediation branch ·
  independence level — do **not** reduce everything immediately to one raw score.
- The Skill-Level Expectation can require a minimum **independence** for an evidence kind to count toward
  mastery (§8/§12). Exact penalties/weights deferred (Scenario B).

## 15. Measurement model

Preserve the valuable current invariant: **historical measurements are append-only evidence facts; derived
learner state is recomputable** from them. V2 measurements likely need richer metadata (schema deferred):
`evidence kind (§11)` · `domain` · `skill-level expectation targeted` · `independence/scaffold (§14)` ·
`rubric/version` · `source/provenance` · `task difficulty/context` · `observedAt` (keep — logical evidence
time) · `derivationVersion` (keep) · `expectation/policy version (§25)`.
- **Current gap:** `SkillMeasurement` carries `scoreBp`/`confidenceBp`/`evidenceCount`/`source`/`observedAt`/
  `derivationVersion` only — none of the italicized richness above. EXTEND (additive), keep append-only +
  idempotency + provenance.

## 16. Current skill state

Keep a **compact current projection** (fast reads), but do **not** force all rich evidence into that one row.
The V2 current state may include (fields deferred): current performance/mastery estimate · coverage/sufficiency
· most recently demonstrated **expectation** · **evidence diversity** · last meaningful evidence · weak
misconception signals where relevant.
- **Append-only measurement history remains the primary record**; the state is a recomputable cache (today's
  single-writer merge model, `LearningProgressService`, stays — reused).
- **Current gap:** `LearnerSkillState` has `masteryScoreBp`/`confidenceBp`/`evidenceCount`/`displayLevel`/
  `lastMeasurementAt` — no evidence-diversity, independence, per-expectation, or misconception dimension.
  EXTEND (compact projection + a few fields; richness lives in history + on-demand projections).

## 17. Coverage / sufficiency / certainty (the `confidenceBp` correction)

V1 `confidenceBp` means evidence **coverage** — **not** psychometric certainty and **not** "probability the
learner knows the skill." Preserve this. V2 keeps **four** notions distinct and never overloads one field:
- **A. Mastery/performance estimate** — how well the learner performs (`masteryScoreBp` today).
- **B. Evidence coverage** — how much evidence relative to a target (today's `confidenceBp`;
  `LESSON_/REVIEW_MASTERY` even hard-code it to `10000`).
- **C. Evidence sufficiency** — is there *enough* of the *right kinds* to decide at all (feeds
  Placement/Roadmap gates).
- **D. Decision confidence/certainty** — how sure a *decision* is (a future, possibly psychometric, measure).
Exact persistence/formulas deferred; **do not** compute D from B.

## 18. Assessment states & NOT_ASSESSED semantics

**Lack of evidence is not failure.** But "assessed vs not" is not binary — a skill/domain/expectation is in one
of at least **three** conceptual **assessment states** (a facet of *evidence sufficiency*, §17 notion C; enum
names deferred):

| State | Meaning |
|---|---|
| **`NOT_ASSESSED`** | No meaningful evidence exists for the required expectation/domain. |
| **`INSUFFICIENT_EVIDENCE`** | Some evidence exists, but it is **not enough** (coverage / diversity / independence) for a reliable expectation/domain decision. |
| **`SUFFICIENTLY_ASSESSED`** | Evidence satisfies the relevant policy's coverage / diversity / independence requirements enough to produce a decision/projection. |

Worked (Writing):
- no productive task attempted → **`NOT_ASSESSED`**;
- one heavily-scaffolded sentence completed → **`INSUFFICIENT_EVIDENCE`** for a B2 Writing judgment (not 0, not
  fully assessed — the middle case must not collapse to either extreme);
- the required B2 task set completed with sufficient **independent** evidence → **`SUFFICIENTLY_ASSESSED`**.

**`NOT_ASSESSED` / `INSUFFICIENT_EVIDENCE` are never converted to 0.** They may be **excluded from a numeric
calculation**, but they must remain **visible in coverage/sufficiency** and **may prevent** a Placement /
level-validation decision when that domain is required. Concretely, this must **not** happen:

```
Grammar    95            Listening  NOT_ASSESSED
Reading    94            Writing    NOT_ASSESSED     →  ✗  "Overall = 94.5%, therefore B2 validated"
                         Speaking   NOT_ASSESSED
```
Averaging only the two measured domains and validating B2 **hides** that required domains are unassessed. The
Skills Engine surfaces per-domain assessment state + coverage; **Placement owns the decision** and its
required-domain floors (`PLACEMENT_ENGINE_V2.md` §10) see the unassessed required domains and withhold
validation.

- These states must hold **consistently** across Placement, Skill Profile, Roadmap decisions, level
  aggregation, and progress UI.
- Mirrors the Placement/Teaching honest-degradation rules (`PLACEMENT_ENGINE_V2.md` §17, `TEACHING_ENGINE_V2.md`
  §24/§29). (Scenario C/F.)

## 19. Domain aggregation

A **domain band** (e.g. Grammar B2) is a **projection over the domain's underlying skill evidence** — **never** a
separate independent truth that can contradict the skills.
- Methodist-owned **policy** defines: required skill sets · critical skills · coverage minimum · expected
  evidence types · level-specific requirements.
- A domain aggregate must respect §11/§12/§14/§18 — recognition-only, scaffolded, not-assessed, or
  insufficient evidence is weighted (or excluded) accordingly.
- **A projection is not a naked score.** A domain/level projection must conceptually carry **both** an
  estimated performance/**band** (where derivable) **and** its **coverage / sufficiency / evidence-diversity**
  metadata — it must **not** be represented as only `Grammar = 87%`, because a bare number hides whether the
  87% rests on sufficient evidence. Prefer semantics like:
  ```
  Grammar:  band: B2 · assessmentState: SUFFICIENTLY_ASSESSED · coverage: … · diversity: …
  ```
  (Exact fields/schema deferred, §34.)
- **Partial domain evidence.** A domain may have enough evidence to estimate **some** skills but not enough to
  declare the **whole** domain expectation demonstrated. Then the projection is **`INSUFFICIENT_EVIDENCE` /
  partial**, not a fabricated complete band. Example:
  ```
  Listening:  main idea → SUFFICIENTLY_ASSESSED · specific detail → INSUFFICIENT_EVIDENCE · inference → NOT_ASSESSED
              ⇒ domain projection = PARTIAL / INSUFFICIENT, not a complete "Listening B2"
  ```
  The exact policy (which skills/evidence a domain band requires) is **Methodist-owned and versioned**; numeric
  thresholds remain open (§34).
- Exact numeric formula deferred (§34). Recommended direction: the aggregate (band **plus** its
  coverage/sufficiency metadata) is recomputable from measurements + policy version, so it can never drift from
  the skills it summarizes.

## 20. Level expectation derivation

Given, e.g.: *Present Simple → A2 demonstrated · Conditionals → B1 weak · Passive Voice → B2 strong*, do **not**
blindly average raw percentages into "Grammar = B2". A conceptual **skill-level derivation** considers: required
expectations · critical skills · evidence **sufficiency** · evidence **type** · **independence** · **coverage**
· unresolved gaps.
- A level band is a claim about *what expectations are met with what evidence*, not a mean of scores.
- Exact algorithm open (§34); the **principle** is: derivation is evidence-and-expectation-aware, not a naive
  average.

## 21. Overall study-level boundary

The Skills Engine provides domain/skill evidence and projections; it must **not** claim an "official CEFR B2
certificate." **Placement** uses these projections to recommend a **study level** (e.g. "Recommended study
level: B2") while **showing domain differences**. Do not collapse `Grammar B2 / Listening B1 / Writing
NOT_ASSESSED` into a deceptive universal "B2" (`PLACEMENT_ENGINE_V2.md` §4).

## 22. Content / activity mapping

Teaching content maps to skills **intentionally** (reuse `LessonSkill`/`ActivitySkill`, extended):
- **Primary skill** (what the activity chiefly develops/measures) + **supporting skills** where defensible.
- **Evidence-producing vs exposure-only:** not every activity that *mentions* a skill produces mastery
  evidence. An explanation card exposing Present Simple is **exposure**, not evidence the learner demonstrated
  it (§13).
- **Anti-pattern to avoid:** "map every activity to every skill in the lesson." Mapping must be defensible.
- **Current gap:** `LessonSkill`/`ActivitySkill` are bare join tables — no primary/supporting distinction and no
  evidence-vs-exposure flag. EXTEND.

## 23. Misconception mapping

Link the **Methodist-owned mistake taxonomy** to skills. Example: skill *3rd-person singular -s* ↔ approved
misconception `OMITS_3SG_S`. Teaching detects it; Review may target it; Roadmap repair may prioritize it.
- **One wrong answer is not a stable misconception** — declaring one needs an **evidence threshold + provenance**
  (repeated same-type error), not a single datum (§ recognition-vs-production analogue; final formula deferred).
- `LearnerSignal.categoryCode` already references a taxonomy registry — reuse as the misconception-signal
  substrate; the skill↔misconception mapping is NEW.

## 24. Skill prerequisites

Roadmap owns **point-level** prerequisites. Skills may *also* have pedagogical **dependency** relationships
(e.g. *subject pronouns → to-be agreement → more complex sentence patterns*) useful as a **diagnostic/repair
signal**.
- **Do not** automatically duplicate every roadmap prerequisite as a skill edge; skill prerequisites exist only
  where they add diagnostic value.
- Whether/how to model skill prerequisites is **open** (§34); the concept is defined, the schema deferred.

## 25. Versioning / evolution

Skills and expectations improve over time; historical meaning must stay stable:
- **Stable skill identity** (the `code`/key never silently changes meaning).
- **Versioned expectation/policy** — when a Methodist changes "the B1 expectation for skill X", it is a **new
  version**; old evidence keeps its interpretation.
- **Measurements reference the expectation/policy + derivation version** they were produced under (today
  `derivationVersion` exists — extend with expectation/policy version).
- **No silent reinterpretation** of old evidence (Scenario G). Reuse the append-only + versioned-derivation
  discipline already in `SkillMeasurement`.

## 26. Placement Engine contract

Placement asks Skills Engine for: subject **domains**, diagnostic **skill coverage**, **level expectations**,
**evidence aggregation**, **domain projections**, and sufficient/insufficient evidence. Placement **owns**:
claimed level, threshold policy, level-up challenge, and the `PlacementDecision`. **Skills Engine must not
produce a competing placement decision** — it supplies the evidence/projections Placement decides from.

## 27. Roadmap Engine contract

Roadmap asks for: **weak/strong skills**, **validated expectations**, **prerequisite gaps**, **skill→point
mappings**, **repair targets**, **domain/level gap projections**. Roadmap **owns**: which point to learn next,
repair insertion, prerequisite blocking, roadmap projection/state (`ROADMAP_ENGINE_V2.md`).

## 28. Teaching Engine contract

Teaching asks for: **activity↔skill mappings**, **expected evidence types**, **level expectation**,
**misconception mappings**. Teaching **emits**: learner responses, **evidence kind**, scaffold/hints,
misconception observations, deterministic/rubric scores. **Teaching does not directly declare global skill
mastery** — it produces evidence the Skills/Mastery engines interpret (`TEACHING_ENGINE_V2.md` §21/§22).

## 29. Mastery / Review Engine handoff

Skills Engine defines: **what skill was demonstrated**, **evidence type**, **expectation context**,
**sufficiency** concepts. Mastery/Review later decides: current mastery projection, decay/recall state, review
scheduling, and whether more evidence is required. **Full review policy is not designed here** — the Skills
Engine hands over a rich, typed evidence model; the single-writer merge (`LearningProgressService`) remains the
producer of the compact `LearnerSkillState`.

## 30. Present Simple — level-expectation example

**Skill family:** Present Simple. **Possible granular skills:** recognize routine usage · form affirmative
correctly · apply 3rd-person singular *-s* · form negatives · form questions · understand routine statements in
reading/listening · produce routine statements.

Expectations across levels (product-model illustration, not an official CEFR standard):
- **A1:** introduced / basic **controlled** use (recognition + controlled production).
- **A2:** **expected** more **independently** across familiar contexts.
- **B1+:** **reinforced** — used *inside larger tasks*, not necessarily re-taught as a beginner grammar lesson.

The same foundational skill stays relevant at higher levels **without belonging to only A1** — this is exactly
what the Skill-Level Expectation model (§8) captures and a `Skill.levelId` could not (Scenario D).

## 31. Writing — "domain not one skill" example

"Writing" is a **domain**, not a single skill. Constituent skills grow in expectation (product-model
illustration, not an official CEFR standard):
- **A1:** construct a simple sentence · give basic personal information.
- **A2:** connect simple sentences · write a short message.
- **B1:** write a connected paragraph · narrate/explain.
- **B2:** structured opinion/argument · appropriate linking · clearer register control.
- **C1/C2:** nuance · register · cohesion · complex argument/style.
This is why a single "Writing" score is meaningless: it is a **domain projection** (§19) over distinct
productive skills with distinct level expectations and required evidence kinds (§12).

## 32. Scenarios

**A — Recognition without production.** Learner answers all Present Simple MC correctly but cannot independently
produce a sentence → **recognition evidence strong; productive evidence weak/absent**; the *productive*
expectation is **not** marked mastered (§12).

**B — Heavy hints.** Correct only after several hints → record useful evidence, but **independence is lower**;
**not equivalent** to an unaided answer; the expectation requiring independent production is not satisfied
(§14).

**C — Writing not assessed.** Grammar/Reading measured, Writing unavailable → `Writing = NOT_ASSESSED`, **not
0**, and **excluded** from domain/overall aggregation rather than counted as a failing 0 (§18).

**D — Skill across levels.** Present Simple introduced A1, still expected/reinforced A2/B1 → **same stable skill
identity**, **different level expectations** (§8/§30).

**E — Lower prerequisite gap.** A B2 learner struggles because a B1 prerequisite skill is weak → Skills Engine
**surfaces the prerequisite evidence gap**; **Roadmap decides** the repair (§24/§27).

**F — AI unavailable.** Objective evidence still works; AI-dependent productive evaluation unavailable →
productive evidence `NOT_ASSESSED`/unavailable, **no fake score** (§17/§18).

**G — Expectation evolves.** Methodist publishes a new expectation version → **new evidence uses the new
policy**; **historical evidence remains interpretable** under its pinned version (§25).

**H — Exposure only.** Learner watches/listens to an explanation → **exposure recorded** if useful, but **no
mastery evidence fabricated** (§13).

## 33. V1 reuse / gap analysis

**Why flat subject-scoped `Skill` without Domain/LevelExpectation is insufficient:** it cannot produce
**per-domain bands** (no domain), cannot express **introduced vs expected vs reinforced** (no level
association), cannot drive Roadmap **validation-skip** or **level exit**, and cannot answer "what does B2 mean
for this skill". **Why `scoreBp`/`confidenceBp`/`evidenceCount` alone are insufficient:** they cannot
distinguish **recognition vs production**, **independence/scaffold**, **exposure vs evidence**, evidence
**sufficiency vs coverage vs certainty**, or **NOT_ASSESSED vs 0**. **What must remain:** append-only
`SkillMeasurement` as evidence facts + recomputable `LearnerSkillState` (single-writer merge).

| Component | Verdict | Notes |
|---|---|---|
| `Skill` (flat, subject-scoped, `code?`) | **EXTEND** | add **domain** (primary), **skill↔level expectations**, **family**; promote `code` to first-class stable identity. |
| `LessonSkill` / `ActivitySkill` (bare joins) | **EXTEND** | add **primary vs supporting** + **evidence-producing vs exposure-only** (§22). |
| `SkillMeasurement` (append-only) | **EXTEND** | add **evidence kind**, independence/scaffold, expectation/policy version, task context; keep append-only, provenance, idempotency, `observedAt`, `derivationVersion`. |
| `LearnerSkillState` (compact projection) | **EXTEND** | keep compact + recomputable; add evidence-diversity / expectation / misconception dimensions; don't cram all history into the row. |
| `DiagnosticSkillProfileEngine` (`skill-profile-diagnostic-v1`) | **REUSE / EXTEND** | difficulty-aware kernel reused; make **evidence-kind aware** and expectation-aware. |
| `deriveLessonMastery` (mean best MASTERY_TEST, confidence=10000) | **EXTEND** | stop treating one MC as full confidence; weight by **evidence kind/independence** (§12/§14). |
| `deriveReviewMastery` (`review-mastery-v1`, confidence=10000) | **EXTEND** | same; review is `REVIEW_RECALL` evidence, not production. |
| `LearningProgressService` merge (single writer, anchors DIAGNOSTIC/CHECKPOINT) | **REUSE / EXTEND** | keep single-writer recompute; add **domain/level projections** as reads over per-skill state, not a new writer. |
| `displayLevel` (nullable cache, no FK, null in v1) | **EXTEND (clarify)** | gets meaning via level derivation (§20) but stays a **derived cache**, never a source of truth. |
| `confidenceBp` (coverage) | **EXTEND / CLARIFY** | split the four notions (§17); never used as certainty. |
| A1 pilot skill structure (13 flat subject-scoped skills) | **EXTEND** | tag with domains + level expectations (A1), backfill; behavior unchanged until then. |

## 34. Potential future persisted concepts

(Conceptual only; no names/schema finalized.) `SubjectDomain` · `Skill.domain` reference · `SkillFamily`/group ·
`SkillLevelExpectation` (versioned) · evidence-kind metadata on measurements · expectation/policy version ·
evidence-sufficiency projection · misconception↔skill mapping · (optional) skill-prerequisite edges.

## 35. Potential future schema / API changes (directional — not a migration)

Additive, nullable-first, A1-compatible:
- **Domain** entity (subject-scoped) + `Skill.primaryDomain`; optional supporting-domain via multiple skills.
- **Skill↔level expectation** association (introduced/expected/reinforced/assessed/exit) with required evidence
  kinds/independence/complexity, **versioned**.
- **Skill family** grouping.
- **Richer `SkillMeasurement`** metadata (evidence kind, independence, expectation/policy version, task context).
- **Skill state** projection fields (evidence diversity, expectation, misconception) — kept compact.
- **Misconception↔skill** mapping (reuse `LearnerSignal.categoryCode` taxonomy registry).
- **API (additive, read-mostly):** subject domains + skills + expectations; per-skill and per-domain evidence
  projections; sufficiency/coverage; misconception mappings — consumed by Placement/Roadmap/Teaching. V1 skill
  APIs keep working.

## 36. Acceptance criteria

1. English domains are **first-class**, but the engine stays **multi-subject** (no hardcoded English enum).
2. A `Skill` is **not owned by one CEFR level**; level relationships are **expectations** (§8; Scenario D).
3. **Level expectations can evolve** with versioning; historical evidence stays interpretable (§25; Scenario G).
4. **Recognition ≠ production** is enforceable via required evidence diversity (§12; Scenario A).
5. **Exposure ≠ evidence** — media consumption is never skill proof (§13; Scenario H).
6. **`NOT_ASSESSED` ≠ `INSUFFICIENT_EVIDENCE` ≠ `SUFFICIENTLY_ASSESSED`, and none of the first two is 0**
   (§18). Unassessed/insufficient evidence may be excluded from numeric math but stays **visible in
   coverage/sufficiency** and can **block a required-domain validation** decision; projections carry band **plus**
   coverage/sufficiency, never a naked score (§18/§19; Scenario C/F).
7. **Hints/scaffolding affect evidence semantics** — independence is preserved, not collapsed to a raw score
   (§14; Scenario B).
8. **`confidenceBp` is not misused as certainty**; the four notions are distinct (§17).
9. **Placement / Roadmap / Teaching contracts** are clearly separated; Skills Engine makes no competing
   decisions (§26-28).
10. **AI cannot invent** canonical skills, domains, expectations, or policies (§ authoring; §26-28).
11. **Historical evidence remains reproducible** — append-only measurements + recomputable state (§15/§16/§33).
12. **No fake numeric formulas** are invented — aggregation/derivation/mastery formulas remain owner/Methodist
    decisions (§34).

## 37. Open questions (deferred — direction given, no fake precision)

Exact domain/skill schema · exact `SkillLevelExpectation` schema · exact evidence-kind enum · exact domain
aggregation formula · exact level aggregation formula · exact evidence-sufficiency thresholds · exact mastery
formula · exact scaffold/hint weighting · exact skill-prerequisite model · exact skill-family model · exact CEFR
descriptors/content · exact writing/speaking rubric · exact AI/speech provider.

Architectural direction is given inline (Subject→Domain→Skill; skill↔level *expectation* not ownership; typed
evidence kinds + independence; coverage/sufficiency/certainty separation; projections-over-evidence for
domain/level; append-only + recomputable state; Methodist authority with AI-within-constraints; reuse of
`SkillMeasurement`/`LearnerSkillState`/merge/`LearnerSignal` taxonomy). Numeric and nomenclature choices remain
owner/Methodist decisions.
