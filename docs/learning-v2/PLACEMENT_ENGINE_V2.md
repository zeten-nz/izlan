# Placement Engine V2 — Specification

> **Status:** SPECIFICATION ONLY. No implementation, migration, endpoint, or test change is authorized by this
> document. V1 / CONTROLLED_RC (English A1, single diagnostic) keeps running unchanged.
>
> **Companion:** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md) (engine hierarchy, macro vs micro roadmap).
>
> **Grounding.** Current-state facts below are drawn from the real code and cite exact identifiers:
> `src/assessment/**` (engine `placement-adaptive-v1`, config schema `placement-adaptive/v1`),
> `src/skill-profile/**` (`DiagnosticSkillProfileEngine`, `skill-profile-diagnostic-v1`),
> `src/learning-progress/**` (merge, single writer of `LearnerSkillState`), `src/roadmap/**`,
> `prisma/schema/{content,learning,schema}.prisma`. Accepted product decisions are cited as D-xx from
> `docs/PRODUCT_DECISIONS.md`. **Proposed V2 field names are illustrative — the domain contract is fixed here,
> the exact names are not** (owner instruction).

---

## 0. One-paragraph summary

Today "placement" is an initial diagnostic that emits **evidence only** — per-skill mastery on a subject-neutral
difficulty scale — and decides nothing (no level, no starting point; `displayLevel` is `null`). V2 turns
placement into a **decision engine**: it takes the learner's entry context (new / claims a level / unsure),
runs the *right* CEFR-level diagnostic (or a short router), measures multiple subject-scoped **domains** (for
English: grammar, vocabulary, reading, listening, writing, speaking, pronunciation — some honestly-degraded to
"not assessed"), and produces a structured **PlacementDecision** that tells the Roadmap Engine *where to start,
what to validate/skip, what to repair, and whether to offer a level-up challenge* — all governed by
**configurable threshold policy**, never magic numbers.

**Placement produces a study-placement decision, not a certificate.** For English, the CEFR ladder A1→A2→B1→B2→
C1→C2 is a **first-class product spine** (owner decision, §0.1), not nullable display metadata. But the
"level" placement outputs is a **recommended starting level for study**, backed by per-domain evidence — it is
explicitly **not a formal CEFR certification**, and it never claims full command of a level whose required
domains were not all assessed (§4, §14).

---

## 0.1 Owner architecture decisions (this revision)

These are **resolved product/architecture positions** for V2 (they close the corresponding "unresolved"
items — see §26). Exact schema/enum/table names, numeric floors, and psychometric formulas remain deferred.

1. **English CEFR is first-class.** For English, `A1→A2→B1→B2→C1→C2` is the canonical learner-facing macro
   spine — real product structure, not nullable display metadata. `Track` still represents goals (General
   English / IELTS / Speaking Focus); for **General English the CEFR progression is the canonical spine**. V1's
   free-text `Level.code` (TD-27) is **compatibility history, not the desired V2 English semantics**.
2. **Skill ↔ Level is an association, not `Skill.levelId`.** A skill is *introduced* at one level yet
   *expected / reinforced / assessed* at later levels (Present Simple: introduced at A1, still English at B2).
   V2 prefers a **skill-to-level expectation/association** expressing concepts like *introduced / expected /
   reinforced-reviewed / validation-expectations* — **not** a single owning level. Exact schema deferred.
3. **Domain is first-class and subject-scoped.** Placement and Skill Profile support subject-specific
   **domains** — for English: Grammar, Vocabulary, Reading, Listening, Writing, Speaking, Pronunciation — via a
   **subject-scoped** domain concept (never an architecture-wide English-only enum). **A skill has a primary
   diagnostic domain**; genuinely cross-domain work is modeled as **multiple skills**, not one score
   pretending to belong to every domain.
4. **Overall level is a study-placement decision, not certification.** Distinguish *recommended study/starting
   level* from *demonstrated per-domain/skill evidence* from *formal CEFR certification*. Izlan placement is
   **not** a CEFR certificate; it never claims full command of a level whose required domains were unassessed;
   `NOT_ASSESSED` is never coerced to 0.
5. **Validation needs more than an overall % — and `confidenceBp` is not certainty.** Keep the 95/80/50 bands,
   but a *validation* decision must consider overall score **and** required-domain floors, evidence
   sufficiency, assessment coverage, and prerequisite-critical gaps (the policy object can require **minimum
   domain performance**). Technical correction: V1 `confidenceBp` is evidence **coverage**, not statistical
   certainty; V2 must not read `confidenceBp = 10000` as "100% certain the learner knows this." V2 keeps
   *coverage confidence* vs *evidence sufficiency* vs *placement-decision certainty* separate (§16); the final
   psychometric formula is deferred.
6. **`VALIDATED_BY_ASSESSMENT` ≠ `COMPLETED_BY_LEARNING`.** Testing out of a roadmap point must **not** forge
   lesson-completion history, XP, IZL, or time-spent — but Roadmap V2 **may** treat validated prerequisites as
   satisfied (§15a).
7. **Mistake taxonomy is Methodist / verified-content owned.** AI may *classify* learner errors into the
   approved taxonomy and personalize explanations, but must **not** silently invent new canonical categories
   (§12).
8. **Design for A1–C2 now; roll out level-by-level.** Missing A2–C2 content must not weaken the architecture.
   If a claimed level's diagnostic/content is unpublished, the product says so **honestly** — it never
   substitutes A1 or fabricates a result (§8, §18.3).

> In-text `#N` references below point to these eight owner decisions.

## 1. Goals

1. Decide **where the learner starts learning**, expressed richly enough for Roadmap Engine V2 to act (skip,
   repair, sequence) — not merely attach a CEFR badge.
2. Support three **entry intents**: completely new, claims-a-level, and unsure — each with a different, minimal
   diagnostic burden (a new learner is never forced to sit an exam; an unsure learner never sits a full A1→C2
   exam).
3. Diagnose at **four resolutions** — CEFR level, competency **domain**, topic, and **skill** — with per-item
   **evidence**, so the result explains *what* is weak, not just a percent.
4. Turn score bands into **policy-driven decisions** (validate / continue-with-repair / rebuild / prerequisite
   fallback), thresholds living in configuration.
5. Support **opportunity, not forced advancement**: exceptional performance *offers* a next-level challenge;
   the learner chooses.
6. **Never fake** an unmeasured dimension. "Not assessed" is a distinct value from 0%.
7. Preserve and **extend** the existing evidence substrate (`SkillMeasurement` → `LearnerSkillState`) rather
   than replacing it; placement remains a producer of evidence plus a new *decision projection* over it.
8. Remain **reproducible and deterministic** for objective scoring (the current engine is pure — no RNG, no
   wall-clock); AI/rubric scoring is isolated and optional.

## 2. Non-goals

1. **Not** building A2–C2 content, skills, or diagnostic items — that is Methodist authoring work. This spec
   assumes level-tagged content will exist; it defines how placement behaves when it does and how it degrades
   when it does not.
2. **Not** specifying the Roadmap, Teaching, or Review engines (companion doc, contract altitude only). This
   spec defines only the **output contract** placement hands to Roadmap.
3. **Not** implementing writing/speaking AI evaluation. V2 defines the *slots* and honest-degradation rules;
   the AI pipeline (provider, STT) is an open technology choice (`OPEN_QUESTIONS.md` §1.4/1.6).
4. **Not** changing V1 objective scoring semantics (deterministic bp, no partial credit) or the merge.
5. **Not** a psychometrically calibrated IRT test in v1. V2 improves stopping/confidence but does not promise
   item calibration; that is called out as debt.
6. **No** silent level jumps, and **no** "failed" outcome.

## 3. Learner entry flows

Placement begins from onboarding **context intake** (already an accepted step, D-10; today only
`learningIntentId` is captured). V2 adds a **self-assessment prior**:

| Entry intent | Learner says | Placement behavior |
|---|---|---|
| **NEW** | "I am completely new" | No diagnostic exam. Start at the beginning of A1. Generate the full macro roadmap A1→C2. (§7) |
| **CLAIMS_LEVEL** | "I have studied before" → picks A1/A2/B1/B2/C1/C2 | Run the diagnostic **for that claimed level** only. (§5) |
| **UNSURE** | "I'm not sure about my level" | Run a short **router/screener** that identifies which single CEFR diagnostic to attempt, then run it. (§6) |

The self-assessment is a **prior, not a verdict** (D-10/D-11): the claimed level seeds *which* diagnostic runs;
the *demonstrated* level comes from the worked result.

## 4. State machine / flow

```
                     ┌── NEW ─────────────────▶ [SEED_A1_START] ──▶ decision(decisionType = FRESH_START)
                     │
 [ENTRY_INTAKE] ─────┼── CLAIMS_LEVEL(L) ─────▶ [RUN_DIAGNOSTIC(L)] ──┐
                     │                                                 │
                     └── UNSURE ──▶ [ROUTER] ──▶ pickLevel(L) ────────▶┤
                                                                       ▼
                                                          [SCORE + DERIVE EVIDENCE]   (per skill → per domain → per level)
                                                                       │
                                                                       ▼
                                                          [APPLY THRESHOLD POLICY]    (§10, band → decisionType)
                                                                       │
                          ┌───────────── band ≥ challenge (e.g. 95%) ──┤
                          ▼                                            │
             [OFFER_LEVEL_UP(L+1)] ── learner declines ──────────────▶ │
                          │ learner accepts                            │
                          ▼                                            │
             [RUN_DIAGNOSTIC(L+1)] ──▶ (re-enter SCORE…, evidence preserved from BOTH)
                          │                                            │
                          └───────────────────────────────────────────┤
                                                                       ▼
                                                          [BUILD PlacementDecision]  (§15)
                                                                       │
                                                                       ▼
                                                          [PERSIST + HAND TO ROADMAP]
```

- The **per-attempt** engine flow (start → present item → submit → advance → complete) is **reused verbatim**
  from V1 (`AssessmentService.start`, `PlacementFlowService.submitResponse`, engine `pickItem`/`applyResult`/
  `isComplete`; DB is the sole authority, reload never advances). V2 wraps *one or more* such attempts (one per
  level diagnostic) inside the higher-level placement state machine above.
- **Resume:** each level diagnostic reuses the existing single-in-progress-attempt-per-(user,subject) resume
  rule. The V2 wrapper adds resume of the *outer* state (which level(s) done, challenge offered/pending).

## 5. Claimed-level diagnostic behavior

- Learner picks level **L**. Placement selects the **level-L diagnostic** (a diagnostic definition/version
  scoped to L — see §23 for how "scoped to L" is modeled) and runs it with the reused adaptive engine.
- The engine still walks per-skill difficulty; V2's change is **which pool** it draws from (level-L, multi-
  domain) and that results roll up to a **demonstrated band for L** plus per-domain and per-skill breakdowns.
- Output feeds §10 threshold policy against **L**. Example: claims B2, scores 86% grammar / 82% vocab / 91%
  reading / 72% listening → overall band in the 80–94 window → *continue at B2 with targeted repair on
  listening + the weak topics* (not restart B2).

## 6. Unsure-level routing behavior

Goal: find the right single diagnostic **without** a full A1→C2 exam.

- **Router = a short, wide-span screener** (a handful of items spanning levels, e.g. one or two anchor items
  per level from A1..C2, breadth over depth). It is itself an adaptive attempt but with a **level-spanning
  pool** and an early **stopping rule tuned for routing** (stop as soon as the plausible level band narrows),
  not for full coverage.
- Router output = a **candidate level L̂** (the boundary where the learner starts failing), not a final result.
- Placement then runs the **full level-L̂ diagnostic** (§5). The router's items may be **preserved as evidence**
  (they are real answered items) but the *decision* rests on the full diagnostic.
- Degradation: if content for higher levels is absent, the router can only route within available levels
  (today: A1 only → router trivially routes to A1).

## 7. New-learner behavior

- No diagnostic. `decisionType = FRESH_START`. `demonstratedLevel = null` (unmeasured, **not** "A1 = 0%").
- `recommendedStart` = the first macro point of A1. The Roadmap Engine generates the full **macro** ladder
  A1→C2 (companion doc §3.1) and the learner begins at the top of A1.
- No evidence rows are written (nothing was measured) — consistent with principle "absence of evidence ≠
  failure". A new learner's `LearnerSkillState` simply doesn't exist yet and is populated by lessons.

## 8. Scoring model

Two layers, both **reused/extended**, not replaced:

1. **Objective item scoring (REUSE).** `ObjectiveScorerService` → deterministic basis points (`10000` correct /
   `0` incorrect), no partial credit, exact-set match for `multiple_choice`. Client sends only the answer; the
   server is the sole scoring authority. Formats: `single_choice`, `multiple_choice`, `true_false`.
2. **Skill estimate (REUSE/EXTEND).** `DiagnosticSkillProfileEngine` already derives a **difficulty-aware**
   per-skill estimate (`e = d` if correct, `e = d−1` if wrong, clamped to `profileScale`, mean → normalized
   `masteryScoreBp`). V2 keeps this and **adds two roll-ups computed over the per-skill estimates**:
   - **per-domain band** — weighted aggregate of the skills whose **primary domain** is that (subject-scoped)
     domain (decision #3); a skill contributes to one domain, so no score is double-counted across domains;
   - **per-level band** — weighted aggregate across the skills **expected at** that level (via the skill↔level
     association, decision #2 — not a single owning level) → the `demonstratedLevel` the threshold policy
     consumes, which is a *study-placement* level, not a certification (decision #4).
   Aggregation weight = the existing `effectiveWeight = evidenceCount × confidenceBp` used by the merge, so a
   domain/level band cannot be swung by a single low-confidence skill.

All scores stay integer **bp (0..10000)**; "not assessed" is represented as **absence** (null), never 0.

## 9. Evidence model

- **Substrate (REUSE).** Every answered objective item already produces an append-only `SkillMeasurement`
  (`source = DIAGNOSTIC`, `derivationVersion = skill-profile-diagnostic-v1`, carrying `scoreBp`, `confidenceBp`
  = coverage, `evidenceCount`, `attemptId` provenance, `observedAt`). The merge (`LearningProgressService`,
  the single writer) folds DIAGNOSTIC anchors into `LearnerSkillState`. **V2 changes nothing here.**
- **Multi-attempt evidence (REUSE — already works).** Because `SkillMeasurement` is append-only and keyed by
  `attemptId`, a B2 attempt *and* a C1 challenge attempt both persist their own rows; nothing is overwritten.
  This is exactly what §11's "preserve evidence from both diagnostics" needs — no new mechanism required.
- **New: domain/level evidence roll-up (EXTEND, read-side).** The per-domain and per-level bands (§8) are a
  **derived projection**, computed at decision time from the per-skill evidence. Whether they are also
  *persisted* (as a `PlacementDecision` cache) is §20; they are **not** a new authoritative store that could
  drift from `LearnerSkillState`.
- **Evidence carries provenance, always.** A decision must be explainable: every band traces to the skills,
  items, and attempt(s) that produced it. `insufficientSkillIds` (coverage shortfall) already exists and
  becomes a first-class "low evidence → lower confidence, not lower score" input.

## 10. Threshold policy

Thresholds are **configuration**, versioned like the engine config — **never inline constants**. Proposed
shape (names illustrative):

```
placementThresholdPolicy/v1 (per subject, Methodist-owned, versioned):
  # overall band edges (bp)
  validateLevel:      9500   # ≥95% overall → CANDIDATE for validation (necessary, NOT sufficient — see below)
  continueLevel:      8000   # ≥80% overall → continue at level, targeted repair
  rebuildLevel:       5000   # ≥50% overall → level unstable, rebuild weak parts, prereq checks
  # below rebuildLevel → prerequisite fallback (§13)
  # multi-factor validation gates (a level is validated ONLY if ALL hold):
  requiredDomainFloorBp:   <cfg>   # every REQUIRED domain for the level must clear this floor
  requiredDomains:         [<domain>, …]   # which subject-scoped domains are required for THIS level
  minEvidenceSufficiency:  <cfg>   # enough answered items across required domains (not thin/lucky)
  minAssessmentCoverage:   <cfg>   # required domains actually measured, not "not assessed"
  # numeric values above are deferred (owner: floors/sufficiency numbers are still open, §26)
```

**Overall score alone can never validate a level** (owner decision #5). Passing `validateLevel` makes a level a
*candidate*; validation additionally requires **all** of: every **required domain** ≥ `requiredDomainFloorBp`,
sufficient **evidence** across those domains (each required domain `SUFFICIENTLY_ASSESSED`, not `NOT_ASSESSED`
or `INSUFFICIENT_EVIDENCE` — the three states of Skills §18; audit m1), adequate **assessment coverage**, and no
**prerequisite-critical gap**. Worked counter-example: overall 96% but
Listening 42% → **not** `LEVEL_VALIDATED` and **no** C1 offer; instead `CONTINUE_WITH_REPAIR` targeting
listening + any prerequisite gap (Scenario C, §18a).

Applied to the **demonstrated level band** (and per-domain for repair targeting):

| Band | `decisionType` | Behavior (all thresholds configurable) |
|---|---|---|
| **95–100%** | `LEVEL_VALIDATED` | Mark the level's competencies **validated**; offer the **next-level** diagnostic (§11). Roadmap may skip validated areas. |
| **80–94%** | `CONTINUE_WITH_REPAIR` | Continue **at** the claimed level; **do not** restart it. Identify weak topics/skills; emit a **targeted repair** path. |
| **50–79%** | `REBUILD_LEVEL` | Level not stable. Identify all important gaps; rebuild the weak parts of **the same** level; prerequisite checks may be required. |
| **< 50%** | `PREREQUISITE_FALLBACK` | Substantial review; evaluate whether **previous-level** material enters the roadmap (§13). **Never** labeled "failed". |

Guards: (a) `LEVEL_VALIDATED` requires the full multi-factor gate above, not just the overall band; (b) policy
is applied at the aggregate, but **repair targeting reads the per-domain/per-skill bands** so "continue with
repair" knows *what* to repair; (c) required-domain floors and evidence sufficiency are evaluated against the
**subject-scoped domains** and **skill↔level associations**, so "required for B2" is data, not code.

**Confidence is not certainty (technical correction, owner decision #5).** V1 `LearnerSkillState.confidenceBp`
(and the `confidenceBp = 10000` that `LESSON_MASTERY`/`REVIEW_MASTERY` hard-code) is **evidence coverage**, not
psychometric certainty. The threshold policy must **not** treat `confidenceBp = 10000` as "we are 100% certain
the learner knows this skill." V2 keeps three distinct notions separate (detailed in §16):

- **coverage confidence** — the existing V1 `confidenceBp` (how much evidence we have relative to the target
  count);
- **evidence sufficiency** — whether there is *enough* evidence across the required domains to decide at all;
- **placement-decision certainty** — how confident the *decision* is (a future, possibly psychometric,
  measure — **formula deferred**, owner #5/§26).

`minEvidenceSufficiency`/`minAssessmentCoverage` are about coverage and *are* satisfiable today; a true
decision-certainty measure is deferred and must not be faked from coverage confidence.

## 11. Level-up challenge

- Trigger: level L is **fully `LEVEL_VALIDATED`** (the whole multi-factor gate of §10 — overall ≥ `validateLevel`
  **and** every required domain clears its floor with sufficient evidence/coverage) **and** a level-(L+1)
  diagnostic exists. A high overall score with a failing required domain (e.g. overall 96 / Listening 42) does
  **not** trigger it (Scenario C).
- Behavior: **offer**, don't jump — `nextLevelChallengeEligible = true`; UX shows *"You've demonstrated strong
  B2. Try the C1 diagnostic?"* Learner may **accept** (run L+1 diagnostic) or **decline** (continue at advanced
  L).
- **The B2=97% / C1=61% case** (owner's worked example):
  - Validate strong B2 (evidence from the B2 attempt stands).
  - C1 band 61% → `REBUILD_LEVEL` **for C1** → learner is **not** C1-ready.
  - `recommendedStart` = the **B2→C1 transition** (advanced B2 / C1 on-ramp), not the top of C1.
  - **Both** diagnostics' evidence is preserved (append-only, keyed per attempt) and both inform the decision.
- Chaining: a learner who also aces C1 can be offered C2, etc. Each hop is a separate attempt; the engine never
  advances more than one level per explicit acceptance.

## 12. Gap detection

- Placement must detect **what** the learner gets wrong, at **domain / topic / skill** resolution, e.g.
  *B2 overall 78% → weak: conditionals, reported speech, listening inference; strong: passive voice, relative
  clauses, reading main idea.*
- Mechanism: the per-skill evidence already exists; V2 needs the **domain/topic tags** (§22/§23) so weak skills
  aggregate into named weak **areas**. A "weak area" = skills whose band < `continueLevel` with adequate
  confidence.
- Output: `weakAreas[]` (domain/topic/skill) and `validatedAreas[]` feed the roadmap so it can **insert
  targeted repair** rather than restart every lesson of the level.
- **Mistake taxonomy — Methodist / verified-content owned (owner decision #7).** The canonical set of error
  categories is authored and owned by Methodists (verified content), consistent with "verified content is the
  authority" (D-05). **AI may classify** a learner's error into an *approved* category and produce a
  personalized explanation, but **must not silently invent new canonical categories**. This is what powers the
  future Teaching Engine loop: *wrong answer → determine likely misunderstanding → explain WHY → give a simpler
  rule/example → immediately re-check in a different example.* What remains open is only the **initial taxonomy
  contents** (a content-authoring task), not its *ownership*. V2 gap detection ships at skill/topic granularity
  first; error-type granularity layers on once the taxonomy is authored.

## 13. Prerequisite fallback

- When a level band is `< rebuildLevel` (or a claimed level far exceeds demonstrated), placement must decide
  whether **previous-level** material enters the roadmap — *without* labeling the learner "failed".
- Needs a notion of **level ordering + cross-level prerequisites**. Today `LessonPrerequisite` is a per-lesson
  DAG with **no cross-level edges**; the content `Level` chain gives an ordering but skills aren't level-tagged.
- V2 rule (proposed): if demonstrated band ≪ claimed level, set `recommendedStart` to the highest **prior**
  level whose prerequisite competencies are themselves not demonstrated, and populate `prerequisiteGaps[]` with
  the specific prior-level areas to backfill. The roadmap then front-loads those.
- Degradation: with only A1 content, there is no "previous level" below A1 — fallback bottoms out at "start at
  A1 beginning" (equivalent to FRESH_START), which is correct.

## 14. Result UX

The result screen must present **evidence, not a bare percent**, and it must frame the outcome as a **study
placement, not a certificate** (owner decision #4). It separates three things the learner must not conflate:
*recommended starting level* (a study decision), *demonstrated evidence per domain/skill*, and *formal CEFR
certification* (which Izlan does **not** issue).

```
Recommended starting level: B2          ← a STUDY placement, not a CEFR certificate

Demonstrated evidence:
  Grammar       B2   strong evidence   ▮▮▮▮▮▮▮▮▮▯
  Vocabulary    B2                     ▮▮▮▮▮▮▮▮▯▯
  Reading       B2                     ▮▮▮▮▮▮▮▮▮▯
  Listening     B1   gap               ▮▮▮▮▮▮▮▯▯▯   ← repair
  Writing       not assessed
  Speaking      not assessed

  Decision: study at B2; repair Listening + [conditionals, reported speech].
  Note: this is a placement for study, not a certification of full B2.
  [Optional] You're eligible — try a quick C1 check?   (only when fully validated + C1 exists)
```

Rules: **"not assessed" is rendered distinctly** and never as a 0% bar (owner: do not convert `NOT_ASSESSED`
into zero); the screen **must not claim full/formal command of a level** when required domains were unassessed
(e.g. writing/speaking above); weak areas are **named**; the decision and its *reason* are shown (principle:
explain the why); the level-up offer appears only when the full validation gate is met (§11). Answer keys never
reach this surface (reuse the existing learner-safe projection that strips `answerKey`/`skillId`/`difficulty`).

## 15. Roadmap output contract — `PlacementDecision`

The core deliverable. A structured, **versioned** value handed to Roadmap Engine V2. Domain concepts are fixed;
exact field names are **not** locked (owner instruction):

| Concept | Meaning | Backed by (today) |
|---|---|---|
| `claimedLevel` | Learner's self-reported level (or NEW/UNSURE) | new — self-assessment intake (§3) |
| `demonstratedLevel` | Level the evidence supports; **null** if unmeasured | new projection over per-skill evidence |
| `decisionType` | `FRESH_START` / `LEVEL_VALIDATED` / `CONTINUE_WITH_REPAIR` / `REBUILD_LEVEL` / `PREREQUISITE_FALLBACK` / `INCOMPLETE` / `LEVEL_UNAVAILABLE` | new (from §10/§18.3) |
| `validatedAreas[]` | Domains/topics/skills demonstrated strongly enough to **skip** | new (needs domain/level tags) |
| `weakAreas[]` | Domains/topics/skills needing repair | per-skill bands + tags (§12) |
| `prerequisiteGaps[]` | Prior-level areas to backfill | new (needs level ordering, §13) |
| `recommendedStart` | The macro point (level/module/topic) to begin | new (the missing seam today) |
| `recommendedRepairs[]` | Targeted repair units for weak areas | new |
| `nextLevelChallengeEligible` | Whether to offer L+1 | new (from §11) |
| `domainScores[]` | Per-domain bands (+ "not assessed") | new roll-up over `SkillMeasurement` |
| `skillEvidence[]` | Per-skill `masteryScoreBp`/`confidenceBp`/`evidenceCount` + provenance attempt(s) | **REUSE** `SkillMeasurement` / `LearnerSkillState` |

Contract obligations: it must be **explainable** (every area traces to evidence), **partial-tolerant**
(dimensions may be "not assessed"), and **additive** to what roadmap consumes today (which is a per-skill
diagnostic snapshot) so the roadmap can migrate incrementally (§24).

**Source-of-truth (audit M1/M5).** The `PlacementDecision` is the **authoritative, immutable, versioned
decision** of the Placement Engine — *what Placement decided at time T*, including the **recommended study
level** (`recommendedStart`/`recommendedStudyLevel`), `validatedAreas`, weak/prerequisite areas, and its
policy+provenance. It is a **`…Decision`**, not a mutable state (naming convention, `LEARNING_SYSTEM_V2.md`
§7.4). Downstream:
- **Roadmap must NOT independently recompute the diagnostic validation.** It **consumes** `validatedAreas` and
  may create a durable **Roadmap Point validation/acquisition *event*** (Roadmap §10/§12) meaning *"this point
  was accepted into the learner's roadmap history as validated at T"* — carrying **provenance** back to this
  `PlacementDecision`/evidence/policy. That event is **not** a competing statement about what Placement decided
  (audit M1).
- The **recommended study level here is a decision**, distinct from the learner's **current competence
  projection** (Skills/Mastery, recomputable) and the **roadmap curricular position** (Roadmap) — never
  conflate them under a bare "current level" (audit M5; `LEARNING_SYSTEM_V2.md` §7.1). `displayLevel` is only a
  UX cache, never authoritative.
- Reassessment, competence regression, and evidence-admissibility changes **do not rewrite** this historical
  decision; a **new** `PlacementDecision` may supersede it (§ reassessment) and the current roadmap projection
  may regenerate — history survives.

## 15a. Validated-by-assessment ≠ completed-by-learning

A hard semantic distinction the contract must carry (owner decision #6):

- **`COMPLETED_BY_LEARNING`** — the learner actually worked through a roadmap point's activities. Today's
  `LearnerLessonCompletion` (+ its XP/IZL/time-spent side effects) means *this*.
- **`VALIDATED_BY_ASSESSMENT`** — placement evidence shows the learner already has the competency, so the
  roadmap point may be **satisfied without study**.

When placement validates an area, the system **must not fabricate learning history**. Validation must **not**:
award lesson-completion XP, award lesson-completion IZL, count as lesson time-spent, pretend activities were
executed, or rewrite/insert `LearnerLessonCompletion` rows. (This also protects the reward-integrity rules —
IZL is earned only through real learning, D-25 — and the anti-farming sequencing, D-27.)

At the same time, **Roadmap V2 must be able to treat validated prerequisites as satisfied** — i.e. skip or
mark-satisfied a roadmap point on the strength of a `VALIDATED_BY_ASSESSMENT` marker, *without* a
`LearnerLessonCompletion`. Concretely, the `PlacementDecision.validatedAreas[]` are consumed by the roadmap as
a **distinct "satisfied-by-validation" state**, separate from "completed". (Exact enum/table names deferred.)

This distinction lives in **both** contracts: the Placement→Roadmap hand-off here, and the architecture in
[`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md) (Roadmap/Mastery engines + principles). It is exactly what
Scenario E (§18a) exercises: demonstrated areas are marked validated, no fake completion is written, and the
weak area (Conditionals) still enters the required learning path.

## 16. Interaction with mastery / confidence / evidence

This is deliberately **conservative** — placement extends the model, it does not fork it:

- **Per-skill mastery stays authoritative in `LearnerSkillState`.** Placement continues to write DIAGNOSTIC
  `SkillMeasurement` rows and let the single-writer merge produce `masteryScoreBp` / `confidenceBp` /
  `evidenceCount`. The `PlacementDecision` is a **read-side projection** over that state + thresholds + tags; it
  is never a competing source of per-skill truth.
- **`confidenceBp` is coverage, not certainty** (current semantics; owner decision #5). V2 keeps three notions
  strictly separate and must never collapse them:
  - **coverage confidence** = V1 `confidenceBp` (evidence relative to the target item count; `LESSON_MASTERY`/
    `REVIEW_MASTERY` even hard-code it to `10000`). It measures *how much* evidence, not *how sure*.
  - **evidence sufficiency** = is there *enough* evidence across the required domains to decide at all
    (feeds `minEvidenceSufficiency`/`minAssessmentCoverage`, §10). Satisfiable today from coverage data.
  - **placement-decision certainty** = how confident the *decision* is — a future, possibly psychometric,
    measure. **Formula deferred** (owner #5/§26); it must **not** be faked from coverage confidence.
  Thin evidence lowers a band's *weight* and can block validation, but never deflates the score itself —
  matching "absence of evidence ≠ failure".
- **`displayLevel` finally gets meaning.** Today it is `null` with no FK. V2's `demonstratedLevel`/per-domain
  band is the natural producer of a display level — but it should be derived through the **decision/roll-up**,
  and if cached on `LearnerSkillState.displayLevel` it must remain a *derived cache* (its schema comment already
  says "no FK to content Level"), not a new source of truth.
- **Reassessment reuses the same substrate.** `AssessmentAttemptPurpose.REASSESSMENT` already exists; a later
  re-placement writes new DIAGNOSTIC/REASSESSMENT evidence that merges normally. Placement V2 does not need a
  new evidence path for re-leveling.
- **Anti-drift rule:** the merge stays the only writer of `LearnerSkillState`; the `PlacementDecision`
  projection is recomputable from evidence at any time (like the merge itself, which rebuilds from scratch).

## 17. Writing / listening / reading / speaking assessment limitations

Honest capability matrix — **V2 must not claim to measure what it doesn't**:

| Domain | v2 status | How | Constraint |
|---|---|---|---|
| **Grammar** | ✅ auto-scored now | objective items (reuse) | none |
| **Vocabulary** | ✅ auto-scored now | objective items | none |
| **Reading** | ✅ auto-scored now | objective comprehension items | none |
| **Listening** | ⚠️ auto-scorable, **blocked by media** | objective items over an audio prompt | **production media adapter is fail-closed** — audio uploads/serving return 503/404 in prod today; until an object-store adapter exists, listening items can't be delivered remotely. Until then → **"not assessed"**, never 0. |
| **Writing** | ⛔ rubric/AI later | AI evaluation with structured output (D-12/D-21) | AI provider unchosen; **do not fake**. Slot exists; value = "not assessed" until built. |
| **Speaking** | ⛔ rubric/AI + STT later | speech capture + STT + AI eval | speech pipeline is an open tech choice (`OPEN_QUESTIONS.md` §1.6); **do not fake**. |
| **Pronunciation** | ⛔ rubric/AI + STT later | pronunciation scoring over captured speech | same STT/AI dependency as Speaking; **do not fake**. Distinct English domain (decision #3), separate from Speaking. |

These seven are English's initial **subject-scoped** domains (decision #3); another Subject defines its own
domain set — there is no architecture-wide, English-only domain enum. Rule: a `PlacementDecision`'s
`domainScores` carries an explicit **assessment state** per domain — `NOT_ASSESSED` (no meaningful evidence) or
`INSUFFICIENT_EVIDENCE` (some, but not enough for a reliable decision), distinct from `SUFFICIENTLY_ASSESSED`
(the three states owned by Skills §18; audit m1). Roadmap and UX must treat `NOT_ASSESSED`/`INSUFFICIENT_EVIDENCE`
as *unknown/undecidable* (schedule for teaching/later assessment), **never** as a failing 0, and required
domains in either state can block a level-validation decision (§10).

## 18. Edge cases

1. **Claims C2, scores 20%** → `PREREQUISITE_FALLBACK`; recommend a much earlier start; never "failed".
2. **Claims A1, scores 99%** → offer A2 challenge (level-up from the bottom works the same way).
3. **Claimed level has no published diagnostic/content** (today: anything above A1) → the product **honestly
   states the level is not currently available** (owner decision #8). It must **not** silently substitute A1 and
   must **not** fabricate a result for the unavailable level. The learner is told the level isn't published yet
   and offered explicit choices (e.g. be notified when it opens, or begin at the highest published level) — the
   decision records `LEVEL_UNAVAILABLE` with a reason. The *architecture* is designed for A1–C2 now;
   *availability* rolls out level-by-level. **Availability authority (audit M4):** this `LEVEL_UNAVAILABLE` is
   about **placement/diagnostic** availability (whether a published diagnostic definition + coverage + policy
   exist for the level) — a **different** projection from **teaching-content** availability (Roadmap
   `CONTENT_UNAVAILABLE`, derived from Content Quality publication state). Both derive from published-content
   state (the source of truth, `LEARNING_SYSTEM_V2.md` §7.1); they are not conflated merely because both may
   display "unavailable".
4. **Router can't disambiguate** (answers inconsistent across levels) → pick the **lower** plausible level
   (safe: under-place rather than over-place) and let level-up recover it.
5. **Listening unavailable mid-diagnostic** (media 503) → that domain = "not assessed"; the rest of the
   diagnostic still scores.
6. **Learner abandons mid-diagnostic** → `decisionType = INCOMPLETE`, partial evidence retained; on resume, the
   existing single-in-progress-attempt rule continues the same attempt.
7. **Level-up accepted but L+1 content absent** → don't offer it in the first place (eligibility requires the
   L+1 diagnostic to exist).
8. **Contradictory profile** (grammar 95%, listening 40%) → per-domain bands diverge; overall band + per-domain
   repair handles it (don't collapse to one number for decisions).
9. **Re-placement of an already-progressing learner** → REASSESSMENT attempt; merge handles superseding
   evidence; roadmap regeneration policy is a roadmap concern (open).

## 18a. Worked scenarios

Concrete end-to-end walk-throughs the implementation must satisfy (owner-provided).

**Scenario A — completely new.**
Learner selects "I am completely new." → **No diagnostic.** Start at the beginning of A1. The full A1→C2 macro
roadmap is visible. **Nothing is marked validated** (`decisionType = FRESH_START`, `demonstratedLevel = null` —
not "A1 = 0%"). No evidence rows are written.

**Scenario B — claims B2, honest partial evidence.**
Learner claims B2. Result: Grammar 96, Vocabulary 91, Reading 92, Listening 84, Writing *not assessed*, Speaking
*not assessed*. → **B2 study placement accepted for the assessed scope**; weak points repaired as needed.
The system **does not claim formal/full B2 certification** because Writing/Speaking were never assessed. UX
shows "recommended starting level: B2" + per-domain evidence + explicit "not assessed" for writing/speaking.

**Scenario C — high overall, one required domain fails.**
Learner claims B2. Overall 96, but Listening 42. → **Do not fully validate B2** (the required-domain floor is
not met, §10). `decisionType = CONTINUE_WITH_REPAIR` with **targeted listening + prerequisite repair**. **Do
not offer C1** merely because overall ≥ 95 — the level-up gate (§11) requires every required domain to clear
its floor.

**Scenario D — validated, optional level-up, then a lower next-level result.**
Learner claims B2 and is validated strongly in **all required assessed domains**. → Offer an **optional** C1
challenge (opt-in, never automatic). Learner accepts; C1 result = 61. →
- **Preserve** the B2 validation (its evidence stands).
- **Preserve** the C1 evidence (append-only, separate attempt — nothing erased).
- Learner is **not** C1-ready; `recommendedStart` = the **B2→C1 transition/repair path**.
- Neither diagnostic is overwritten; both inform the decision.

**Scenario E — validated areas skip without fake completion.**
Placement validates Present Perfect and Passive Voice but detects weak Conditionals. →
- The roadmap marks the **demonstrated areas as validated** (satisfied-by-validation, §15a).
- It creates **no fake `LearnerLessonCompletion`** — no XP/IZL/time-spent for un-studied points.
- **Conditionals enters the required learning path** as real work to do.

## 19. Failure modes

| Failure | Mitigation |
|---|---|
| Faking speaking/writing to fill the grid | Hard rule: "not assessed" ≠ 0; no AI-fake; slots explicitly empty (§17). |
| Over-placing a learner (frustration) | Router picks lower on ambiguity (§18.4); `< rebuildLevel` triggers fallback; level-up is opt-in only. |
| Under-placing a strong learner (boredom) | `LEVEL_VALIDATED` + validated-area **skip** + level-up offer prevent forced restart. |
| Thin evidence → confident wrong decision | `minConfidenceForValidation`; confidence-weighted aggregation; `insufficientSkillIds` surfaced. |
| Placement decision drifting from skill state | Decision is a **recomputable projection** over `SkillMeasurement`; merge stays sole writer of state. |
| Magic-number thresholds scattered in code | Thresholds are a **versioned policy object** (§10), Methodist-owned. |
| Answer-key / difficulty leak to learner | Reuse the existing learner-safe projection (already strips them). |
| Non-reproducible results | Objective engine stays pure; attempts pin `definitionVersionId`; policy + derivation are versioned. |
| Level semantics undefined per content | Blocked on domain/level tagging (§22) — flagged as the top dependency. |

## 20. Data that must be persisted

- **Per-attempt (REUSE):** `AssessmentAttempt` (pins `definitionVersionId`, `purpose`, `engineState`,
  `resultSummary`), `AssessmentResponse` (immutable item sequence), `SkillMeasurement` (DIAGNOSTIC evidence).
- **New — entry context:** the learner's `claimedLevel` / entry intent (extend the learning-intent capture or a
  placement-session row).
- **New — placement session** (wrapper around one *or more* level attempts, for UNSURE routing and level-up
  chains): which level(s) were diagnosed, router outcome, challenge offered/accepted, and links to the
  contributing `AssessmentAttempt`s.
- **New — `PlacementDecision`** (versioned projection): the §15 contract, persisted for roadmap hand-off,
  UX replay, and audit. It must record `policyVersion` + `derivationVersion` + contributing `attemptId`s so it
  is reproducible. It is a **cache/projection**, not a competing source of per-skill truth.
- **Tags (content-side, §23):** domain + CEFR-level association for skills (and level-scoped diagnostic
  definitions). Persisted in content, authored by Methodists.

## 21. What can REUSE current architecture

- Per-attempt lifecycle + resume + immutability + winner-takes-all concurrency (`AssessmentService`,
  `PlacementFlowService`, `AssessmentAttempt`/`AssessmentResponse`).
- The adaptive engine mechanics (`placement-adaptive-v1`: per-skill difficulty walk, coverage quota,
  `pickItem`/`applyResult`/`isComplete`) — reused **per level diagnostic**.
- Objective scoring (`ObjectiveScorerService`, deterministic bp).
- The evidence substrate: `SkillMeasurement` (append-only, multi-attempt-safe) → single-writer merge →
  `LearnerSkillState` (`masteryScoreBp`/`confidenceBp`/`evidenceCount`).
- The diagnostic skill-profile derivation (`DiagnosticSkillProfileEngine`, difficulty-aware, versioned).
- The learner-safe item projection (strips `answerKey`/`skillId`/`difficulty`).
- The authoring module (`assessment-authoring`, DRAFT+OCC+audit, objective-only, readiness/publish) — extended
  to author **per-level** diagnostics.
- `AssessmentAttemptPurpose.REASSESSMENT` (already present) for re-placement.

## 22. What current architecture CANNOT support

- **No level identity on skills/evidence.** `Skill` is flat, subject-scoped, no CEFR/level/domain attribute;
  `displayLevel` is null with no FK to `Level`, and `Level.code` is free-text display data. That free-text
  behavior is **V1 compatibility history**, not the intended V2 English semantics (owner decision #1) — for
  English the A1→C2 ladder is a first-class spine. Today there is no way to say "this skill is *expected* at
  B2, in the grammar domain". → *blocks* `demonstratedLevel`, `domainScores`, validated-area skip, prerequisite
  fallback.
- **No domain/competency dimension.** Evidence is per-`skillId` only; there is no grammar/vocab/reading/
  listening axis to aggregate on.
- **Single-level diagnostic.** A diagnostic is subject-scoped with one flat `profileScale`; there is no level-
  scoped pool, no cross-level routing, no confidence/level-boundary stopping (stopping is coverage-quota +
  `maxItems`).
- **Placement decides nothing.** No `PlacementDecision`, no `recommendedStart`, no validated/skip concept; the
  output is counts + per-skill evidence. Roadmap includes every mapped lesson (mastery only re-orders).
- **No claimed-level / self-assessment capture** beyond `learningIntentId`.
- **No cross-level prerequisites** (per-lesson DAG only) for fallback.
- **Listening/writing/speaking** can't be delivered/scored (media fail-closed; no AI/STT).
- **No mistake taxonomy** for "why wrong" gap detail.

## 23. Schema / API changes that MAY later be required

*(Directional only — not a migration. Additive and nullable-first so A1 keeps working.)*

**Content/skill model (the top dependency):**
- **CEFR ladder as first-class structure for English** (decision #1). The A1→C2 progression is real product
  structure under a Track (canonically General English), not free-text display data. Whether this is a
  promotion of the existing `Level` container to a governed ordered ladder, or a new construct, is a design
  choice — but "level" stops being nullable display metadata. *(Exact schema deferred.)*
- **Skill ↔ Level as an association, NOT `Skill.levelId`** (decision #2). Reject a single owning level. A skill
  is *introduced* at one level and *expected / reinforced / assessed* at later levels (Present Simple:
  introduced A1, still assessed at B2). The future model expresses a **skill-to-level relationship** carrying
  concepts like *introduced / expected / reinforced-reviewed / validation-expectations* — likely a
  many-to-many association, not a scalar FK. *(Exact table/enum names deferred.)*
- **Domain as a first-class, subject-scoped concept** (decision #3). Domains belong to a Subject (English:
  Grammar, Vocabulary, Reading, Listening, Writing, Speaking, Pronunciation); **not** an architecture-wide
  English-only enum. **A `Skill` has a primary diagnostic domain**; cross-domain work is modeled as **multiple
  skills**, never one score spread across domains. *(Exact schema deferred — e.g. a subject-scoped `Domain`
  entity + a primary-domain association on `Skill`.)*
- **Level-scoped diagnostic definitions**: either one diagnostic definition per (subject, level) or a level tag
  on `AssessmentItem`/pool so the engine can draw a level-L pool (and a level-spanning pool for the router),
  driven by the skill↔level associations above.

**Placement/assessment:**
- Capture entry intent + `claimedLevel` (extend learning-intent or a placement-session row).
- A **placement session** entity wrapping ≥1 attempts (router + level + level-up chain).
- A persisted, versioned **`PlacementDecision`** (§15) with `policyVersion`/`derivationVersion`/contributing
  attempts.
- A **threshold policy** config object (versioned, Methodist-owned) — analogous to today's editable placement
  config.
- Router stopping rule = a new engine mode (level-span pool + early-narrowing stop) — an *added* engine
  variant, not a change to `placement-adaptive-v1`.

**API (additive):**
- Entry-intent + claimed-level on placement start.
- Router endpoints (or a router mode of start).
- A **get-decision** endpoint (today the result is embedded in `AttemptView`; V2 needs a first-class decision
  read for roadmap + UX).
- Level-up offer/accept endpoints.

**Roadmap (consumer):**
- Consume `PlacementDecision` (not just the per-skill snapshot) and honor `validatedAreas` as **skips**,
  `prerequisiteGaps` as **front-loaded injections** — the piece that breaks today's "no placement-out" rule.

## 24. Migration / compatibility strategy

1. **A1 stays live.** The current single diagnostic becomes the **A1 level diagnostic**; existing attempts,
   evidence, and roadmaps keep working. No data migration required to keep V1 running.
2. **Nullable-first tags.** Add domain/level associations as nullable; **backfill A1** (13 pilot skills → A1 +
   their domains) as a content step. Untagged skills behave as today (single-level).
3. **Ship the NEW-learner path first** — it is essentially today's flow (start at A1) plus macro-roadmap
   generation, the lowest-risk slice, and needs no diagnostic changes.
4. **Add the decision projection additively** — compute `PlacementDecision` from existing evidence; roadmap can
   read the richer decision while still falling back to the per-skill snapshot until it fully migrates.
5. **CLAIMS_LEVEL / UNSURE / level-up light up per level** as A2…C2 content + level-scoped diagnostics are
   authored; before that content exists they degrade honestly (§18.3).
6. **Thresholds & derivations are versioned** — old attempts remain reproducible under their pinned
   `definitionVersionId` + `derivationVersion`; new policy versions apply going forward.
7. **No breaking change** to the merge, `LearnerSkillState`, objective scoring, or the learner-safe projection.

## 25. Acceptance criteria for implementation

A V2 Placement implementation is acceptable when:

1. All three entry intents work: NEW never sees an exam; CLAIMS_LEVEL runs exactly that level's diagnostic;
   UNSURE routes via a short screener to a single level diagnostic.
2. A completed placement yields a persisted, versioned `PlacementDecision` carrying every §15 concept, with
   every band **traceable to evidence** (`attemptId` + skills).
3. Threshold behavior matches §10 for all four bands, with thresholds read from a versioned policy object (no
   inline constants); band edges are covered by tests including the 95/80/50 boundaries.
4. The B2=97% / C1=61% scenario produces: B2 validated, not-C1-ready, `recommendedStart` at the B2→C1
   transition, and **both** attempts' evidence persisted.
5. Unmeasured domains (writing/speaking, and listening when media is unavailable) render as **"not assessed"**
   end-to-end (decision + UX), never as 0; no faked scores.
6. Per-skill `LearnerSkillState` is still produced solely by the merge; `PlacementDecision` is recomputable
   from evidence and never the authoritative per-skill store.
7. Objective placement remains deterministic and reproducible (pinned version + versioned derivation/policy).
8. No V1 regression: the existing A1 diagnostic, skill profile, roadmap generation, and learner-safe projection
   behave identically for untagged/single-level content.
9. Level-up is **opt-in** (offer, never auto-advance) and only offered when the next level's diagnostic exists.
10. No answer keys or difficulties leak to any learner surface (reused projection verified).

---

## 26. Resolved by owner (V2) vs still open

**Resolved by owner (no longer "unresolved" — see §0.1):**
- English CEFR canonical progression (A1→C2 is the first-class spine).
- Single `Skill.level` vs level **association** → association (introduced/expected/reinforced/validation).
- Domain ownership/model direction → first-class, **subject-scoped**; skill has a primary domain.
- Overall level vs per-domain result semantics → study-placement decision + per-domain evidence, **not**
  certification.
- Mistake taxonomy **ownership** → Methodist / verified-content owned; AI classifies into it, never invents.
- Validated vs completed semantics → `VALIDATED_BY_ASSESSMENT` ≠ `COMPLETED_BY_LEARNING`.

**Still genuinely open (deferred by decision):**
- Exact schema / table / enum names (skill↔level association, domain entity, decision/session rows).
- Exact psychometric / decision-certainty formula.
- Item count / stopping calibration.
- Minimum **required-domain floor** numeric values.
- Evidence-sufficiency numeric policy.
- STT / AI provider (writing, speaking, pronunciation, tutor).
- A2–C2 authoring timeline (architecture is ready; availability rolls out level-by-level).
- Initial **contents** of the (Methodist-owned) mistake taxonomy.

## Appendix A — Gap analysis: CURRENT V1 vs REQUIRED V2

Classification per major placement behavior. **REUSE** = keep as-is; **EXTEND** = build on it; **REPLACE** =
change the behavior/boundary; **NEW** = does not exist.

| # | Behavior | V1 today | V2 required | Class |
|---|---|---|---|---|
| 1 | Per-attempt lifecycle (start/present/submit/advance/complete, resume, concurrency) | Robust, DB-authoritative | Same, wrapped by a session | **REUSE** |
| 2 | Adaptive per-skill difficulty walk | `placement-adaptive-v1` | Same mechanics, per **level** pool | **REUSE / EXTEND** |
| 3 | Objective scoring (deterministic bp) | `ObjectiveScorerService` | Same | **REUSE** |
| 4 | Evidence substrate (`SkillMeasurement` → merge → `LearnerSkillState`) | Single-writer, append-only, multi-attempt-safe | Same substrate + roll-up projection | **REUSE / EXTEND** |
| 5 | Diagnostic skill estimate | `DiagnosticSkillProfileEngine` (difficulty-aware) | Same + domain/level aggregation | **REUSE / EXTEND** |
| 6 | Entry intent (new / claims-level / unsure) | Only `learningIntentId` | Three intents + claimed level | **NEW** |
| 7 | Level identity on skills/evidence | none (`displayLevel` null, no FK) | CEFR-level + domain association | **NEW** |
| 8 | Domain dimension (grammar/vocab/reading/listening…) | none (per-skill only) | per-domain bands | **NEW** |
| 9 | Level-scoped / routing diagnostics | single flat diagnostic | per-level pools + router mode | **NEW / EXTEND** |
| 10 | Result semantics | evidence-only counts, no decision | `PlacementDecision` (level, validated, weak, start, repairs) | **REPLACE** the boundary |
| 11 | Threshold policy | none (mastery threshold not even fixed) | versioned 95/80/50 policy | **NEW** |
| 12 | Gap detection (what's weak) | per-skill mastery only | domain/topic/skill weak+strong areas | **EXTEND** |
| 13 | Prerequisite fallback (below-level) | none (no cross-level prereqs) | prior-level backfill | **NEW** |
| 14 | Level-up challenge | none | opt-in next-level offer + chain | **NEW** |
| 15 | Roadmap hand-off | per-skill diagnostic snapshot; no skip | consume `PlacementDecision`, honor validated-skip | **REPLACE / EXTEND** |
| 16 | Writing/speaking/listening measurement | not measured (listening blocked by media) | honest "not assessed" slots; AI later | **NEW (honest-degrade now)** |
| 17 | Result UX (evidence, not percent) | `AttemptView.result` counts | per-domain evidence + decision + reason | **NEW** |
| 18 | Mistake taxonomy ("why wrong") | none | error-type granularity | **NEW (deferred)** |

## Appendix B — Technical debt (explicit)

1. **No item calibration / psychometrics.** The engine is a heuristic difficulty walk with coverage-quota
   stopping — not IRT. V2 improves stopping/confidence but item difficulty remains hand-set (`difficulty` ∈
   `profileScale`). True calibration is future debt (`OPEN_QUESTIONS.md`: "final psychometric tuning open").
2. **`confidenceBp` conflates evidence coverage with certainty** — usable, but a real certainty measure
   (standard error) would let stopping be adaptive rather than fixed-quota.
3. **`displayLevel` is a dangling nullable** with no producer — V2 must define its meaning or leave it null;
   don't let ad-hoc code start writing it as a second source of truth.
4. **Content is A1-only.** Every multi-level V2 behavior degrades to A1 until A2–C2 content + level-scoped
   diagnostics are authored — a content-org dependency, not an engine one, but it gates end-to-end value.
5. **Listening/writing/speaking blocked on infrastructure** (media object-store adapter; AI provider; STT) —
   these are release-config/tech-choice debts (see the deployment gate + `OPEN_QUESTIONS.md` §1.4/1.6), not
   placement-logic debt.
6. **Roadmap "no placement-out"** is the highest-leverage downstream change: until the roadmap honors
   `validatedAreas` as skips, even a perfect `PlacementDecision` produces a restart-everything plan.
7. **Mistake taxonomy — ownership resolved, contents not authored yet.** Ownership is decided (Methodist /
   verified-content; AI classifies into it, never invents — §12/owner #7). The remaining debt is purely the
   **authoring** of the initial category set; until it exists, gap detection ships at skill/topic granularity.
