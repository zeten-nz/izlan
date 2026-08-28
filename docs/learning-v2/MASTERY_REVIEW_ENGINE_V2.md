# Mastery & Review Engine V2 — Specification

> **Status:** SPECIFICATION ONLY. No code, Prisma/schema, migration, endpoint, runtime, test, or deployment
> change is implied. V1 / CONTROLLED_RC keeps running unchanged.
>
> **Companions:** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md),
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md), [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md),
> [`TEACHING_ENGINE_V2.md`](./TEACHING_ENGINE_V2.md), [`SKILLS_ENGINE_V2.md`](./SKILLS_ENGINE_V2.md).
>
> **Grounding (verified against current code):** append-only `SkillMeasurement` + compact `LearnerSkillState`
> (`learning.prisma:213-261`); single-writer merge `LearningProgressService`; **merge core**
> (`src/learning-progress/merge/merge-core.ts`: `included = anchor + incrementals strictly after the anchor`;
> `effectiveWeight = evidenceCount × confidenceBp`; anchor = latest `observedAt` → CHECKPOINT>DIAGNOSTIC →
> greatest id; blends all kinds into **one** `masteryScoreBp`); derivations `skill-profile-diagnostic-v1`,
> `deriveLessonMastery` / `deriveReviewMastery` (both hard-code `confidenceBp = 10000`); **review-due**
> (`src/learner-signals/review-due-signal.policy.ts`: fixed **1/3/7/14-day** interval from
> `masteryScoreBp`+`confidenceBp`+`lastMeasurementAt`; resolves on **any** new evidence after basis); **review
> selection** (`src/review-session/selection/review-activity-selection.ts`: re-serves the **same** objective
> activities of the pinned revision; objective-only); `LearnerSignal` (REVIEW_DUE / REPEATED_MISTAKE /
> weak-skill; `categoryCode` taxonomy). Accepted decisions cited D-xx. **Exact schema/enum/formulas deferred**
> (owner) — this fixes the *domain contract*, not identifiers or numbers.

---

## 1. Purpose

The Mastery & Review Engine decides, from evidence, **whether a skill/point is sufficiently demonstrated**,
**with what kind and independence of evidence**, **whether that knowledge is still fresh**, and **when/what to
review** — separating **demonstrated mastery** (durable, evidence-derived) from **retention/freshness**
(current, time- and recall-driven). It evaluates Mastery Requirements and hands results to Roadmap (point
acquisition), Placement (evidence quality), Teaching (repair/remediation), and Daily Plan (review candidates).

It must **not**: create canonical skills, define curriculum, decide the detailed teaching sequence, fabricate
missing evidence, equate time passage with automatic failure, or silently change Placement decisions.

V1 reduces all of this to a single blended `masteryScoreBp` (+ coverage `confidenceBp` + `evidenceCount`) with a
crude fixed-interval review-due signal and identical-activity review — insufficient for the semantics below
(§43).

## 2. Principles

1. **Mastery is not one number** — it is several dimensions (§4).
2. **Historical evidence is immutable and never decays** (§5).
3. **Time does not fabricate forgetting** — *time alone* lowers **freshness**, not the historical evidence; but
   sufficiently strong, repeated, relevant **new evidence** may move the **current** competence projection up or
   down (§5/§20/§29). Never "once mastered, never decreases."
4. **Mastered can coexist with `REVIEW_DUE`** (multi-axis, mirrors Roadmap) (§7).
5. **Repair ≠ review**; **one wrong ≠ weakness**; **one correct ≠ mastery**; **recognition ≠ production**
   (§8/§9/§17).
6. **Evidence has a kind and an independence** — hinted ≠ unaided; recognition ≠ production (§12/§18).
7. **Requirements are Methodist-owned, versioned policy**, not runtime AI judgment (§10).
8. **Signals are interpretations, not the truth** — append-only evidence is the source; state is a recomputable
   projection (§6/§28/§29).
9. **AI/media-dependent evidence is never faked** — `NOT_ASSESSED`, not 0 (§26/Scenario H).
10. **Mastery/Review models; other engines decide** — clear contracts (§33-36).

## 3. Definitions

| Term | Meaning |
|---|---|
| **Historical evidence** | What the learner demonstrated at a time under a task/rubric/context. **Immutable** (§5). |
| **Historical acquisition fact** | A past legitimate event (e.g. Point `LEARNED` at T). **Immutable** (§5). |
| **Current competence projection** | What present evidence supports about ability **now**. **Recomputable** — may move up/down (§5). |
| **Retention / freshness** | How current the *recall* evidence is (time- and review-driven). |
| **Mastery requirement** | Versioned Methodist policy: what evidence satisfies a Skill-Level Expectation / Roadmap Point (§10). |
| **Review** | Recall/strengthen an *already-established* skill (§8). |
| **Repair** | Establish knowledge that was *never* sufficiently established, or fix an unresolved gap/misconception (§8). |
| **Review candidate** | A skill flagged for review, with priority + reason + provenance (§13/§14). |
| **Measurement** | An append-only evidence fact (`SkillMeasurement`, richer in V2 — Skills §15). |
| **Current projection** | A compact, recomputable state read for consumers (§30). |

## 4. Mastery dimensions

V1's `masteryScoreBp` + `confidenceBp` + `evidenceCount` is useful but insufficient. Distinguish **at least
seven** dimensions — do **not** overload them into one "confidence" field (aligns with Skills §17):
- **A. Demonstrated performance** — how well the learner actually performed.
- **B. Evidence coverage** — how much relevant material was sampled (today's `confidenceBp`).
- **C. Evidence sufficiency** — is the evidence *enough* for the required decision (assessment states, Skills
  §18).
- **D. Evidence diversity** — recognition only? production? reading/listening? multiple contexts? (Skills §11.)
- **E. Independence** — unaided vs hinted/scaffolded (Skills §14).
- **F. Freshness / retention** — how recently the learner successfully recalled/applied it.
- **G. Decision confidence** — how strong the basis is for a mastery/placement/roadmap decision.
Exact persistence/formulas deferred (§48).

## 5. Historical evidence, acquisition facts, and current competence

Three distinct concepts must never be conflated. **Immutable historical evidence is not the same as immutable
current mastery** — the first never changes; the third is a recomputable projection that **may move up or
down**.

- **A. Historical evidence** — what the learner demonstrated *at a particular time under a particular
  task/rubric/context* (append-only `SkillMeasurement`). **Immutable.** "On 2026‑08‑01 the learner
  independently produced 9/10 correct Present Simple 3SG sentences" stays true forever — time must **never**
  rewrite that measurement to 5/10.
- **B. Historical acquisition fact** — e.g. *a Roadmap Point was legitimately marked `LEARNED` at time T
  because the published Mastery Requirement was satisfied.* That **event remains true**; later recall weakening
  does **not** rewrite the fact that it happened (§11/§34).
- **C. Current competence / mastery projection** — what present evidence supports about the learner's ability
  **now**. **Recomputable.** Sufficiently strong, repeated, comparable new evidence may change it **up or down**
  (§3/§20/§29).

**Do not** establish the incorrect invariant "once mastered, skill mastery can never decrease." Only **A** and
**B** are frozen; **C** responds to new evidence. A learner may hold strong historical evidence (A) and a
legitimate past `LEARNED` (B), yet a lower **current** competence projection (C) and `REVIEW_DUE`/
`REPAIR_REQUIRED` (§7). The append-only substrate freezes A/B; the merge/recompute produces C — V2 must not add
any path that mutates old measurements, and must not freeze C forever either.

## 6. Current projections

Preserve the valuable architecture: **append-only evidence → deterministic/versioned derivation → compact
current projection**. The projection is a *recomputable cache*, not a competing truth. The single-writer merge
(`LearningProgressService`) stays the producer of `LearnerSkillState`; V2 enriches *what* is projected (§30),
not the append-only + recompute discipline.

## 7. Historical acquisition vs current competence vs freshness (multi-axis)

A past **acquisition fact** (`LEARNED`), a **current competence projection**, and **freshness** are independent
axes that can hold different values at once (mirrors Roadmap §12):
```
Present Simple:  Acquisition = LEARNED            (historical fact — legitimately met the requirement at T; §5.B)
                 RetentionAttention = REVIEW_DUE  (current freshness)
                 [later evidence]  → Attention = REPAIR_REQUIRED + lower CURRENT competence projection (§5.C)
```
- `MASTERED / sufficiently demonstrated` and `REVIEW_DUE` can be true together (`MASTERED` is **not**
  `REVIEW_NOT_NEEDED_FOREVER`).
- **`LEARNED` can also coexist with `REPAIR_REQUIRED`** and a **lower current competence projection** when later
  evidence reveals a present gap — **this is not contradictory.** `LEARNED` means the learner *legitimately
  satisfied the acquisition requirement in the past* (§5.B); it does **not** mean they can never forget,
  regress, or reveal a previously hidden gap.
- Review does **not** erase historical learning (A/B are frozen); it, like any evidence, may update the current
  projection (C) per §20/§29.

## 8. Repair vs review

- **REPAIR:** the required knowledge/performance was **never sufficiently established**, or current evidence
  reveals an unresolved prerequisite/misconception gap (e.g. repeatedly cannot form 3SG; productive evidence
  never met the expectation; a B1 prerequisite blocks a B2 point). Repair routes back through
  Teaching/remediation.
- **REVIEW:** the skill **was** sufficiently demonstrated but should be recalled/re-strengthened (spaced recall;
  a recent recall lapse). Review **tests recall before re-teaching**.
- **Do not collapse them.** Review may *transition into* repair (§13/§18), but they are distinct states/
  processes with distinct provenance and pedagogy. (V1 has neither concept explicitly — mastery only moves a
  number; §43.)

## 9. Wrong-answer semantics

A single incorrect response must **not** automatically create `WEAK_SKILL` or `REPAIR_REQUIRED`. Possible
causes: slip · misunderstanding · vocabulary confusion · attention · task ambiguity · insufficient evidence ·
real misconception. A weakness/misconception signal accumulates from: **repeated pattern**, task
**independence**, multiple **contexts/items**, the **mistake taxonomy**, **previous mastery**, **recent review
performance**, and **evidence amount**. Exact thresholds open (§48; Scenario A/B).

## 10. Mastery requirements

A **Mastery Requirement** is Methodist-owned, **versioned, published policy** (not runtime AI judgment) for a
Skill-Level Expectation and/or Roadmap Point. It may require: required skills · required evidence **kinds** ·
minimum evidence **sufficiency** · **independence** · required **productive** evidence · critical-skill gates ·
unresolved-misconception restrictions · cumulative/mixed evidence · optional **freshness** requirement where
pedagogically justified. It uses Skills Engine **Skill-Level Expectations** as input. Exact schema/numbers
deferred.

## 11. Point mastery

Teaching-session completion ≠ Roadmap-Point mastery (`TEACHING_ENGINE_V2.md` §21). Flow:
```
Teaching session completes → evidence emitted → skill state/projections recomputed
  → point Mastery Requirement evaluated
      → satisfied     ⇒ Roadmap may mark Acquisition = LEARNED
      → not satisfied ⇒ point remains not-learned, may receive REPAIR_REQUIRED
```
Point mastery must **not** be "all activities viewed" or "one final MC ≥ 90%". (Today `deriveLessonMastery` =
mean of best MASTERY_TEST — a single-format proxy; EXTEND, §43.)

## 12. Evidence sufficiency / diversity

Mastery evaluation reads the Skills evidence model (§ Skills 11-18): **kind** (recognition / controlled /
guided / independent production / reading / listening / speaking / pronunciation / review-recall),
**independence**, **coverage**, **sufficiency** (`NOT_ASSESSED` / `INSUFFICIENT_EVIDENCE` /
`SUFFICIENTLY_ASSESSED`). A requirement that needs production is **not** satisfied by recognition-only evidence,
however high the score. (V1 blends all kinds into one number — it cannot express this; §43.)

## 13. Review candidate generation

A skill becomes a review candidate from **evidence-aware, versioned** signals: time since last **successful
independent** evidence · prior mastery strength · evidence diversity · previous review outcome · repeated recent
mistake · learner signal · an upcoming **dependent** roadmap point · **manual** request (§37).
- **Avoid a fixed universal `1→3→7` as the only truth.** A scheduler *may* use spaced-repetition-like
  intervals, but the policy must remain **versioned, configurable, and evidence-aware** (kind, independence,
  criticality). Today `review-due-signal-v1` is exactly a fixed 1/3/7/14-day interval from `masteryScoreBp` +
  `confidenceBp` only, and it **resolves on any new evidence** (even a failed review) — EXTEND/REPLACE (§43).

## 14. Review priority

Not every due skill is equal. Consider: overdue amount · skill **criticality** · prerequisite importance ·
current **roadmap relevance** · previous recall difficulty · mastery evidence · learner goal · required level
expectation · **repair vs review**. The engine produces **prioritized review candidates** (with reason +
provenance) — **not** the learner's daily schedule; Daily Plan chooses what fits today (§36).

## 15. Review session model

A review session answers *"can the learner still recall/apply this?"* It is a dedicated aggregate (today
`LearnerReviewSession` exists, distinct from `LearningSession`/`LearnerLessonProgress`/`LearnerLessonCompletion`
— reuse). It pins task/version context (§38/§39), records responses (append-only `ActivityAttempt` with
`reviewSessionId` provenance — exists), and emits review evidence. V2 extends it to support productive review
and richer resumable state.

## 16. Review task selection

**Do not simply repeat the identical old activity** (V1 re-serves the same pinned-revision activities —
REPLACE). Prefer: a **different surface example**, same underlying skill; context variation; interleaving where
justified; evidence type appropriate to the expectation; **independent recall first**. Example:
```
Original:  She ___ a doctor.          Review:  My sister ___ at university.   (same skill: to-be agreement)
```
This avoids memorizing answer position/text.

## 17. Recognition vs productive review

If the mastery expectation requires **production**, review cannot be multiple-choice forever. For a Present
Simple *production* expectation, weak review = "choose *works*"; stronger review = `"My father / work /
hospital" → My father works in a hospital.` **Review evidence kind must match the Skill-Level Expectation** where
production is required (Scenario G).

## 18. Scaffolding / independence in review

Begin with the **least support** practical; escalate hints only as needed and **record** them. A correct answer
after heavy hinting is **not** identical to independent recall. Review evidence preserves hint use · retries ·
independence · remediation · evidence kind (consistent with Skills §14). Exact weighting deferred (Scenario C).

## 19. Review success

Successful review must **not**: rewrite the original `LearnerLessonCompletion`; produce a fake new completion;
award normal lesson-completion rewards (unless a **separate** review-reward policy explicitly allows one, §40);
or erase earlier mistakes. It **appends** new review evidence (`REVIEW_RECALL` kind); the current projection
changes only through **recomputation/policy** (Scenario E).

## 20. Review failure

One failed review does not necessarily erase mastery. Consider prior strength · failure severity ·
independence · repeated failure · misconception pattern · recency · criticality. Outcomes (enum deferred):
`REVIEW_AGAIN_SOON` · `TARGETED_REINFORCEMENT` · `REPAIR_REQUIRED`. **Repeated or severe** recall failure may
lower the **current** proficiency projection or trigger repair — but **historical mastery evidence remains
intact** (Scenario F).

## 21. Retention / freshness

A conceptual **retention projection** may include: last independent success · last review success · current
review due window · recall difficulty · recent failures · review interval/history · freshness state. Use
**honest semantics** — do **not** assert "80% chance the user remembers" unless a future *validated* model
supports it. Freshness is a *current* projection derived from evidence + time; it never mutates historical
evidence (§5).

## 22. Spaced-repetition boundary

Izlan may use spaced-repetition ideas, but it is **not a flashcard-only product**. Review scheduling must
respect skill semantics, roadmap, learning goal, domain, evidence type, productive/receptive differences, and
prerequisite importance. **Do not impose one generic SRS algorithm across all skills** — a writing skill needs
a different review task/cadence from vocabulary recall.

## 23. Vocabulary considerations

Vocabulary benefits from spaced recall, but has multiple evidence forms: recognition of meaning · recall of
meaning · spelling · usage in a sentence · listening recognition · productive use. Do **not** reduce vocabulary
mastery to "clicked the correct translation once." Support word/phrase **skill families** and contextual use
(Skills §7). (Full vocabulary subsystem not designed here.)

## 24. Grammar considerations

Grammar review focuses on **application**, not repeated rule-reading: gap-fill · sentence transformation ·
sentence construction · short writing/speaking use. Reveal the targeted rule/remediation **only as needed** on
failure (§18).

## 25. Reading / listening considerations

Avoid memorizing the exact old passage/audio: use **new content testing the same underlying skill** (Reading
Main Idea → new short passage; Listening Specific Detail → new audio/dialogue). If **media is unavailable**, do
**not** fabricate review evidence — the review is `NOT_ASSESSED`/unavailable (§26).

## 26. Writing / speaking considerations

Productive review needs **productive evidence** when required: Writing → a **new** prompt / constrained
production; Speaking → a **new** prompted response. If AI/speech evaluation is unavailable, productive review is
`NOT_ASSESSED`/unavailable **unless an approved deterministic/manual fallback exists** — **never fake successful
review** (Scenario H; consistent with Teaching §24/§29 and Skills §18).

## 27. Misconception lifecycle

Canonical mistake taxonomy is Methodist-owned (Skills §23). Lifecycle: `observation → repeated evidence →
active misconception signal → targeted repair/review → resolved (no longer active) → historical record
retained`. **One observation ≠ durable misconception.** A resolved misconception may **recur** later — do not
delete history. Exact activation thresholds open. (`LearnerSignal.categoryCode` + `repeated-mistake.detector`
exist — EXTEND.)

## 28. LearnerSignal relationship

Audit: `LearnerSignal` (types REVIEW_DUE / REPEATED_MISTAKE / weak-skill; `categoryCode`, `strength`, `status`).
V2 may use signals for `REVIEW_DUE`, `REPEATED_MISTAKE`, `PREREQUISITE_GAP`, `LOW_EVIDENCE`, productive-evidence
missing — but **a signal is an actionable interpretation/recommendation, NOT authoritative skill state and NOT
the historical evidence**. Signals are derived, resolvable, and re-creatable; evidence is immutable; state is
recomputable. Keep the three layers distinct.

## 29. Recompute / merge model — risk analysis (audit of V1)

Preserve `append-only evidence → deterministic/versioned merge → compact projection`, but **do not assume V1's
merge is correct for V2.** Confirmed behavior and risks (`merge-core.ts`; `included = anchor + incrementals
strictly after the anchor`, `effectiveWeight = evidenceCount × confidenceBp`):
- **A later anchor drops earlier evidence.** A new CHECKPOINT/DIAGNOSTIC (latest `observedAt`) becomes the
  anchor and **excludes all incremental evidence observed before it** — earlier diverse lesson/review evidence
  silently leaves the effective window. Risk: checkpoint effectively *replaces* prior evidence.
- **Productive evidence can disappear** from the window (same mechanism) and there is **no evidence-kind**, so
  recognition and production are **blended into one `masteryScoreBp`**. Risk: false "mastered" from recognition.
- **`confidenceBp` used as certainty/weight.** It is *coverage*, yet it is the merge weight; `LESSON_MASTERY`/
  `REVIEW_MASTERY` hard-code it to `10000`, so those get maximal weight regardless of true certainty.
- **Review over-influences mastery.** `REVIEW_MASTERY` is an incremental at confidence `10000`, so a single
  review (even recognition-only) moves `masteryScoreBp` as much as lesson mastery — and a **failed** review
  drags it down by averaging, conflating *retention* with *demonstrated mastery*.
- **Anchor semantics across reassessment** conflate *superseding a decision* with *superseding evidence* (§30).
- **Recommended direction:**
  - never mutate or drop **historical evidence** (§5.A);
  - do **not** blindly average incompatible **evidence kinds** (recognition vs production, §12);
  - keep **retention/freshness** a separate projection from current competence;
  - allow the **current competence projection** to respond to sufficiently **strong, relevant, comparable** new
    evidence — up or down (§5.C);
  - **review source alone must neither automatically lower nor automatically protect mastery** — *evidence
    semantics* (kind, independence, comparability, consistency) matter more than the *source label*;
  - a newer assessment may **supersede a decision** without **erasing evidence** (§30).
  Exact merge formula deferred (§48).

## 30. Assessment anchors / reassessment

Placement/checkpoint/reassessment evidence may be important **anchors/baselines**, but a new assessment must
**not blindly erase** meaningful prior evidence. Distinguish: evidence window · baseline/anchor · historical
evidence · current-policy recomputation · **superseding a PLACEMENT DECISION vs superseding EVIDENCE**. A newer
assessment may supersede a previous *placement decision* **without** deleting/silencing historical *skill
evidence* (Scenario I). Do not finalize the merge algorithm.

## 31. Evidence conflicts

Do **not** blindly average conflicting evidence. *Last month independent production strong; today one objective
review wrong* → **not** 50% (likely a slip, §9). *Last month MC recognition strong; today independent production
consistently weak* → a **meaningful** conflict (recognition ≠ production, §17). Conflict handling considers:
evidence **kind** · **recency** · **independence** · expectation relevance · repeated consistency · task
comparability. Exact weighting deferred.

## 32. Current skill state projection

A compact current projection for consumers (not a giant mutable truth row; append-only history is the source).
It may expose: demonstrated mastery/performance · assessmentState/sufficiency · evidence diversity ·
independence · freshness/retention state · review-due · active misconception signals · most recently
demonstrated level expectation. (Today `LearnerSkillState` exposes only mastery/confidence/evidenceCount/
displayLevel/lastMeasurementAt — EXTEND.)

## 33. Level-expectation satisfaction

Skills defines Skill-Level Expectations; **Mastery evaluates whether current evidence satisfies them**:
```
ENG-PRESENT-SIMPLE-3SG @ A1:        SATISFIED
ENG-PRESENT-SIMPLE-PRODUCTION @ A2: INSUFFICIENT_EVIDENCE
```
Expectation satisfaction needs **two conceptual views** (field names deferred): **historically satisfied at
time T under policy/version V** (an immutable acquisition fact, §5.B), and **currently supported by present
evidence** (recomputable, §5.C). An expectation can remain *historically satisfied* while *currently
under-supported* and/or *review is due* — do not conflate *expectation satisfied* with *fresh recall verified
today*, nor freeze the current view forever (§7).

## 34. Roadmap contract

Roadmap asks: *"has this point's Mastery Requirement been satisfied?"* Mastery returns the evidence/policy
evaluation; **Roadmap owns point acquisition state**:
```
requirement satisfied     → Roadmap Acquisition = LEARNED
requirement not satisfied → not learned; maybe REPAIR_REQUIRED
later review due          → Acquisition stays LEARNED; Attention = REVIEW_DUE
```

## 35. Placement contract

Placement diagnostic evidence enters the **same** skill/evidence substrate. But `VALIDATED_BY_ASSESSMENT` is a
**Placement/Roadmap** semantic fact — Mastery must **not** transform assessment validation into fake learning
completion (Roadmap §10). Placement may use Mastery/Skills projections for **evidence quality**, but **owns**
the `PlacementDecision`.

## 36. DailyPlan contract

Mastery/Review produces **due review candidates + priority + estimated type/effort (where available) + reason +
provenance**. **Daily Plan decides what to schedule today** — Mastery/Review is **not** the scheduler (Roadmap
§19; today `DailyPlan` has no generator).

## 37. Manual review

The learner may choose *"review this skill again"* even when **not due** — allowed; it creates review evidence
normally. But **only meaningful attempts/results produce evidence** — merely opening the page must not
manipulate long-term state (Scenario J).

## 38. Resume / idempotency

A review session must be **resumable** where appropriate. Reload must **not**: generate an unrelated new review
set; duplicate evidence; or mark the review completed without responses. A started review **pins** enough
task/version context for reproducibility (Scenario K; today `ActivityAttempt` idempotency by
`clientRequestId` + review provenance exists — reuse/extend).

## 39. Versioning / reproducibility

Pin: review **selection policy** version · skill **expectation** version (where needed) · **activity/content
revision** · **scoring/rubric** version · **mastery derivation** version. Historical review outcomes must remain
interpretable if policies evolve (Scenario L; today `derivationVersion` + `review-due-signal-v1`/
`review-session-v1` identifiers exist — extend the set).

## 40. Rewards boundary

Mastery/Review must **not** invent IZL/XP policy. It emits **facts** (review completed · independent recall
succeeded · mastery requirement satisfied); the **Reward Engine** decides rewards. Prevent farming: repeating an
already-mastered trivial review must not auto-generate unlimited reward (D-25/D-27). Finance/reward policy is
not solved here.

## 41. Present Simple — worked timeline example

- **Day 1 — study.** Evidence: recognition strong · 3SG production strong · guided writing strong · one
  independent sentence correct · Mastery Requirement satisfied → **Point LEARNED** (durable, §11).
- **Day 3 — review candidate.** Independent prompt `"My brother / work / bank"` → *"My brother works in a
  bank."* → **successful recall evidence appended** (`REVIEW_RECALL`); **freshness strengthened**; next review
  may move later. (Historical Day-1 evidence unchanged.)
- **Day 10 — one review error.** `"She ___ TV every evening."` → learner selects **watch** (wrong). → **Do not**
  instantly mark the skill weak/unlearned; the Point **stays `LEARNED`**, no immediate repair, current competence
  **not meaningfully downgraded yet** (likely a slip/freshness signal, §9). Give a **different** re-check:
  `"My father ___ football on Sundays. [play] [plays]"`. If **correct independently** → treat the first error as
  a **slip**; no repair escalation.
- **Later — three independent production failures across different contexts** (all omit 3SG *-s*). → The
  architecture must support, simultaneously:
  - **historical Day‑1 evidence remains** (§5.A, frozen);
  - the **historical `LEARNED` event remains** (§5.B, frozen — history is not rewritten);
  - the **current productive competence projection MAY downgrade** (§5.C — strong, repeated, comparable
    independent production evidence);
  - **misconception evidence strengthens** and a **`REPAIR_REQUIRED`** signal activates (§20/§27);
  - Roadmap may therefore show **`LEARNED` + `REPAIR_REQUIRED`** at once (§7/§34) — not a contradiction.
  The current mastery projection is **never frozen forever**, yet no historical fact is erased.

## 42. Recognition-vs-production — worked example

Learner has: **MC recognition 95%**, but **independent writing frequently omits 3SG *-s***. → **Do not** average
to a misleading "90% mastery". Interpretation: recognition **strong**; productive expectation **weak /
insufficient**; the A1/A2 expectation decision depends on the **required evidence** (§12/§33). Roadmap may
require targeted **productive repair** (§34).

## 43. V1 → V2 gap analysis

**Why `scoreBp + confidenceBp + evidenceCount + weighted merge` is insufficient:** it has **no evidence kind**
(recognition vs production blended into one number), **no independence** (hints not recorded in state), **no
sufficiency** (coverage ≠ sufficiency), **no freshness/retention** (mastery is time-invariant; review-due is a
crude fixed interval), **no misconception state** (only transient signals), **blind averaging** of conflicting
evidence, and **no repair-vs-review** distinction (both collapse to score movement). What must remain:
append-only evidence + recomputable state.

| Component | Verdict | Notes |
|---|---|---|
| `SkillMeasurement` (append-only) | **REUSE + EXTEND** | keep immutable/provenance/idempotency; add evidence kind, independence, expectation/policy version (Skills §15). |
| `LearnerSkillState` (compact) | **EXTEND** | add freshness/retention, assessmentState, diversity, independence, misconception dims; stays compact/recomputable (§32). |
| `LearningProgressService` (single writer) | **REUSE** | keep single-writer recompute discipline. |
| `merge-core` (anchor + post-anchor incrementals; blend all kinds) | **REPLACE / EXTEND** | must not blend recognition with production, not let a later anchor silently drop prior evidence, not weight review = lesson via hard-coded confidence, and must separate demonstrated mastery from retention (§29). |
| diagnostic anchor / checkpoint anchor | **EXTEND** | anchor = baseline, not eraser; supersede *decision* ≠ supersede *evidence* (§30). |
| `deriveLessonMastery` (mean best MASTERY_TEST, conf=10000) | **EXTEND** | evidence-kind aware; stop hard-coding full confidence. |
| `deriveReviewMastery` (conf=10000) | **EXTEND** | review recall **primarily feeds freshness**, and **may also update current competence** when the task is comparable/independent/right-kind (§ owner part 3, §29); stop full-confidence weighting. |
| `LearnerReviewSession` | **REUSE + EXTEND** | session aggregate reused; add productive review + resumable state. |
| `review-activity-selection` (re-serves same activities, objective-only) | **REPLACE** | vary surface/context; support productive review (§16/§17). |
| `review-due-signal-v1` (fixed 1/3/7/14; resolves on any evidence) | **EXTEND / REPLACE** | evidence-aware, versioned, kind-aware; a **failed** review must not silently resolve the due (§13). |
| `LearnerSignal` (REVIEW_DUE / REPEATED_MISTAKE / weak-skill) | **REUSE + EXTEND** | interpretations, not state; add PREREQUISITE_GAP / LOW_EVIDENCE / productive-missing (§28). |
| `LearnerLessonCompletion` | **REUSE** | never faked/rewritten by review (§19). |
| roadmap reconcile (all lessons completed) | **EXTEND** | point acquisition via **Mastery Requirement**, not "all lessons completed" (§11/§34). |
| `DailyPlan` relationship | **REUSE** | candidates only; no generator (§36). |

## 44. Scenarios

**A — One wrong review after strong mastery** → no immediate unlearn/repair; different re-check (§9/§41).
**B — Repeated independent errors** → misconception/repair signal escalates (§9/§27).
**C — Heavy-hint review success** → useful evidence, but lower independence than unaided recall (§18).
**D — Mastered skill becomes review-due** → Acquisition stays LEARNED; Attention REVIEW_DUE (§7).
**E — Review succeeds** → append evidence; do **not** rewrite lesson completion (§19).
**F — Review repeatedly fails** → may escalate to repair; the **historical evidence + `LEARNED` fact remain**,
while the **current competence projection may fall** (§5/§20/§41).
**G — Writing expectation requires productive evidence** → MC review alone cannot satisfy it (§17).
**H — AI unavailable** → objective review works; AI-dependent productive review `NOT_ASSESSED`/unavailable, no
fake score (§26).
**I — New checkpoint conflicts with old evidence** → do not erase history; current projection uses versioned
policy; a superseded *decision* ≠ deleted *evidence* (§30).
**J — Manual review before due** → allowed; only a meaningful attempt produces evidence (§37).
**K — Review interrupted/reloaded** → resume the same pinned session; no duplicate evidence (§38).
**L — Policy changes** → historical measurement stays interpretable via pinned derivation/expectation version
(§39).

## 45. Potential future persisted concepts

(Conceptual; no schema/names.) richer evidence metadata · evidence-kind · independence/scaffold · expectation
version · mastery-requirement (+version) · current mastery projection · retention/freshness projection · review
schedule/candidate state · review-policy version · misconception observation/history · point-mastery-evaluation
result.

## 46. Potential future schema / API changes (directional — not a migration)

Additive, nullable-first, A1-compatible:
- Enrich `SkillMeasurement` (kind/independence/expectation version) and `LearnerSkillState` (freshness/
  retention/assessmentState/misconception) — kept compact + recomputable.
- **Mastery Requirement** + **level-exit** + **review-scheduling** policies as versioned Methodist config.
- **Retention/freshness** projection separate from demonstrated mastery; per-evidence-kind aggregates.
- **Review candidate/schedule** state; productive-review session state; resumable pinning.
- **API (additive):** point-mastery evaluation; per-skill/expectation satisfaction; prioritized review
  candidates for Daily Plan; retention/freshness read. V1 endpoints keep working.

## 47. Acceptance criteria

1. **Historical evidence and historical acquisition facts never mutate**, while the **current competence
   projection is recomputable** and may move up/down with strong, relevant, repeated new evidence — no
   "once mastered, never decreases" (§5).
2. Demonstrated mastery ≠ freshness; both are exposed distinctly (§7/§21).
3. `LEARNED`/`MASTERED` can coexist with `REVIEW_DUE` **and** with `REPAIR_REQUIRED` when later evidence reveals
   a current gap (§7; Scenarios D/F; §41).
4. Repair ≠ review — distinct states/processes (§8).
5. One wrong ≠ weakness; one correct ≠ mastery (§9/§11; Scenario A/B).
6. Recognition ≠ production; production expectations need production evidence (§12/§17; Scenario G).
7. Hints/independence are recorded and matter (§18; Scenario C).
8. Review tasks vary surface context, never re-serve the identical item as proof (§16).
9. Review evidence is append-only; success/failure never rewrites `LearnerLessonCompletion` (§19; Scenario E).
10. Current projections remain recomputable and **versioned**; anchors don't erase evidence (§29/§30; Scenario
    I/L).
11. Placement/Roadmap/Teaching/DailyPlan boundaries preserved; no competing decisions (§34-36).
12. AI/media-dependent evidence is never faked — `NOT_ASSESSED`, not 0 (§26; Scenario H).
13. No fake psychometric precision (no "80% remembers") is invented (§21).

## 48. Open questions (deferred — direction given, no fake precision)

Exact mastery formula · retention/freshness algorithm · review-scheduling algorithm · interval policy ·
evidence weighting · conflict-resolution weighting · hint/scaffold weighting · weakness/misconception
activation thresholds · point-mastery thresholds · skill/point review-priority formula · merge/anchor semantics
· schema/table/enums · productive rubrics · AI/speech providers · reward policy for review.

Architectural direction is given inline (seven mastery dimensions; demonstrated-mastery vs retention/freshness
split (historical evidence/acquisition frozen, current competence recomputable); kind- and independence-aware
evidence; anchor-as-baseline not eraser; review-recall primarily feeds freshness and may also update current
competence when comparable; signals ≠ state ≠ evidence; versioned Methodist policy; reuse of append-only
`SkillMeasurement` + single-writer recompute + `LearnerReviewSession` + `LearnerSignal`). Numeric and
nomenclature choices remain owner/Methodist decisions.
