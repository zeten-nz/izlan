# Content Quality System V2 — Specification

> **Status:** SPECIFICATION ONLY. No code, Prisma/schema, migration, endpoint, runtime, test, or deployment
> change is implied. V1 / CONTROLLED_RC keeps running unchanged. **Architecture/specification complete ≠ V2
> implemented.**
>
> **Companions (all five prior engines):** [`LEARNING_SYSTEM_V2.md`](./LEARNING_SYSTEM_V2.md),
> [`PLACEMENT_ENGINE_V2.md`](./PLACEMENT_ENGINE_V2.md), [`ROADMAP_ENGINE_V2.md`](./ROADMAP_ENGINE_V2.md),
> [`TEACHING_ENGINE_V2.md`](./TEACHING_ENGINE_V2.md), [`SKILLS_ENGINE_V2.md`](./SKILLS_ENGINE_V2.md),
> [`MASTERY_REVIEW_ENGINE_V2.md`](./MASTERY_REVIEW_ENGINE_V2.md).
>
> **Grounding (verified against current code):** `PublicationReadinessService.evaluate`
> (`src/content-authoring/publish/publication-readiness.service.ts`: **purely structural** blockers/warnings —
> activity presence/positions/payload-validity/type-support, archived skills, unpublished hierarchy/prereqs,
> media processing/moderation/mime, pointer coherence; **no** factual/pedagogical/alignment/mastery checks);
> permissions `content.author` (needs active `SubjectAssignment`), `content.publish`, `content.subject.manage`
> (`content-authoring.constants.ts`; separate author vs publish, no author≠approver enforcement); `ContentSource`
> = HUMAN / AI_GENERATED / AI_ASSISTED (`schema.prisma:74`, TD-20 "no AI publish without review");
> `RevisionStatus` DRAFT→REVIEW→PUBLISHED→ARCHIVED; `StaffAudit` on every mutation (`content-audit.repository`);
> media processing/moderation status (`MediaProcessingStatus`/`MediaModerationStatus`, TD-74); A1 pilot
> `provenanceSource = AI_ASSISTED` (methodist review pending). Accepted decisions cited D-xx. **Exact
> schema/enum/formulas deferred** (owner).

---

## 1. Purpose

The Content Quality System governs how Izlan's teaching content becomes trustworthy: `research → source
collection → instructional synthesis → skill/outcome alignment → explanation/examples/visuals/exercises →
misconception & assessment quality → accessibility/localization → automated validation → human review →
publication → post-publication quality feedback → revision/correction`. It makes content quality a **first-class
product system**, not proofreading before publish.

**Core principle:** Izlan must not assume *"the learner got it wrong, therefore the learner is the problem."* It
must also ask whether the **explanation, sequence, example, prerequisite assumption, question, exercise,
visual, translation, or fact** was the problem.

It does **not** own: learner placement decisions, roadmap projection, runtime Teaching adaptation, the mastery
formula, or review scheduling — it governs the **content** those engines consume.

## 2. Principles

1. **Content quality is first-class**, not proofreading.
2. **Factual correctness and pedagogical quality are separate concerns** (§9) — a beautiful lesson with wrong
   theory must not pass.
3. **Automated validity ≠ human pedagogical approval** (§28) — structure passing is necessary, not sufficient.
4. **Hard blockers override aggregate scores** (§10).
5. **Methodist/verified content is the authority; AI assists and never self-publishes** (§2/§29; TD-20).
6. **Authoring research ≠ runtime web authority** (§5).
7. **Original synthesis, not copying** (§8).
8. **Alignment is checked** — outcome ↔ skills ↔ blueprint ↔ activities ↔ evidence ↔ Mastery Requirement
   (§12/§18/§20).
9. **Recognition-only content cannot satisfy production requirements; missing media never fakes evidence**
   (§20/§23).
10. **Learner errors may indicate content problems**; quality signals **trigger review**, never auto-edit
    content (§38/§39/§42-45).
11. **Published revisions are immutable/reproducible; corrections preserve history** (§34/§35).
12. **Multi-subject architecture** — generic engine, subject-specific quality policies (§47).

## 3. Definitions

| Term | Meaning |
|---|---|
| **Content Brief** | The pre-draft specification of what a point's content must achieve (§11). |
| **Source / research reference** | External material used during authoring, with provenance (§6/§7). |
| **Canonical content** | Izlan's reviewed teaching synthesis (Methodist authority). |
| **Generated assistance** | AI draft/suggestion — **not** authoritative until approved (§2/§29). |
| **Published revision** | Human-approved, immutable, reproducible content revision (§34). |
| **Hard blocker** | A defect that blocks publication regardless of other quality (§10). |
| **Quality signal** | A post-publication indication that content *may* need review — not proof (§37-45). |
| **Quality policy version** | The versioned rule set a revision passed at publication (§48). |
| **Evidence admissibility** | A *current* judgement of whether historical evidence can still be relied on for a decision — distinct from the (frozen) historical fact (§35a). |

## 4. Authority model

Four conceptual authority layers (schema names deferred; reuse `ContentSource`):
- **A. Source / reference evidence** — external authoritative/reputable material used while authoring.
- **B. Canonical pedagogical content** — Izlan's reviewed teaching interpretation/synthesis (authority).
- **C. Generated assistance** — AI draft/example/suggestion **not yet** authoritative (`AI_GENERATED`/
  `AI_ASSISTED`).
- **D. Published content** — human-approved, immutable, reproducible revision (authority at runtime).
**AI may assist; AI is not the authority.** TD-20 ("no AI publish without review") is the V1 seed of this rule —
reuse and enforce it (§27/§29).

## 5. Authoring research boundary

- **Authoring research** may use reputable web resources, books, official standards, academic/professional
  references, dictionaries, trusted instructional material.
- **Runtime teaching** must **not** browse arbitrary internet sources per learner interaction and treat them as
  authoritative — the **published content is the runtime authority**, and runtime AI operates only inside the
  Teaching spec's approved boundaries (`TEACHING_ENGINE_V2.md` §24/§25).

## 6. Source quality

Not all sources are equal. Conceptual source-evaluation dimensions: **authority · subject expertise · primary
vs secondary · currency/version · pedagogical relevance · consistency with other reputable references ·
licensing/copyright usability · traceability.** **No single universal source list across subjects** — English
(reputable grammar/ELT references, dictionaries, verified CEFR/descriptor sources), History (primary sources,
academic works, reputable archives), Science (textbooks, peer-reviewed/official sources) each need their own
hierarchy. Exact approved-source policy open.

## 7. Research provenance

Conceptual provenance for authoring research (schema deferred): source title · type · publisher/author ·
URL/reference id · edition/version · access/retrieval date · notes · claims/sections informed · license/usage
constraints. **Published content should remain traceable to the research basis used at publication time where
required** (important factual/rule/standards claims especially).

## 8. Copyright / original synthesis

Research is **not** permission to copy. Izlan content is an **original pedagogical synthesis**: do not copy long
passages, do not reproduce proprietary exercises without rights, do not blindly paraphrase a single source;
create original explanations/examples/exercises; record attribution/license where required; use
public-domain/licensed assets per their terms. (Product architecture + authoring discipline — not legal
advice.)

## 9. Quality dimensions

Content quality is **multi-dimensional** — do **not** reduce it to one naive weighted score:
**A** factual/subject accuracy · **B** pedagogical quality · **C** skill alignment · **D** assessment validity ·
**E** language/clarity · **F** example quality · **G** misconception coverage · **H** media/visual quality ·
**I** accessibility · **J** localization quality · **K** technical integrity · **L** source/provenance quality.
(V1 readiness covers only parts of **K**; A-J, L are new — §59.)

## 10. Hard blockers vs quality scores

A revision with excellent visuals + great exercises + **wrong theory** must **not** pass because its average
"quality score" is high. Separate:
- **Hard blockers** — factual error · unsafe/broken content · invalid answer/scoring · critical skill mismatch ·
  unusable required media · unresolved major review issue · **unsatisfiable Mastery Requirement** (§20).
- **Improvement items** — wording polish · optional visual · extra example suggestion.
A dashboard score may exist later, but **blockers override aggregate scores**. (V1 already models
`blockers`/`warnings` in `PublicationReadinessService` — reuse the pattern; extend blockers to pedagogical/
factual categories, which today are absent.)

## 11. Content Brief

Before drafting, a conceptual **Content Brief** reduces random author/AI output (schema deferred): Roadmap Point ·
target level · target domains/skills · learner profile · learning outcomes · prerequisite assumptions · required
evidence kinds · required Teaching stages · likely misconceptions · desired instruction/support language · media
needs · reference requirements · Mastery Requirement · known constraints. **NEW** — no brief concept exists in
V1.

## 12. Learning-outcome alignment

Every publishable content package has clear intended outcomes, and review **traces the chain**:
`Roadmap Point → learning outcome → target skills → Teaching Blueprint stages → activities → evidence → Mastery
Requirement`. Catch alignment failures — e.g. outcome "learner can *produce* Present Simple sentences" but
activities are only reading + multiple choice (§20; the bad case in §55/§57 analogues). **NEW** — V1 checks
structure, not outcome↔activity alignment.

## 13. Teaching completeness

"Has text and a quiz" is **not** enough. Review asks whether the approved Teaching Blueprint has enough
instructional support for the intended outcome — depending on the point: concept explanation · motivation ·
rule/mental model · examples · visual · early understanding check · guided practice · independent practice ·
skill integration · misconception/remediation paths · mastery evidence. **Not every point needs every item —
the Methodist blueprint decides what is pedagogically necessary** (`TEACHING_ENGINE_V2.md` §4/§6).

## 14. Explanation quality

Review explanations for **what / why / when / how / contrast / examples / common mistakes / learner-language
appropriateness**. Avoid shallow rules ("She uses *is*") when the learner needs the underlying concept. **Check
whether the explanation assumes knowledge not yet taught** (prerequisite leakage).

## 15. Example quality

Examples must be **correct**, demonstrate the intended concept, vary enough to show generalization, avoid
unnecessary complexity, use learner-appropriate vocabulary/context, avoid answer leakage, and include contrast
where useful. **Distinguish a worked example from an assessment item** — a worked example shown immediately
before an identical test item **invalidates the evidence** (Skills/Mastery: exposure ≠ evidence).

## 16. Visual quality

Visuals are **pedagogical assets, not decoration** (Teaching §8 semantic purpose). Review: what teaching purpose
(e.g. `TIME_CONTRAST` for a Present Simple timeline, not a random illustration)? accurate? readable? simplifies
or confuses? works on mobile? needs alt text? unnecessary embedded text? localization impact? rights/provenance?

## 17. Activity / exercise quality

For every evidence-producing activity: intended skill? evidence **kind**? correct answer/rubric? appropriate
difficulty? ambiguity? plausible distractors? unnecessary trick? answer leakage? duplicate memorization?
required prerequisite? scaffold level? feedback/remediation mapping? Objective scoring stays **deterministic**
where possible.

## 18. Distractor quality

For objective questions: a **bad** distractor is obvious nonsense **or** a second defensible answer (ambiguity);
a **good** distractor represents a **realistic misconception** without becoming ambiguous, helping diagnose
likely misunderstanding. But **do not** turn every wrong option into a guaranteed misconception diagnosis — one
response is evidence, not certainty (Mastery §9).

## 19. Assessment validity

Separate **content teaching quality** from **assessment validity**: a grammar assessment must not become a
vocabulary test (too-hard vocabulary confounds the measurement); a reading item must not test hidden outside
knowledge; a listening item must **require listening** (not be inferable from visible text); a productive task
must be evaluated with the appropriate rubric/mechanism. (See §56 bad-assessment example.)

## 20. Mastery alignment

The quality system must validate that available activities can **actually satisfy the declared Mastery
Requirement** (Mastery §10). If the requirement needs `INDEPENDENT_PRODUCTION` but the blueprint contains only
`single_choice`, **publish is BLOCKED / incomplete** — no impossible mastery contracts. **This is a hard blocker
and a NEW cross-check** (V1 has neither Mastery Requirements nor this alignment check).

## 21. Misconception coverage

The canonical misconception taxonomy is Methodist-owned (Skills §23). Authors review likely misconceptions for a
point (e.g. Present Simple 3SG: omitted *-s*; *-s* with I/you/we/they; later auxiliary/form confusion) and
include remediation where pedagogically important. **AI may suggest candidate misconceptions but cannot silently
create canonical taxonomy entries.**

## 22. Language & localization quality

Distinguish **target / instruction / support** language. For beginner English with Uzbek support, translation
must preserve **intended teaching meaning**, not literal word equivalence — an English tense explanation
translated into Uzbek must not introduce a **false grammatical rule** (§ Scenario I is a localization blocker).
Do not hardcode Uzbek; architecture stays multi-language/multi-subject.

## 23. Terminology

Important learning terms stay **consistent** across lessons, visuals, exercises, feedback, roadmap, assessments
(if one lesson says "Present Simple" and another invents a conflicting learner-facing label, there must be an
intentional reason). A conceptual **glossary/terminology governance** may help (schema deferred).

## 24. Accessibility

Conceptual quality checks: alt text for meaningful images · readable structure · contrast/readability ·
keyboard/accessibility where relevant · transcripts for audio where pedagogically appropriate · captions for
video · not relying on color alone · mobile usability. **First-class**, not an afterthought (not frontend
implementation here).

## 25. Media quality

Required media must be valid, accessible, correctly linked, pedagogically appropriate, version-compatible, and
rights/provenance-safe. **If a blueprint requires listening evidence but its audio is missing/broken, it is not
publish-ready** (V1 already blocks `MEDIA_MISSING`/`MEDIA_NOT_READY`/`MEDIA_BLOCKED`/`MEDIA_MIME_MISMATCH` —
reuse/extend). Optional media may degrade **only if the approved blueprint explicitly supports it**; **never
fabricate skill coverage** (Roadmap/Teaching honest-degradation). Future audio/speech review: pronunciation
accuracy · clarity · level-appropriate speed · naturalness · transcript consistency · accent policy · file
integrity.

## 26. Authoring workflow

Conceptual workflow (reuse DRAFT→REVIEW→PUBLISHED): `need identified → research → draft → internal validation →
Methodist review → changes requested OR approved → publish → monitor → revise when needed`. **A content author
must know WHY publication is blocked** (V1 already returns coded blockers — reuse/extend the codes to pedagogical
categories).

## 27. Human review

Human review is not "looks fine." Methodist inspects, via a checklist (§33): learning outcome · theory · skill
mappings · explanation · examples · activities · evidence alignment · misconception coverage · mastery
compatibility · references · learner-language quality · media · accessibility. Reviewer-role permission policy
may reuse the existing `content.publish` + `SubjectAssignment` substrate (open where product policy requires
more).

## 28. Automated validation

Automation catches **structural/technical** problems (V1 already does much of this): missing required field ·
invalid skill reference · invalid activity payload · missing answer · duplicate stable key · broken prerequisite
· missing media reference · **impossible Mastery Requirement coverage** (NEW, §20) · unsupported format ·
missing required accessibility metadata. But automated validation **cannot prove** "this explanation is
pedagogically excellent" — **human review remains necessary** (§55).

## 29. AI authoring assistance

AI may help: research discovery · summarize/reference sources · draft explanations · candidate examples ·
candidate distractors · suggest visuals · suggest misconception mappings · candidate exercises ·
translate/localize drafts · consistency checks. **Every AI output is DRAFT / assistance until approved.** AI must
**not**: invent a factual rule and treat it as authoritative · fabricate a source · silently modify published
canonical content · create canonical skill/CEFR policy without approval · **self-approve** · bypass hard
blockers.

## 30. AI / source verification

If AI assists with research, a **cited source must be real/verifiable before publication reliance** — *"AI says
this source exists"* is **not** provenance. References relied upon by published content must be independently
**resolvable/verified** by the authoring process (§ Scenario J: an AI-cited nonexistent reference cannot support
publication). Tooling deferred.

## 31. Scaling authoring

Do **not** solve scale by "AI generates 10,000 lessons → auto-publish." Preferred pipeline: `canonical
curriculum → structured Content Brief → research package → AI-assisted draft → automated structural validation →
human/Methodist review → publish`. Batch authoring may be supported, but **quality gates remain** for every
item.

## 32. Publish-readiness checklist

Conceptual checklist (extends V1's structural readiness with pedagogical items; persistence not implemented
here): learning outcome clear · source accuracy verified · theory correct · prerequisite assumptions valid ·
explanation understandable · examples correct · visual useful where needed · misconception coverage sufficient ·
early check present where needed · guided practice sufficient · independent evidence available where required ·
recognition/productive evidence aligned · activity answers/rubrics valid · **Mastery Requirement satisfiable** ·
skill mappings correct · localization reviewed · accessibility reviewed · media valid · provenance complete
where required · no unresolved blocker · Methodist approval where required.

## 33. Quality gate

Publishing is an **explicit gate**: `DRAFT revision → validations pass → review complete → approval recorded →
PUBLISHED immutable revision`. **A published revision is never silently edited in place; corrections produce a
new revision** (V1 already enforces immutable published revisions — reuse).

## 34. Versioning / immutability

Reuse the `LessonRevision` philosophy. Future **Teaching Blueprint revisions, content revisions,
activity revisions/references, rubrics, and quality-review provenance** must remain reproducible. A learner
session pinned to **v3** stays explainable after **v4** exists — **do not mutate historical session content
behind the learner** (Teaching §28; Mastery §5).

## 35. Published-content correction

Required scenario (§ Scenario F): v3 contains an incorrect explanation; learners already completed v3 sessions;
Methodist discovers it. Expected: **create/approve corrected v4**; stop assigning v3 to new sessions where
policy requires; **do NOT rewrite historical v3 session data**; retain an **auditable quality-issue/correction
trail**; re-evaluate the **evidence integrity/admissibility** of affected responses and let the downstream
engines **recompute** current projections (§35a) — a defect does **not** automatically mean learner repair; do
not pretend they saw v4. Exact remediation policy open.

## 35a. Evidence integrity / admissibility

**Immutable learner history is not the same as permanently trusted evidence.** When published content is later
**confirmed defective**, everything historical stays frozen, yet the **current admissibility** of the evidence
derived from that defect may change. Do **not** establish the incorrect invariant *"once a `SkillMeasurement`
exists, it must influence mastery exactly the same way forever."* **Historical fact and current evidentiary
validity are separate concepts** (the content-side mirror of Mastery §5's frozen-history vs recomputable-current
split).

**Frozen (never deleted/rewritten):** learner responses; historical sessions (reproducible); historical content
revisions; historical measurement/evidence records. *"The learner saw item v3, selected response X, and scoring
version Y produced result Z at time T"* stays true forever.

**Evidence integrity / admissibility** is a *current* judgement answering: *"can this historical
response/measurement still be relied upon for the **current** mastery/placement/roadmap decision?"* Conceptual
outcomes (enum deferred): **valid/usable · under review · invalidated for decision use · limited/qualified
use.** Reasons a defect may change admissibility: incorrect answer key · ambiguous item (multiple defensible
answers) · broken/mismatched media · wrong rubric · wrong skill mapping · severe localization error ·
factual/pedagogical defect that invalidates what the task supposedly measured. This decision is **versioned and
auditable** (§48/§49): which revision/item was affected, the confirmed defect, which evidence was potentially
affected, which quality/evidence policy decided, when, and whether projections were recomputed.

**Do not rewrite the original fact.** Example — v3 item has the **wrong answer key**; a learner selected the
*actually correct* answer and was recorded wrong; the defect is later confirmed. The historical fact remains
exactly as recorded; but current projections may treat the resulting mastery evidence as **not admissible /
invalidated / needing recomputation** — **never** rewrite history to pretend the original system produced a
different result.

**Cross-engine boundary (orchestration open).** The Content Quality System does **not** directly rewrite learner
mastery. It emits an **authoritative quality/evidence-integrity outcome**; **Mastery/Skills/Placement/Roadmap
consume it under their own versioned policies** — flagging/qualifying affected evidence, **recomputing**
`LearnerSkillState`/competence projections (Mastery §5.C/§29; Skills §16), reconsidering Placement-derived
interpretation where materially affected, and regenerating Roadmap repair/review recommendations where needed.

**Invalid item ≠ learner failure, and ≠ learner mastery.** Responses to a confirmed wrong/ambiguous item must
**not** keep counting as clean mastery evidence merely because they were historically recorded — **learners are
not punished by a content defect** — but the engine must **not** auto-award mastery from an invalid item
either. The correct behaviour is **evidence re-evaluation under policy**, not a blanket up- or down-grade.

**Content correction ≠ learner remediation.** A content defect does **not** automatically mean affected learners
need `REPAIR` — if the problem was the *item/content* rather than the *learner's knowledge*, routing learners
into repair may itself be wrong. Possible post-investigation outcomes: **no learner action** (recompute after
excluding invalid evidence) · **reassessment** · **targeted clarification/review** · **repair only where valid
evidence independently shows a real gap.** Exact policy open.

**Blast radius must be reasoned, never blanket.** A defect's scope may be: the explanation only · one activity ·
one rubric · the entire blueprint/revision — depending on what was actually compromised. A wrong explanation
does **not** automatically invalidate **all** evidence from the session; a valid later mastery task in the same
session may still be admissible. **Do not invent blanket invalidation.** Exact learner-evidence
invalidation/recomputation policy remains **open** (§62); this spec only establishes that **immutable history ≠
permanent evidentiary admissibility.**

## 36. Critical content incident

Some errors need urgent **depublication/unavailability for future use**. Support conceptually: normal revision ·
deprecation · **urgent withdrawal/block** — **without deleting historical evidence**. Statuses/policy deferred.

## 37. Post-publication signals

Quality does not stop at publish. Signals: unusually high wrong-answer rate · repeated same misconception ·
repeated hint usage · excessive abandonment · learner feedback/report · unexpected response patterns · item too
easy/hard · media failure · localization complaint. **These are quality signals that trigger review — not
automatic proof the content is wrong.**

## 38. Content observability

Conceptual content-level metrics: attempts · correct/incorrect distribution · hint usage · remediation frequency
· abandonment · time/effort · misconception distributions · mastery conversion · learner reports. **Metrics are
diagnostic evidence, not direct publish/unpublish authority.** Avoid fake precision.

## 39. Item-analysis direction

Future assessment/activity quality may use item-analysis: nearly-everyone-correct · nearly-nobody-correct · a
distractor never selected · high performers unexpectedly missing an item · ambiguous response distribution. **Do
not implement psychometrics here; do not claim statistical validity without enough data.**

## 40. Learner reporting

Learners/teachers/admins should eventually report: incorrect content · confusing explanation · broken media ·
translation problem · ambiguous question · wrong answer · other issue. `report → triage → review → resolution`.
(No endpoint/UI here.)

## 41. Quality-issue lifecycle

Conceptual lifecycle: `OBSERVED → TRIAGED → CONFIRMED or NOT_CONFIRMED → FIX_PLANNED → NEW_REVISION → VERIFIED →
RESOLVED`. The **historical issue record remains auditable**. Enum names deferred.

## 42. Teaching feedback

Teaching may surface: repeated remediation on one explanation · high hint escalation · learners failing
immediately after an explanation · repeated unknown-cause mistakes → possible **teaching-quality** problems.
**Signal ≠ automatic content rewrite** (§10/§37).

## 43. Mastery/Review feedback

Mastery/Review may surface repeated unexpected errors — e.g. many learners who previously demonstrated a
prerequisite fail the same new question → **flag the item/content for human review**. Mastery/Review **must not
edit content**; Content Quality **consumes** aggregate quality signals (Mastery §28: signals ≠ state ≠
evidence).

## 44. Placement-item quality

Placement/diagnostic item quality belongs here. Diagnostic items are reviewed for: correct level expectation ·
intended skill · ambiguity · required-domain coverage · scoring validity · content leakage · excessive
dependence on unrelated skills. **A bad diagnostic item produces a bad roadmap** (Placement §12; Skills §19) —
so diagnostic authoring gets the same quality gate as teaching content.

## 45. Roadmap / content availability

Roadmap must know whether a canonical point has **publish-ready teaching content**. Distinguish **curriculum
exists** from **publish-ready teaching content exists** — this powers Roadmap V2's honest `CONTENT_UNAVAILABLE`
(`ROADMAP_ENGINE_V2.md` §21). Never expose a point as fully teachable if required blueprint/content is missing.

## 46. Level coverage

Content Quality can report **honest** level coverage — e.g. `A1: 12/12 publish-ready · A2: 8/20 · B1: 0/…` —
supporting "design A1–C2 now, author level-by-level" **without faking availability** (Placement/Roadmap honest
degradation). Exact progress calculation open.

## 47. Multi-subject compatibility

The architecture stays **generic**; subject-specific quality policies/plugins evolve later. English cares about
grammar accuracy / language level / pronunciation / CEFR alignment; Math about derivation & numeric correctness
/ proof quality; History about source provenance / chronology / interpretation-vs-fact; Science about scientific
accuracy / diagrams / safety context. No English-only quality logic in the engine core (§ Scenario L).

## 48. Quality-policy versioning

Quality rules evolve. A **Content Quality Policy Version** lets historical publication answer *"which quality
policy did this revision pass?"* A new policy **must not silently rewrite historical approval facts**; it may
mark content `NEEDS_REVIEW` under the current policy **without** claiming the old approval never happened
(§ Scenario K; mirrors Mastery §5 frozen-history / recomputable-current). Persistence deferred.

## 49. Approval provenance

Published content should answer: who/what **authored** it · who **reviewed** it · which **policy/checklist
version** · **when** approved · which **content revision** · which **references** were relied upon where
required. **Do not expose internal reviewer data to learners.** (V1 has `StaffAudit` per mutation +
`ContentSource` — reuse/extend into approval provenance.)

## 50. Content Quality vs personalization

Do **not** solve poor content with "AI will personalize it." Canonical content still needs a strong pedagogical
foundation; personalization may adjust wording/examples/branch/amount-of-practice (Teaching §20) but must **not**
be required to rescue fundamentally incorrect/incomplete published material.

## 51. Present Simple — authoring worked example

**Point:** Present Simple — habits, routines, general truths.
- **A. Content Brief.** Target A1 beginner; skills: recognize routine/general-truth use · affirmative form · 3SG
  · produce a simple routine statement; instruction/support language Uzbek where appropriate.
- **B. Research.** Verify from reputable references: use for habits/routines/repeated actions/general truths;
  contrast with Present Continuous where appropriate; 3SG rules. **Do not** teach "Present Simple = exactly
  what is happening now."
- **C. Draft explanation.** Motivation "I go to school every day."; visual = weekly repeated-action timeline
  (`TIME_CONTRAST`).
- **D. Examples.** *I live in Tashkent. She lives in Tashkent. They play football. He plays football.*
- **E. Misconceptions.** omits 3SG *-s* · adds *-s* to I/you/we/they · confuses routine with now.
- **F. Early check.** *"She ___ to school every day. [go][goes]"*.
- **G. Remediation.** If "go": explain 3SG, show a **different** example, re-check a new sentence.
- **H. Production.** `"My brother / work / bank" → My brother works in a bank.`
- **I. Cross-skill.** short routine reading/listening; guided personal-routine writing/speaking where available.
- **J. Mastery alignment.** If **independent production** is required, the point **cannot publish with MC only**
  (§20 hard blocker).
- **K. Quality review.** accuracy · clarity · visual semantics · exercise validity · skill mapping ·
  misconceptions · mastery satisfiability · localization · media/accessibility · sources.
- **L. Publish.** Methodist-approved immutable revision (with approval provenance, §49).

## 52. Bad-content worked example

Content says: *"Present Simple is used for actions happening exactly right now."* **Automated structural
validation passes** (all required fields exist; activities valid; answer keys exist). **Human/subject review
catches a FACTUAL/PEDAGOGICAL blocker → publication blocked.** Proves **technical validity ≠ pedagogical/factual
quality** (§28; the exact gap in today's `PublicationReadinessService`).

## 53. Bad-assessment worked example

Target skill Present Simple 3SG; the question uses an **advanced unknown word** that stops beginners
understanding the sentence. The item may be **technically valid**, but **assessment validity is weak** because
vocabulary confounds the intended grammar measurement (§19). Quality review requests revision.

## 54. Post-publish signal worked example

Published activity `"My brother ___ at a bank."` — **80% of otherwise strong learners choose the "wrong"
option**. Expected: **do NOT automatically downgrade all learners**; investigate answer key · wording ·
distractors · prerequisite · localization · sequencing. If the item is wrong → new revision; the historical
responses are **preserved**, their **evidence admissibility is re-evaluated**, and downstream engines
**recompute** current projections (§35a; Mastery §5) — **not** an automatic learner repair. **Do not invent a
final evidence-invalidation policy here.**

## 55. Scenarios

**A — AI-generated draft** → remains **draft** until verified/reviewed (§29).
**B — Structurally valid but factually wrong** → automated validator passes; **Methodist blocks** (§52).
**C — Great lesson, impossible Mastery Requirement** → recognition-only activities vs `INDEPENDENT_PRODUCTION`
requirement → **publish blocked/incomplete** (§20).
**D — Missing required listening audio** → **not** publish-ready as full teaching; no fake listening coverage
(§25).
**E — Optional visual missing** → may still publish **if** the blueprint explicitly supports the no-visual
fallback (§25).
**F — Wrong published explanation** → create v4; future learners stop receiving v3; **history stays
reproducible** (§35).
**G — High learner failure rate** → quality signal raised; **do not** auto-blame learners or auto-edit content
(§37/§39).
**H — Ambiguous question** → item review confirms two defensible answers → **block/fix**; responses are not
clean mastery evidence (§18).
**I — Translation error** → English correct, Uzbek support text changes the meaning → **localization blocker**
(§22).
**J — Source cannot be verified** → AI cited a nonexistent reference → **source cannot support publication**
(§30).
**K — Policy evolves** → v3 passed policy V1; policy V2 adds a required accessibility check → **historical
approval remains**; content becomes `NEEDS_REVIEW` under current policy (§48).
**L — Other subject** → Math uses the same generic workflow but a **subject-specific quality policy** (§47).
**M — Wrong answer key (confirmed later)** → the historical response is **preserved** (learner saw item v3,
selected X, scoring Y → Z at T); once the defect is confirmed, that evidence is **no longer treated as clean
current mastery evidence** (admissibility → invalidated/qualified, §35a); history is not rewritten.
**N — Ambiguous item (two defensible answers)** → historical responses **preserved**; the item's evidence may
become **inadmissible/qualified**; **do not label learners weak**, and do not auto-award mastery — re-evaluate
under policy (§35a).
**O — Wrong explanation, valid later mastery task** → **do NOT blanket-invalidate** all session evidence; reason
about the **blast radius** (explanation only? one activity? one rubric? whole revision?) — a valid, independent
mastery task in the same session may remain admissible (§35a).

## 56. V1 → V2 gap analysis

**Why V1 is insufficient:** `PublicationReadinessService` validates **structure only** (activities present/
ordered/valid-payload/supported-type, skills active, hierarchy & prerequisites published, media ready/moderated,
pointer coherent). It cannot judge **factual accuracy, pedagogical quality, skill alignment, assessment
validity, mastery satisfiability, misconception coverage, explanation/example/distractor quality, localization,
accessibility (beyond media moderation), or source provenance** — exactly the bad-content case (§52) that passes
today. There is **no Content Brief, no research/source provenance, no multidimensional human-review record, no
quality-policy version, no quality-issue lifecycle, no post-publication signal loop, and no author≠approver
enforcement** (author vs publish are separate permissions, but one person may hold both).

| Component | Verdict | Notes |
|---|---|---|
| `LessonRevision` immutable publication + pinning | **REUSE** | the reproducibility spine (§34). |
| `PublicationReadinessService` (structural blockers/warnings) | **EXTEND** | keep the blocker/warning pattern; **add** pedagogical/alignment/mastery/localization/accessibility/provenance checks + **pedagogical hard blockers** (§10/§20). |
| `RevisionStatus` DRAFT→REVIEW→PUBLISHED→ARCHIVED | **REUSE + EXTEND** | reuse workflow; add deprecation / urgent-withdrawal (§36) + `NEEDS_REVIEW` under new policy (§48). |
| `ContentSource` (HUMAN/AI_GENERATED/AI_ASSISTED) + TD-20 | **REUSE + EXTEND** | provenance seed; enforce "AI never self-publishes" and extend to approval provenance (§49). |
| `content.author` / `content.publish` / `SubjectAssignment` scope | **REUSE + EXTEND** | separate author/publish exists; **add author≠approver (four-eyes) where policy requires** (§27; today unenforced). |
| `StaffAudit` (per-mutation audit) | **REUSE + EXTEND** | reuse as approval/review provenance substrate (§49). |
| activity payload validation / `activity-registry` | **REUSE + EXTEND** | structural today; add format/exercise/distractor quality (§17/§18). |
| `LessonSkill` / `ActivitySkill` | **REUSE + EXTEND** | reuse mappings; add primary/supporting + evidence-vs-exposure (Skills §22) and outcome-alignment checks (§12). |
| media processing/moderation status | **REUSE + EXTEND** | reuse; add semantic-purpose + accessibility (alt/caption/transcript) review (§16/§24). |
| A1 pilot import validation | **REUSE + EXTEND** | reproducible import kept; layer quality gates on top (§57). |
| — Content Brief · research/source provenance · multidimensional review record · pedagogical hard blockers · quality-policy version · quality-issue lifecycle · post-publication signals · item analysis · terminology/glossary | **NEW** | none exist in V1. |

## 57. Current A1 pilot — quality review (do not rewrite)

Representative, fair assessment of `content/pilots/english-a1/v1` (13 skills / 12 lessons / 114 activities;
`provenanceSource = AI_ASSISTED`, methodist review pending):
- **Strengths worth reusing:** reproducible, structurally-validated import; immutable revisions; per-lesson +
  per-activity skill mappings; strictly-linear prerequisites; deterministic objective scoring; clean hierarchy.
- **Gaps vs V2 quality goals:** explanations are `TEXT`/`EXPLANATION`/`EXAMPLE` markdown of **unverified
  pedagogical depth** (likely thin for a real teaching system); **objective-only evidence** (single_choice
  dominant) → **recognition-only mastery** (`MASTERY_TEST` = MC), which cannot satisfy productive expectations
  (§20); **no productive/listening/reading/speaking** activities; **minimal/absent visuals** (text-first);
  **misconception remediation not modeled**; **no source/research provenance**; and the content is
  **`AI_ASSISTED` with human Methodist review still pending** — i.e. it has **not** passed a V2-style
  multidimensional pedagogical review. **Be fair:** the structure is sound and reusable — the gap is *depth,
  evidence diversity, misconception/remediation, and review provenance*, not the container.

## 58. Potential future persisted concepts

(Conceptual; no schema/names.) `ContentBrief` · `SourceReference`/`ResearchReference` · source→content
provenance · `ContentQualityPolicyVersion` · `ContentReview` (+ checklist result) · approval provenance ·
`ContentQualityIssue` · `ContentQualitySignal` · subject-specific quality policy · publication blocker record ·
terminology/glossary mapping.

## 59. Potential future workflows / APIs (additive — no endpoints designed)

create/edit brief · attach/manage references · request review · submit review · approve/reject/request-changes ·
publish revision · withdraw/deprecate revision · report quality issue · inspect quality signals · reopen/review
content. V1's authoring + readiness + publish endpoints keep working.

## 60. Implementation phasing (recommended future order — not implemented)

- **Phase 1 — structural quality foundation:** Content Brief · explicit readiness (extend
  `PublicationReadinessService`) · review/approval record · quality **blockers** · provenance basics.
- **Phase 2 — teaching-alignment checks:** Skills/Blueprint/Mastery alignment (§12/§20) · misconception
  checklist · richer media/accessibility.
- **Phase 3 — post-publication observability:** learner reports · content quality signals · item analytics.
- **Phase 4 — AI-assisted authoring:** research assistant · draft generator · consistency reviewer — **while
  preserving human authority** (§29).

## 61. Acceptance criteria

1. Content Quality is a **first-class** system (not proofreading).
2. **Factual correctness and pedagogical quality are separate** concerns (§9).
3. **Automated validity ≠ human pedagogical approval** (§28/§52).
4. **Hard blockers cannot be hidden by an average score** (§10).
5. **Authoring research ≠ runtime web authority** (§5).
6. **AI cannot self-publish**; every AI output is draft until approved (§29).
7. **Sources/provenance are verifiable** where required; no AI-fabricated references (§30).
8. **Copyright-safe original synthesis** is required (§8).
9. **Teaching Blueprint / skill / Mastery alignment is checked** (§12/§20).
10. **Recognition-only content cannot satisfy production requirements** (§20).
11. **Media unavailable never produces fake evidence** (§25).
12. **Localization and accessibility are first-class** (§22/§24).
13. **Learner errors may trigger content review**; **signals never auto-edit** canonical content (§37-45).
14. **Published revisions remain immutable/reproducible**; corrections preserve history (§34/§35).
15. **Immutable history ≠ permanent evidentiary admissibility**: a confirmed content defect may change the
    **current admissibility** of affected evidence and require **recomputation**, without deleting/rewriting the
    original fact; a defect does **not** automatically imply learner repair; Content Quality emits an integrity
    outcome and does **not** directly rewrite mastery (§35a).
16. **Multi-subject architecture** is maintained (§47).
17. **No fake exact quality formula** is invented (§10/§38).

## 62. Open questions (deferred — direction given, no fake precision)

Persisted schema/table/enums · review-status lifecycle · blocker/severity taxonomy · per-subject source policy ·
number/type of references required · reviewer/four-eyes policy · approval permissions · quality scoring/dashboard
model · item-analysis/statistics thresholds · content-invalidation/remediation policy for affected learners ·
copyright/license metadata · accessibility standard/check tooling · AI authoring provider/model · source-research
toolchain · translation/localization workflow · batch authoring workflow.

Architectural direction is given inline (four authority layers; authoring-research vs runtime authority;
multidimensional quality with pedagogical hard blockers overriding scores; Content Brief; outcome↔skill↔mastery
alignment; AI-assist-never-authority; verifiable provenance; immutable revisions with history-preserving
correction; signals-trigger-review-not-auto-edit; quality-policy versioning; multi-subject generic engine; reuse
of `LessonRevision`/`PublicationReadinessService`/`ContentSource`/`content.*` permissions/`StaffAudit`/media
status). Numeric and nomenclature choices remain owner/Methodist decisions.
