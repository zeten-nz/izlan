# Investor Demo — Content Runbook (Methodists)

> Practical workflow for loading polished curriculum through the **real** Content Studio + Bulk Import lifecycle.
> No feature is described that does not exist. Curriculum is authored/reviewed/published by humans — never seeded
> directly into the database. This runbook is for a **non-production staging** environment.

## What already exists (no work needed)

`npm run db:prepare:investor-demo` (see the staging runbook) publishes a minimal, real **`English — Beginner (A1)`**
subject with a working **placement diagnostic**, three published lessons, and two demo learners. The whole learner
journey (placement → roadmap → daily plan → lesson → review → progress → XP/IZL) works on that subject out of the box.
This runbook is about adding **more, polished lessons** on top — done by Methodists, in parallel with engineering.

## Curriculum source (already prepared & validated)

The English A1 pilot is packaged as importable Topic documents:

- `content/pilots/english-a1/v1/manifest.json` — human/import-order manifest (never sent to the API)
- `content/pilots/english-a1/v1/01-introductions-and-be.json`
- `content/pilots/english-a1/v1/02-personal-information.json`
- `content/pilots/english-a1/v1/03-family-and-possession.json`
- `content/pilots/english-a1/v1/04-daily-routines.json`
- `content/pilots/english-a1/v1/README.md`

Scope: **4 Topics · 12 Lessons · ~98 Activities · 13 Skills** (`izlan-topic-content/v1`, markdown + objective only,
`provenance.source = AI_ASSISTED` → still requires human review). Validate anytime with
`npm run content:pilot:a1:validate`.

> The bulk importer does **not** create the hierarchy. The Methodist creates Subject → Track → Level → Module → the 4
> Topics first, then imports each Topic package into its Topic.

## Step-by-step (real UI + lifecycle)

1. **Enter staging** — open the staging web app, go to **`/staff/login`**, sign in as the **Methodist** demo account
   (credentials supplied out-of-band; see the staging runbook). Content Studio opens at `/staff/content`.
2. **Create/select the English subject** — either author into the existing `English — Beginner (A1)` subject, or create
   a fresh `English` subject (needs `content.subject.manage`; ADMIN self-assigns on create, or an ADMIN assigns the
   Methodist to it — there is **no ADMIN role-name bypass**, a SubjectAssignment is required to author).
3. **Build the hierarchy** — under the subject, create **Track → Level (A1) → Module (A1 Foundations) → the 4 Topics**
   matching the pilot manifest (titles from the manifest). Everything starts as **DRAFT**.
4. **Import a Topic package** — open the Topic → **Import** (Import qilish). Choose the matching `NN-*.json` file.
   `.json` only, ≤5 MiB; the file is never persisted in the browser and answer keys are never rendered.
5. **Validate (dry-run)** — the importer validates against the live DB and shows a summary + any errors. Fix the JSON
   and re-validate until clean. Nothing is written yet.
6. **Apply** — confirm to run the atomic apply. It imports Skills + Lessons + one initial **DRAFT** LessonRevision +
   Activities + Lesson/Activity-skill mappings + prerequisites, all as **DRAFT** (zero learner visibility). Repeat
   steps 4–6 for each of the 4 Topic packages.
7. **Review lesson/revision/activity content** — open each Lesson → its DRAFT Revision. Read the markdown, check the
   objective questions and correct answers, and use **Learner preview** (O‘quvchi ko‘rinishi) to see exactly what the
   learner will see (answer keys never appear here).
8. **Verify skills & prerequisites** — confirm each lesson maps to the right Skills and that prerequisites form the
   intended chain (the backend rejects cycles).
9. **Submit for review** — on each DRAFT revision, **Submit for review** (Ko‘rib chiqishga yuborish). Fix any Readiness
   **blockers** first (the panel lists them). Warnings do not block.
10. **Publish in hierarchy order** — publish **top-down**: Subject → Track → Level → Module → Topic must be PUBLISHED
    before their lessons. Then, per lesson, **Publish** (Nashr qilish) the reviewed revision (readiness-gated; this
    atomically makes it the live revision). There is **no direct DRAFT→PUBLISHED** — a human review step is mandatory.
11. **Verify learner visibility** — sign in as the **returning learner** demo account, open the subject, and confirm the
    new lessons appear in the roadmap / daily plan and run correctly (feedback, mastery test). If something is missing,
    it almost always means a container above it is still DRAFT — publish it (step 10).

## Do / don't

- **Do** keep the review→publish workflow — it is the product's quality authority (AI assists; Methodists approve).
- **Do** work in parallel with engineering — no code is required to author/import/publish.
- **Don't** edit content directly in the database. **Don't** try to author SPEAKING/WRITING/LISTENING/AI/VIDEO
  activities (unsupported) or upload media (IMAGE/AUDIO markers only — upload is not built). **Don't** expect an
  Assessment Builder — placement content is provided by the demo prep, not authored in the CMS yet.
