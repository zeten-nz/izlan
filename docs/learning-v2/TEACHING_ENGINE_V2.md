# Teaching Engine V2 — Specification

> **Status:** SPECIFICATION ONLY. No code, Prisma/schema, migration, endpoint, runtime, test, or deployment
> change is implied. V1 / CONTROLLED_RC keeps running unchanged.
>
> **Companions:** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md),
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md), [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md).
>
> **Grounding (verified against current code):** `ActivityType` enum (`schema.prisma:57-71`: TEXT, EXPLANATION,
> IMAGE, AUDIO, EXAMPLE, MINI_QUESTION, PRACTICE, SPEAKING, WRITING, LISTENING, AI_INTERACTION, MASTERY_TEST,
> VIDEO); `ActivityAttempt` (`learning.prisma:336`, pins `lessonRevisionId`, status `IN_PROGRESS|SUBMITTED|
> EVALUATED`, `answer` Json, `responseMediaAssetId`, `deterministicScore`); `LearningSession` (time/engagement,
> not a teaching lifecycle); `LearnerLessonCompletion` (`:400`, pinned revision, `masteryBestScore`);
> `src/lesson-execution/lesson-execution.service.ts` (presents the whole pinned activity list; only OBJECTIVE
> submittable; deterministic append-only attempts; no hints/remediation/branching);
> `src/lesson-execution/activity/objective-activity-payload.ts` (`lesson-activity-objective/v1`; formats
> **single_choice / multiple_choice / true_false** only); `src/content/activity/activity-registry.ts`
> (`executionKind` classification, TD-246); `deriveLessonMastery` (mean of best MASTERY_TEST scores, confidence
> hard-coded 10000). Accepted decisions cited D-xx (`docs/PRODUCT_DECISIONS.md`). **Exact schema/enum names are
> deferred** (owner instruction) — this fixes the *domain contract*, not identifiers.

---

## 1. Purpose

Make Izlan **teach**, not merely present-and-test. The Teaching Engine owns the **HOW** of a Roadmap Point: it
turns a Methodist-authored **Teaching Blueprint** into a taught session that explains a concept, checks
understanding early, diagnoses misunderstanding, re-explains differently, scaffolds practice from recognition to
production across skills, and emits rich evidence for mastery/review — degrading honestly when content, media,
or AI are unavailable.

Core principle: **if the learner does not understand, the product first questions whether the explanation,
example, sequence, or practice was sufficient.** A wrong answer is *evidence about what may not be understood*,
not merely a failure to record.

Conceptual teaching loop:
`TEACH → CHECK UNDERSTANDING → DIAGNOSE MISUNDERSTANDING → EXPLAIN DIFFERENTLY → GUIDED PRACTICE → INDEPENDENT
PRACTICE → APPLY IN SKILLS → MASTERY CHECK → REVIEW LATER.`

Today's runtime is the pattern to move beyond: the learner is handed the whole pinned activity list; only
objective (`single_choice`/`multiple_choice`/`true_false`) items are answerable; scoring is deterministic; there
is no check-early, no remediation, no hints, no productive/listening/reading/speaking execution, and no teaching
session lifecycle (§34).

## 2. Principles

1. **Teach, don't quiz.** Presentation + a final test is not teaching (§5-8).
2. **A wrong answer is diagnostic evidence** (D-04), not just a mark.
3. **Blame the material first.** Repeated cohort failure after a given explanation questions the *content*, not
   the learner (Content Quality, §25).
4. **Explain the why**, not just reveal the answer (§7/§16).
5. **Recognition ≠ production.** Choosing "She *is* a doctor" is not proof of producing "My sister is a
   student" (§17).
6. **Scaffold, then fade.** Hints exist to build independence, not to hand over answers (§19).
7. **Methodist/verified content is authority; AI assists within it** (D-05/D-13) — AI never invents rules,
   curriculum, taxonomy, or scores (§24/§27).
8. **Deterministic where possible** (D-12): objective scoring is deterministic and AI-independent; AI only
   where a rubric genuinely needs it.
9. **Reproducible teaching.** Sessions pin the blueprint revision; history is immutable (§28).
10. **Honest degradation.** No fabricated content, listening, or AI evaluation; sessions degrade truthfully
    (§29).
11. **Subject-agnostic.** English grammar is an *example* of depth, never hardcoded engine behavior (§30).

## 3. Definitions

| Term | Meaning |
|---|---|
| **Teaching Blueprint** | The versioned, Methodist-owned pedagogical design for a Roadmap Point — how it is taught (§4). |
| **Micro learning path** | The (blueprint-defined, branchable) sequence of teaching/practice steps within a point (§6). |
| **Teaching session** | One learner's pinned run through a point's blueprint, with state/evidence (§21). |
| **Activity** | A single teaching or practice unit (presentation, objective, productive, listening, reading, speaking, mastery). |
| **Check** | A small understanding probe interleaved right after a small concept (§5). |
| **Remediation** | The branch taken after a diagnosed (or suspected) misunderstanding (§18). |
| **Misconception** | A *diagnosed* likely cause of error — distinct from a single wrong answer (§6/§17). |
| **Evidence** | What a session emits for mastery/review: skill, evidence type, score, scaffold usage, misconception signal (§22/§25). |

## 4. Teaching Blueprint

A Roadmap Point (the pedagogical *what*, owned by the Roadmap Engine) resolves to a **versioned, published
Teaching Blueprint** (the *how*). Conceptually a blueprint carries (exact schema deferred, §36):
- learning outcomes / can-do statements; prerequisite knowledge; key concepts;
- **misconception catalogue** (linked to the Methodist mistake taxonomy, §6);
- explanation stages; **visual explanations with teaching semantics** (§8); rules; examples;
- guided practice; independent practice; writing / listening / reading / speaking work;
- mixed practice; **mastery requirements**; **remediation paths**; **review hooks**.

- **The blueprint is a distinct object, not merely a renamed `LessonRevision`.** Because a Roadmap Point ≠ a
  Lesson and a point may require **multiple** teaching/content pieces, the model is:
  `Roadmap Point → Teaching Blueprint → versioned Blueprint Revision → references/orchestrates approved teaching
  content, activities, media/assets, and/or existing immutable content revisions (e.g. one or more
  `LessonRevision`s).`
  A Blueprint Revision **composes and sequences** content; it is not one lesson's activity list.
- **Reuse, don't equate.** Today's `LessonRevision` already gives immutable, versioned, published content with
  an ordered `Activity[]` and `estimatedDurationMin` — valuable, and the implementation **may reuse or
  reference** it as one of the content revisions a blueprint orchestrates. But the architecture is **not**
  locked to `TeachingBlueprint == LessonRevision`; exact schema is deferred (§36).
- **Reproducibility invariant:** a teaching session pins the **exact published blueprint/content revision *set***
  it needs — the blueprint revision plus every content revision it references — so the whole taught experience
  is reproducible (§28).

## 5. Roadmap Point contract (input)

The Teaching Engine receives a **point + its pinned blueprint revision** from the Roadmap Engine and returns
outcome evidence. It reads (concepts): point identity, level, learning outcome, expected skills/domains,
mastery requirement, and the blueprint reference. It does **not** decide *which* point comes next, prerequisite
satisfaction, or validation — those are the Roadmap Engine's (`ROADMAP_ENGINE_V2.md` §5/§6). Hard boundary:
**Teaching owns HOW; Roadmap owns WHAT/WHEN.**

## 6. Micro learning path

A point normally has a pedagogically designed micro path, e.g. for *Present Simple*:
`motivation → concept → visual → simple rule → examples → check understanding → recognition practice →
sentence construction → controlled production → guided writing → listening → reading → speaking/pronunciation →
mixed real-context practice → mastery check → review hooks.`

- **Not a universal fixed sequence.** The **Methodist blueprint** defines the actual path per point/subject;
  the engine supports **conditional branches and remediation**, not one hardcoded order.
- Check-understanding steps are interleaved throughout (§5), not deferred to the end.
- Branches are **authored** (approved remediation paths); the runtime *selects* among them from evidence
  (§18/§20), it does not invent new steps.

## 7. Explanation model

A teaching explanation must be able to answer: **what** is this? **why** used? **when** used? **how** formed?
**common mistakes**? **how it differs** from similar concepts? can the learner **recognize** it? **produce** it?

- Depth example (illustration only — the engine does **not** hardcode English grammar):
  > BAD: "She uses *is*."
  > BETTER: "*She* means 'u' when talking about a girl or woman. With *to be*: I→am, he/she/it→is,
  > you/we/they→are. So: *She is a doctor.* ✓  *She are a doctor.* ✗"
- Explanations are **staged** (small pieces, each followed by a check, §5), not one large dump.
- Explanation content is authored/verified; AI may only *personalize the wording* of an approved explanation
  (§24), never change the rule.

## 8. Visual model

Visual teaching is **first-class**. The spec separates **content asset** from **teaching semantics**: the
engine must know *why* a visual exists, not merely that an image URL is attached.
- A visual carries a **semantic purpose** (illustrative concept, deferred enum): e.g. `TIME_CONTRAST` (a
  timeline for present/past/future), `SPATIAL` (prepositions diagram), `SEGMENTATION` (color-grouped sentence
  structure), `LABELLED_IMAGE` (vocabulary image+label+context), `STEP_SEQUENCE`, `COMPARISON_TABLE`.
- Kinds: diagrams, timelines, annotated images, comparison tables, cards, step sequences.
- **Current gap:** `ActivityType` has `IMAGE`/`AUDIO`/`VIDEO` and lesson media (alt-text) exist, but a visual is
  an *opaque asset* — there is no teaching-semantic annotation. This is NEW (§36). Assets remain fail-closed in
  production until the media adapter exists (§29).

## 9. Activity taxonomy V2

Current reality: `ActivityType` enum declares 13 coarse types, but the runtime only **executes objective**
activities (`activity-registry` `executionKind = OBJECTIVE`), and objective **formats** are only
`single_choice`/`multiple_choice`/`true_false` (`lesson-activity-objective/v1`). Presentation types
(TEXT/EXPLANATION/EXAMPLE/IMAGE/AUDIO) render only; SPEAKING/WRITING/LISTENING/AI_INTERACTION/VIDEO are declared
but **not executable**. V2 defines a richer **format** taxonomy beneath the coarse types, each classified for
rollout:

| Category | Formats (concepts) | Classification |
|---|---|---|
| **Teaching / presentation** | explanation · concept card · example · comparison · visual explanation · audio model | foundation (visual/audio **require media**) |
| **Objective practice** | single/multiple choice · true-false | **foundation (exists today)** |
| | gap-fill · matching · sentence/word reorder · categorization · select-in-context | **NEW formats** (deterministic; foundation-next) |
| **Productive** | typed short answer · sentence construction · translation · guided paragraph · free writing | **require AI** (rubric) beyond simple exact-match; typed-exact is foundation |
| **Listening** | listen+choose · listen+identify · transcript gap · dictation · comprehension | **require media** (+ some AI) |
| **Reading** | passage+question · sequencing · main idea · detail · vocabulary-in-context · inference | foundation-to-later (objective-scored) |
| **Speaking** | listen-and-repeat · read aloud · pronunciation repeat · shadowing · prompted response · picture description · role-play | **require speech infra (STT/TTS)** + AI |
| **Mastery** | mixed-skill check · cumulative check | foundation (objective) → later (multi-evidence) |

Classification legend: **foundation** (implementable deterministically now), **later**, **requires media**
(object-store adapter), **requires AI** (provider), **requires speech infra** (STT/TTS). Not all are first
implementation; exact DB enum names deferred (§38).

## 10. Practice progression

Practice moves from easier recognition to real production:
`recognize → select → match → reorder → complete → construct → translate (where pedagogically useful) → produce
independently → apply in context.`
- **Not every concept goes through every format** — the Methodist blueprint decides required formats per point
  (§15).
- Progression is **level/skill-aware**, driven by the blueprint, not a global counter.

## 11. Writing ladder

Writing must **not** start at "write an essay." A level/skill-aware ladder (concepts, not a global numeric
gimmick):
`0 reorder words into a sentence · 1 complete a missing word · 2 copy/transform a model sentence · 3 short
L1→L2 translation · 4 guided sentence with prompts · 5 combine sentences · 6 guided 3–5 sentence paragraph ·
7 short message/email/letter · 8 independent paragraph · 9 structured opinion/essay · 10 advanced B2–C2 (target
vocabulary, connectors, register, argument structure, constraints).`
- The learner should gradually realize *"I just wrote a paragraph/letter"* without being thrown into it.
- Rungs map to level + skill expectation (per the point's blueprint), not a universal index. Lower rungs are
  deterministically scorable (reorder, gap, exact translation); higher rungs **require AI rubric** (§24). No
  fake scoring (§23).

## 12. Listening ladder

`listen to a word · distinguish similar words · short sentence → choose exact meaning · choose what was said ·
transcript gap · short dictation · dialogue main idea · dialogue specific detail · infer intent/emotion ·
longer natural-speed listening · advanced C1–C2 nuance.`
- For beginners, instruction/questions may be in the support language (Uzbek), moving toward target-language-
  only where appropriate (§16).
- **"Audio played" is not evidence of listening skill** — evidence comes from the comprehension response.
- **Requires media** (object-store adapter); until then, listening degrades to "not available" (§29), never
  faked.

## 13. Reading ladder

`word/phrase · simple sentence · 3–5 sentence micro-text · short graded story · short article · dialogue ·
practical real-world text · longer article · argument/opinion · literature/academic.`
Question dimensions: explicit fact · main idea · sequence · vocabulary-from-context · reference/pronoun
resolution · inference · author's purpose · tone/opinion.
- **Library integration (downstream, not here):** after reading mastery/analysis, Izlan *may* recommend graded
  reading/books. The Smart Library is a separate future integration — Teaching Engine only emits the evidence;
  it does not implement Library.

## 14. Speaking / pronunciation ladder

`hear word · repeat word · hear sentence · repeat sentence · read aloud · shadowing · answer a simple prompt ·
describe an image · structured dialogue · role-play · free response · discussion/debate.`
- **Future mode — dubbing:** an original character speaks a line; the learner performs it. Treat as **FUTURE**
  unless scope supports it.
- **Product principle:** pronunciation drills + AI speaking evaluation are useful but **do not fully replace
  real human communication**; community-based speaking practice is a recognized **later high-value extension** —
  **Community is NOT a dependency** of Teaching Engine V2.
- **Requires speech infrastructure** (STT/TTS) + AI; degrades honestly until available (§29).

## 15. Skill integration

A grammar point is not only grammar multiple-choice. *Present Simple* integrates: theory (usage/form), writing
("I go to school every day."), listening (recognize routine statements), reading (a daily-routine passage),
speaking (describe your routine).
- The blueprint can **connect the central concept to multiple domains/skills**; evidence attributes to the
  right skills via `ActivitySkill`/`LessonSkill` (reused).
- **Not every point must contain every skill** — Methodist defines pedagogically appropriate coverage.

## 16. Feedback model

- **Correct:** brief confirmation; useful reinforcement where appropriate; **do not over-explain** trivial
  correct answers.
- **Incorrect:** identify the issue where evidence permits; explain **why**; contrast wrong vs correct; offer
  rule/example; **immediate re-check** (§18).
- **Partially correct** (productive): rubric feedback (future, AI).
- **No fake certainty.** If the cause is unknown, behave as *"we need another example to see what's causing the
  difficulty"* — do **not** invent a misconception (§17/§23).
- **Language of feedback/explanation** (§ concept): distinguish **instruction language**, **target language**,
  **support language**. Beginners may get support-language (Uzbek) explanation; target-language exposure
  increases progressively. Not hardcoded (multi-language, multi-subject); exact transition policy **open**.

## 17. Mistake diagnosis

- **Methodist/verified-content owns the canonical mistake taxonomy** (decision carried from placement/roadmap).
  AI may **classify** an error into an *approved* category and personalize the explanation; AI may **not**
  silently invent new canonical categories. (`LearnerSignal.categoryCode` already references a taxonomy
  registry — reuse.)
- A wrong answer is classified (where evidence permits) into concepts such as: rule misunderstanding · concept
  confusion · vocabulary gap · prerequisite gap · form/structure error · meaning/comprehension error ·
  attention/slip · pronunciation issue · **insufficient evidence / unknown cause**.
- **Wrong answer ≠ diagnosed misconception.** One wrong answer is often not enough to declare a misconception;
  diagnosis needs enough evidence (repeated same-type error). This mirrors placement's coverage-vs-certainty
  distinction.
- Exact initial taxonomy **contents** remain open (a content-authoring task).

## 18. Remediation

On an incorrect answer, **never** just *show answer → next*. Conceptual flow:
`wrong answer → inspect response + skill + known misconception patterns → identify likely cause (where evidence
permits) → targeted explanation/hint → simpler or contrasting example → re-check the SAME idea in a DIFFERENT
example → continue only if understanding improves.`
- **Do not immediately repeat the identical question.** Re-check uses a *different* example (§27).
- Remediation branches are **authored** (approved paths in the blueprint); runtime selects among them from
  evidence — it does not fabricate drills.
- Worked micro-example (illustrative): *"She ___ a doctor." → learner: "are"* → teach the *to be* rule with a
  contrasting example → re-check with *"My sister ___ a student. [am][is][are]"* (§27).

## 19. Hint / scaffolding

A conceptual **hint ladder** (illustrative levels): `0 no help · 1 small clue · 2 highlight the relevant rule ·
3 show a similar worked example · 4 partially complete the task · 5 fully explain, then require a NEW example.`
- **Fade scaffolding** as the learner improves; **avoid learned helplessness** where every task instantly
  reveals the answer.
- **Hint usage is recorded as evidence** and **weakens the mastery strength** of that answer (§17/§22): an
  answer reached at hint level 4 is weaker evidence than an unaided one.

## 20. Session adaptation

Two learners entering the same point may not need the same session: a fast learner gets fewer recognition
reps and quicker production; a struggling learner gets more examples, remediation, and guided practice.
- **The blueprint stays canonical/Methodist-controlled.** Runtime adaptation operates **inside approved
  branches/rules** only.
- **AI cannot invent random curriculum**; it may *select* among approved branches or personalize wording (§24).
- Adaptation must be **reproducible/auditable** enough for support/debugging (record which branch and why).

## 21. Session lifecycle / state

A teaching session needs a lifecycle richer than today's `LearnerLessonProgress` (`IN_PROGRESS|COMPLETED` +
`lastActivityId`). Conceptual phases (may be multi-dimensional rather than one enum):
`NOT_STARTED → TEACHING → PRACTICING → REMEDIATING → MASTERY_CHECK → COMPLETED.`
It must persist enough to support **refresh/resume without generating a new lesson**:
- current step / position in the micro path; presented activities; learner responses (append-only attempts);
- **hints used**; **remediation branch** taken; evidence produced; completion; **pinned blueprint/revision**.
- **Reload must resume the same pinned session** (today's runtime already pins the revision and resumes; V2
  extends the persisted state to include step/hints/branch). **Current gap:** no session-state model beyond
  progress + `LearningSession` time-tracking — NEW (§36).

**Session completion ≠ point mastery.** Reaching the end of a teaching session is a **session fact**; it does
**not** by itself mean the Roadmap Point is **learned/mastered**. These are different layers:
- *Finishing the presented activities* is a `TeachingSession = completed` historical fact (durable, immutable).
- *Learning/mastery* is an **evidence/policy decision** made from the emitted evidence (§22/§23) — it is **not**
  implied by session completion.
- **Ownership:** the **Teaching Engine emits evidence**; **Mastery/Review** logic decides whether the point's
  mastery requirement is satisfied; the **Roadmap Engine owns the durable point acquisition state**
  (`LEARNED`/`VALIDATED`/`REPAIR_REQUIRED`, `ROADMAP_ENGINE_V2.md` §12).
- Worked case (§31.N / Scenario C): a learner reaches the end of the *Present Simple* session with **recognition
  strong but production weak** and the mastery requirement unmet → the session is historically `completed`, yet
  the point's Acquisition is **not-yet-learned** and Attention is **`REPAIR_REQUIRED`** (or the equivalent future
  model). **Failed mastery produces repair without erasing the completed session.** (Enum names deferred.)
- This is the teaching-side mirror of `VALIDATED_BY_ASSESSMENT ≠ COMPLETED_BY_LEARNING` (Roadmap §10/§11):
  neither *validation* nor *session completion* is the same as *demonstrated mastery*.

## 22. Evidence semantics

Every teaching interaction emits evidence (append-only, reused `ActivityAttempt` substrate + a richer evidence
projection). Conceptually per interaction: **skill(s) practiced**, **evidence type** (recognition vs
production, §17), **score/result**, **scaffold/hint usage**, **misconception signal** (category, when
diagnosed), **mastery evidence**, **completion evidence**.
- Objective evidence stays **deterministic** (`deterministicScore`, existing). Productive/speaking evidence is
  **rubric/AI** (`ActivityAttempt.status = EVALUATED`, `AiEvaluation` model already exists — reuse).
- Evidence carries provenance (which activity/session/blueprint revision), so mastery and review are traceable.

## 23. Mastery handoff

- **Recognition ≠ production** (§17): mastery of a point should be supported by **multiple forms of evidence
  where the skill warrants it** — an objective correct answer alone is weak evidence of production.
- Teaching emits mastery evidence; the **Mastery/Review engine** (single-writer merge, `LESSON_MASTERY`
  source) folds it into `LearnerSkillState`. Today `deriveLessonMastery` = mean of best `MASTERY_TEST` scores
  with `confidenceBp` hard-coded to `10000` — V2 must make mastery **evidence-type-aware** (recognition vs
  production weighting) rather than treat one MC as full confidence.
- **Do not design the final mastery formula here** — define the evidence *principle*; the formula is deferred
  (§38) and lives with the Mastery engine.

## 24. AI boundary

**AI may:** classify mistakes into the approved taxonomy · personalize the wording of an *approved* explanation
· evaluate productive writing/speaking under a **structured rubric** · select/remix *approved* examples ·
suggest a remediation branch (from approved branches).
**AI must NOT:** silently change canonical rules · invent curriculum requirements · invent mistake-taxonomy
categories · fabricate a score · override deterministic scoring for objective items · publish content without
review · browse arbitrary sources at runtime and treat them as authority.
- **Graceful degradation (precise rule).** The **deterministic/published portion** of teaching remains
  functional without AI — objective practice, authored explanations/examples/remediation branches, and
  objective mastery checks all work; **AI-independent teaching must not depend on AI availability.** But any
  capability whose evaluation *genuinely requires* AI, speech, or media infrastructure **degrades honestly** —
  it does **not** claim the deterministic core covers it:
  - free-writing evaluation unavailable → `NOT_ASSESSED` / temporarily unavailable;
  - speaking evaluation unavailable → `NOT_ASSESSED` / temporarily unavailable;
  - listening media unavailable → listening evidence is **not produced**.
  Never convert unavailable/`NOT_ASSESSED` into 0; never award fake mastery or fake completion for that
  skill/domain; never claim the learner demonstrated productive ability. An **approved Methodist-authored
  deterministic fallback** may substitute **only where one explicitly exists**. In short: AI-dependent
  assessment must not be faked. (Scenario E/F.)

## 25. Content quality system

Izlan aims for **strong teaching explanations**. Authoring conceptually follows:
`research → source/reference collection → instructional synthesis → examples → visuals → exercises →
misconception review → Methodist review → publish.`
- Internet research may inform **authoring**, but: don't copy random sites, don't trust one source blindly,
  don't plagiarize, **don't let raw AI output become authoritative content**; verified/published content is the
  authority (D-05).
- For English, authoring should be informed by strong grammar/ELT/CEFR sources and reputable instructional
  references.
- **Separate AUTHORING RESEARCH from RUNTIME TEACHING:** the runtime must **not** browse the web per learner
  question by default (§24).
- **Content Quality feedback loop:** per-item/per-explanation miss rates flag weak *content* for Methodist
  review (principle #3; `LEARNING_SYSTEM_V2.md` §2.6) — the material is questioned before the learner is blamed.

## 26. Authoring / research boundary

- **Authoring time:** research-assisted, source-referenced, Methodist-reviewed, versioned, published. Provenance
  (`ContentSource` HUMAN/AI_ASSISTED/…, existing) recorded; AI-assisted content still requires human review
  before publish (existing TD-20 rule).
- **Runtime time:** serves only **published** blueprint revisions; no arbitrary web access; AI operates only
  within the approved blueprint/taxonomy/rubric.

## 27. Content quality checklist (publish-readiness — conceptual)

For a teaching point, check: clear learning outcome · correct theory · learner-appropriate language · ≥1 clear
example · misconception coverage · visual where pedagogically useful · understanding check · guided practice ·
independent evidence · mastery check · correct skill mappings · accessibility · no unsupported/fabricated claims
· references/provenance where required. (Do not implement the checker yet — this extends the existing
publication-readiness pattern, `content-authoring/publish/publication-readiness.service.ts`.)

## 28. Versioning / immutability

- **Pin the blueprint/content revision *set* per session.** A learner who started on blueprint/revision **v3**
  (and the specific content revisions it referenced) must **not** silently switch to **v4** mid-session; new
  learners get v4 after publication. (Today's `LessonExecutionService` already pins `lessonRevisionId` at first
  start and never repins — the same discipline generalizes to the blueprint's orchestrated revision set.)
- **Immutable historical evidence:** responses/attempts and completions pin the revision they ran under
  (`ActivityAttempt.lessonRevisionId`, `LearnerLessonCompletion.lessonRevisionId` — kept forever, L-14).
- Define: canonical point → published teaching **blueprint revision + the content-revision set it orchestrates**
  → learner session pinned to that set → immutable historical response/evidence. Exact schema deferred (§36).

## 29. Content / media / AI unavailable behavior

- **Missing teaching content** for a point → the point is `CONTENT_UNAVAILABLE` (Roadmap §21); the Teaching
  Engine does not fabricate or substitute.
- **Listening/speaking media unavailable** (production media adapter is fail-closed today) → those activities
  are "not available"; the session **does not fabricate listening/speaking completion** and does not count them
  as evidence — it degrades honestly (Scenario F).
- **AI unavailable** → the deterministic/published portion still works; AI-dependent evidence marked
  `NOT_ASSESSED`, never faked (Scenario E, §24).
- **Invariant across all three:** never convert unavailable/`NOT_ASSESSED` into 0; never award fake mastery or
  fake completion for that skill/domain; never claim demonstrated productive ability. A Methodist-authored
  deterministic fallback substitutes **only where one explicitly exists**.
- **No corrupted progress/evidence** from any unavailability.

## 30. Multi-subject compatibility

The engine is subject-agnostic. English grammar explanations (Present Simple, *to be*) are **examples of depth**,
not built-in behavior. Blueprints, explanation stages, visual semantics, activity formats, ladders, and
taxonomies are **authored per subject**; a Math or History point uses the same engine with its own blueprints
and formats. No English/CEFR grammar is encoded in the engine core.

## 31. Present Simple — worked example

**Roadmap Point:** *Present Simple — habits, routines and general truths.*

- **A. Motivation/context.** "I go to school every day." Present Simple describes **routines/habits, repeated
  actions, facts/general truths** — **not** "the tense for exactly what is happening right now" (brief contrast
  with present continuous where useful).
- **B. Visual concept** (`VISUAL_PURPOSE = TIME_CONTRAST`): a weekly timeline — `MON TUE WED THU FRI  ● ● ● ● ●`
  — "I go to school every day."
- **C. Rule.** `I/You/We/They → work`, `He/She/It → works`.
- **D. Examples.** *I live in Tashkent. She lives in Tashkent. They play football. He plays football.*
- **E. Early check.** *"She ___ to school every day. [go] [goes]"* (interleaved right after the rule, §5).
- **F. Wrong-answer remediation.** If the learner picks *go*: explain third-person singular *-s*; show another
  example; **re-check with a DIFFERENT sentence** (not the same one, §18).
- **G. Sentence reorder** (objective NEW format): `[every] [I] [day] [study] [English]`.
- **H. Guided construction.** Prompt `"My brother / work / bank"` → learner forms *"My brother works in a
  bank."*
- **I. Writing ladder** (§11): controlled *"I ___ every morning."* → guided *"Write one sentence about
  something you do every day."* → later *"Write 3–5 sentences about your daily routine."*
- **J. Listening** (requires media): audio *"I get up at seven and go to work at eight."* → beginner *"What time
  does the speaker get up?"* → later transcript-gap / detail comprehension.
- **K. Reading:** short daily-routine paragraph → main idea / explicit fact / sequence question.
- **L. Speaking** (requires speech infra): listen-and-repeat → *"Tell us one thing you do every morning."*
- **M. Mixed practice:** use the grammar in a real mini-context.
- **N. Mastery:** **not one MC question** — combines **recognition** (choose the correct form) **and
  production** (construct/write a routine sentence) evidence (§17/§23).

## 32. "To be" error — worked example

Prompt: *"She ___ a doctor."* learner chooses **are**.
- **BAD:** "She uses *is*."
- **GOOD remediation:** *"She means 'u' when we talk about a girl or woman. For *to be*: I→am, he/she/it→is,
  you/we/they→are. So: **She is a doctor.**"*
- **Re-check with a DIFFERENT example:** *"My sister ___ a student. [am] [is] [are]"* — a new example is used so
  the learner **applies** the rule rather than pattern-matching the same item (§18).

## 33. Scenarios

**A — Understands immediately.** Learner answers early checks correctly → teaching path **shortens safely**
(fewer recognition reps, faster to production); mastery still requires production evidence (§20/§23).

**B — Repeated same-distinction confusion.** Learner repeatedly confuses is/are → after enough evidence a
**misconception is diagnosed** (§17) → **targeted remediation branch** activates (extra examples, contrast,
guided practice) (§18).

**C — MC-correct but can't construct.** Learner picks the right option but fails sentence construction →
**productive evidence prevents false mastery**; the point is not mastered on recognition alone (§17/§23).

**D — Needs several hints.** Learner reaches the answer only after hints → result records **scaffold usage**;
mastery evidence is **weaker** than an unaided answer (§19).

**E — AI unavailable.** The **deterministic/published portion** of the lesson remains functional; AI-personalized
wording + productive/speaking rubric evaluation pause; those dimensions are `NOT_ASSESSED` (never 0, never fake
mastery/completion, never a claim of productive ability) (§24/§29).

**F — Listening media unavailable.** Listening activities show "not available"; the session **does not fabricate
listening completion** and does not count it as evidence — honest degradation (§29).

**G — Revision pin.** Learner starts blueprint **v3**; Methodist publishes **v4**; the existing session stays
pinned to **v3**; new learners get **v4** (§28).

**H — Content fix after the fact.** A wrong/unclear explanation is discovered → a **new revision** fixes future
learners; the historical session stays reproducible on its pinned revision, and its evidence is unchanged (§28);
the Content Quality loop flagged it (§25).

## 34. V1 reuse / gap analysis

**Why the current A1 pattern is insufficient.** Today a lesson = `TEXT/EXPLANATION/EXAMPLE` presentation +
mostly `single_choice` `MINI_QUESTION`/`PRACTICE` + a `MASTERY_TEST`, delivered as **the whole activity list at
once**, with **only objective activities answerable** and **deterministic score → next**. It cannot: check
understanding *early* and branch; **diagnose misconceptions**; **remediate** (it shows nothing but a score);
offer **hints/scaffolding**; run **productive/listening/reading/speaking** practice (types declared but not
executable; formats limited to single/multiple/true-false); represent **visual teaching semantics**; or
distinguish **recognition from production** evidence (mastery = mean of best MC). It is present-and-test, which
is exactly what V2 rejects.

| Component | Verdict | Notes |
|---|---|---|
| `Lesson` | **REUSE (rescope)** | content container; a Roadmap **Point** may span lessons (§4). |
| **Teaching Blueprint / Blueprint Revision** (point-level: stages, misconceptions, remediation branches, multi-skill, orchestrated content) | **NEW** | a distinct object that *references/orchestrates* content revisions; **not** a renamed `LessonRevision` (§4). |
| `LessonRevision` (immutable, versioned, `Activity[]`, `estimatedDurationMin`) | **REUSE / REFERENCE** | keep its immutability/versioning/pinning; it may be **one of** the content revisions a blueprint orchestrates — not the blueprint itself. |
| `Activity` (`ActivityType` enum + `payload`) | **EXTEND** | coarse types largely exist; add **format taxonomy** (§9), visual semantics (§8), productive/listening/reading/speaking payloads. |
| `activity-registry` (`executionKind`) | **EXTEND** | add non-objective execution kinds (productive/rubric/media/speech). |
| Objective payload (`single/multiple/true_false`) | **REUSE + EXTEND** | keep; add gap-fill/matching/reorder/categorization/select-in-context (still deterministic). |
| Objective scoring (deterministic bp) | **REUSE** | for objective; **NEW** rubric/AI path for productive/speaking (`AiEvaluation` exists). |
| `ActivitySkill` / `LessonSkill` | **REUSE** | skill attribution for multi-skill evidence. |
| `ActivityAttempt` (pins revision, `EVALUATED`, `responseMediaAssetId`) | **REUSE + EXTEND** | append-only evidence; already anticipates productive/AI/media; add hint/scaffold + evidence-type + misconception fields (§22). |
| `LearnerLessonProgress` / `LearningSession` | **EXTEND / NEW** | progress is `IN_PROGRESS/COMPLETED` + `lastActivityId`; a **teaching-session lifecycle** (step/hints/branch/evidence) is NEW (§21). |
| `LearnerLessonCompletion` (`masteryBestScore`) | **REUSE** | completion authority; must reflect multi-evidence mastery, not one MC. |
| `deriveLessonMastery` (mean best MASTERY_TEST, confidence=10000) | **EXTEND** | make **evidence-type-aware** (recognition vs production); stop treating one MC as full confidence (§23). |
| Content authoring workflow (DRAFT→REVIEW→PUBLISHED, OCC, audit, `publication-readiness`) | **REUSE + EXTEND** | add blueprint richness + content-quality checklist (§27). |
| Immutable revision publication / pinning | **REUSE** | exactly the reproducibility V2 needs (§28). |
| Review integration (`review-session`, `REVIEW_MASTERY`, `LearnerSignal`) | **REUSE** | Teaching emits evidence; Review engine owns timing; `categoryCode` reuses the mistake taxonomy (§17/§25). |
| A1 pilot activity formats | **REPLACE (evolve)** | present-and-test A1 becomes a taught blueprint; A1 content re-authored toward the micro path over time. |

## 35. Potential future persisted concepts

Blueprint (versioned, per point) + its stages/misconceptions/remediation branches/visual semantics; teaching
**session state** (step, presented activities, hints used, remediation branch, pinned revision); richer
**evidence** (evidence type, scaffold usage, misconception category) on attempts; media assets with **teaching
semantics**; AI evaluation results for productive/speaking (`AiEvaluation` exists). Durable/immutable:
attempts, completions, evidence — pinned to the blueprint revision.

## 36. Potential future schema / API changes (directional — not a migration)

Additive, nullable-first, A1-compatible:
- **Blueprint** structure (stages/misconceptions/remediation/visual-semantics) as a **distinct, versioned
  blueprint entity that references/orchestrates content revisions** (it may reference one or more
  `LessonRevision`s) — not a renamed `LessonRevision` (§4).
- **Activity format taxonomy** + payload contracts for productive/listening/reading/speaking; visual-semantic
  annotation on media.
- **Teaching session state** model (step/hints/branch/evidence) beyond `LearnerLessonProgress`.
- **Evidence** fields on `ActivityAttempt` (evidence type, scaffold usage, misconception category).
- **Mistake taxonomy** registry (Methodist-owned) + rubric definitions for productive/speaking.
- **API (additive):** step-wise teaching flow (present step → check → remediate → next), hint request, submit
  productive/speaking, resume pinned session; V1's whole-list execution keeps working for A1.

## 37. Acceptance criteria

1. A point is taught via a **pinned blueprint revision** with interleaved **early checks**, not a whole-list
   dump; reload resumes the same pinned session (§21/§28).
2. A wrong answer triggers **remediation** (explain-why + contrasting example + re-check with a **different**
   example), never bare "show answer → next" (§18; Scenario B).
3. **Recognition and production** evidence are distinct; mastery is **not** granted on one MC where production
   is warranted (§17/§23; Scenario C).
4. **Hints** are laddered and recorded; scaffolded answers are **weaker evidence** than unaided (§19; Scenario
   D).
5. **Objective scoring stays deterministic**; productive/speaking use rubric/AI and mark "not assessed" when AI
   is unavailable — never faked (§22/§24; Scenario E).
6. **Media/AI unavailability degrades honestly** — no fabricated listening/speaking completion or evidence
   (§29; Scenario F).
7. **Blueprint revision is pinned**; publishing a new revision does not alter in-flight sessions; historical
   evidence is reproducible (§28; Scenarios G/H).
8. **Methodist/verified content is authority**; AI classifies/personalizes/evaluates only within approved
   taxonomy/rubric/branches and never invents rules, curriculum, taxonomy, or scores (§24).
9. **Subject-agnostic:** no English grammar hardcoded in the engine; blueprints drive behavior (§30).
10. **No V1 regression:** the current A1 whole-list objective execution behaves identically until content is
    re-authored to the blueprint.
11. **Session completion is not point mastery:** finishing a session records a session fact only; the point is
    marked learned/mastered by evidence/policy (Mastery/Review → Roadmap acquisition), and failed mastery yields
    repair **without erasing** the completed session (§21; Scenario C). The pinned artifact is the blueprint +
    its **content-revision set** (§4/§28), not a single lesson revision.

## 38. Open questions (deferred — direction given, no fake precision)

- Exact activity DB enum/schema and payload contracts per format.
- Exact mastery formula (recognition vs production weighting).
- Exact hint penalty/weight on evidence.
- Exact productive-writing and speaking rubrics.
- Exact speaking scoring provider · STT/TTS provider · AI provider/model.
- Exact language-transition policy (support→target language).
- Exact activity counts per point / required formats per level.
- Exact session-adaptation thresholds (when to shorten/remediate).
- Exact mistake-taxonomy contents (Methodist-authored).

Architectural direction is given inline (blueprint = versioned richer revision; teaching-session state; three
evidence dimensions incl. recognition-vs-production and scaffold usage; authored remediation branches;
deterministic-core + AI-within-constraints; reuse of `ActivityAttempt`/`AiEvaluation`/`LessonRevision` pinning/
`LearnerSignal` taxonomy). Numeric/nomenclature choices remain owner/Methodist decisions.
