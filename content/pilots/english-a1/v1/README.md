# English A1 Pilot — v1 (`english-a1-pilot/v1`)

## Purpose

The first real educational content pack for Izlan. It proves that the existing content model, skills, prerequisites,
bulk import, review/publication workflow, and learner-safe execution can carry genuinely useful learning content —
using **only** the currently supported text (Markdown) and objective Activity contracts.

This is a **pilot** curriculum. It does **not** freeze the full future English curriculum.

## Status

- **Technical status:** validated (`npm run content:pilot:a1:validate` → VALID; imports + publishes structurally in the
  test database via the existing workflow).
- **Pedagogical status:** **AI-assisted draft — OWNER / METHODIST PEDAGOGICAL REVIEW PENDING.** The content is not yet
  pedagogically approved and is **not** "CEFR certified" or "production content finalized". A human must review the actual
  lessons before any real import or publication.
- **Provenance (TD-254):** these are AI-assisted authoring drafts, and they declare it — all four packages set
  `provenance.source = AI_ASSISTED`, so every imported Activity persists with `source = AI_ASSISTED` (`aiMetadata = null`).
  Human review does **not** rewrite provenance; real publication is always a manual human step through the CMS after
  review. See the ENGLISH_A1_PILOT.md doc, TD-254, and DATA_MODEL_CORE.md §20 (AI provenance) for details.

## Languages

- **Teaching / explanation language:** Uzbek (Latin).
- **Target language:** English.

UI internationalization is a separate concern — this is content language, not chrome.

## Hierarchy

```
English (Subject)
└── General English (Track)
    └── A1 (Level)
        └── A1 Foundations (Module)
            ├── Topic 1 — Tanishuv va asosiy gaplar
            ├── Topic 2 — Savollar va shaxsiy ma'lumot
            ├── Topic 3 — Oila va egalik
            └── Topic 4 — Kundalik hayot
```

The bulk importer does **not** create this hierarchy. The Methodist creates Subject → Track → Level → Module → the 4
Topics in the CMS first, then imports each Topic package into its Topic.

## Import order (matters — later packages reference earlier lessons)

1. `01-introductions-and-be.json`   → Topic 1
2. `02-personal-information.json`    → Topic 2
3. `03-family-and-possession.json`  → Topic 3
4. `04-daily-routines.json`         → Topic 4

Each file is a `izlan-topic-content/v1` import document. `manifest.json` is a repository-level manifest (for humans,
tests, and import order) — it is **never** sent to the import endpoint.

## Lessons (12)

| # | contentKey | Title | Topic |
|---|---|---|---|
| 01 | ENG-A1-001-GREETINGS | Salomlashish va tanishuv | 1 |
| 02 | ENG-A1-002-SUBJECT-PRONOUNS | Kishilik olmoshlari | 1 |
| 03 | ENG-A1-003-BE-AFFIRMATIVE | To be: am, is, are | 1 |
| 04 | ENG-A1-004-BE-NEGATIVE | To be: inkor shakli | 2 |
| 05 | ENG-A1-005-BE-QUESTIONS | To be bilan savollar | 2 |
| 06 | ENG-A1-006-NUMBERS-PERSONAL-INFO | Sonlar va shaxsiy ma'lumot | 2 |
| 07 | ENG-A1-007-POSSESSIVE-ADJECTIVES | Egalik sifatlari | 3 |
| 08 | ENG-A1-008-FAMILY | Oila a'zolari | 3 |
| 09 | ENG-A1-009-HAVE-HAS | Have va has | 3 |
| 10 | ENG-A1-010-PRESENT-SIMPLE-AFFIRMATIVE | Present Simple: tasdiq gaplar | 4 |
| 11 | ENG-A1-011-PRESENT-SIMPLE-NEGATIVE | Present Simple: inkor gaplar | 4 |
| 12 | ENG-A1-012-PRESENT-SIMPLE-QUESTIONS | Present Simple: savollar va yakuniy takrorlash | 4 |

Prerequisite chain: linear `001 → 002 → … → 012` (lesson 001 has no prerequisite). Because Topics are imported separately,
they must be imported in the order above so each lesson's prerequisite already exists.

## Activity types used

- **Markdown** (`lesson-activity-markdown/v1`): `TEXT`, `EXPLANATION`, `EXAMPLE` — restricted Markdown, no raw HTML.
- **Objective** (`lesson-activity-objective/v1`): `MINI_QUESTION`, `PRACTICE`, `MASTERY_TEST` — `single_choice` /
  `multiple_choice` / `true_false`.

Lessons 1–11 have 8 activities each and Lesson 12 has 10 (98 total; 51 objective; ~176 min). No media (`IMAGE`/`AUDIO`/`VIDEO`), no `SPEAKING`/`WRITING`/
`LISTENING`/`AI_INTERACTION`.

## Safety

These JSON files necessarily contain server-only `answerKey` values. They are **authoring source files, not learner
delivery files**: never copied into `web/public`, never imported by frontend source, never served as static assets,
never logged, never referenced from browser code. The learner runtime strips `answerKey` via the canonical learner
projection before anything reaches a client.

## Validate locally

```
npm run content:pilot:a1:validate
```

Prints a safe summary (counts only) and exits non-zero on any structural or cross-file invariant failure. It uses the
real importer parser — no second validator.

## Import through the CMS (real workflow, manual)

1. In the CMS, create the hierarchy: **English → General English → A1 → A1 Foundations → the 4 Topics**.
2. Open **Topic 1** → **Import qilish** → choose `01-introductions-and-be.json` → **Tekshirish** (dry-run) → **Import
   qilish** (apply). Repeat for Topics 2, 3, 4 with their packages, in order.
3. Review the imported DRAFT lessons.
4. Publish manually (per lesson) in prerequisite order `001 → 012` using the existing review → publish workflow.

Nothing here auto-imports into a dev or production database and nothing auto-publishes. `db:seed:system` / `db:seed:demo`
are unchanged.
