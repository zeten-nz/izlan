# Izlan — Permanent Engineering Rules (izlan / code repo)

> These are the durable rules for working on Izlan. Phase prompts should NOT need to repeat them — a phase prompt
> focuses on the phase-specific architecture contract, invariants, tests and STOP boundary (see §15/§16). Adopted
> 2026-08-21.

## Repositories & source of truth
- **`zeten-nz/izlan`** (this repo, `backend/`) — source of truth for runtime code, Prisma schema, migrations, tests.
- **`zeten-nz/izla-docs`** (`../docs/`) — source of truth for product/architecture decisions, phase checkpoints, open questions.
- **Actual implementation always wins over stale documentation.** If implementation and docs disagree, report
  **DOCUMENTATION DRIFT** explicitly — never silently hide the discrepancy.
- Never claim documentation represents the current code unless the checkpoint's **recorded code commit SHA matches the
  implementation inspected** for that checkpoint.

## Phase workflow
- One git branch per implementation phase: **`phase/<phase-id>`** (in both `izlan` and `izla-docs`). Do not mix
  unrelated phases in one commit.
- One clean final phase commit: **`phase(<phase-id>): <description>`**.
- **Git ownership (owner decision 2026-08-21): branch + commit + push.** At phase completion, create the `phase/<id>`
  branch, make the clean commit, and **push the branch to `origin`** in both repos — but do **NOT** merge to `main`; the
  owner opens/merges the PR. (Non-phase setup/chore work uses a `chore/<name>` branch, same push-not-merge rule.)
- Preserve **STOP boundaries**. Do not expand phase scope merely because adjacent work is obvious.
- Reconnaissance-first: inspect actual code/schema before proposing. Report an **ARCHITECTURE GAP** rather than invent.
  An assumption is not a decision — owner decisions get **TD-numbers** and are recorded in `izla-docs/TECH_DECISIONS.md`.
- Do not begin the next implementation phase until the owner supplies its specific prompt.

## Pre-completion gate (run and report every phase)
1. TypeScript check — `npx tsc --noEmit -p tsconfig.json`
2. Relevant unit tests — `npx jest <paths>` (full unit suite `npx jest` when regression is warranted)
3. Relevant e2e tests — **`npm run test:e2e`** (jest `--runInBand` is MANDATORY: all e2e share the one `izlan_test` DB;
   running parallel workers corrupts cross-spec state)
4. Full regression when the change is cross-cutting
5. `npx prisma validate`
6. `npx prisma migrate status` (dev + test)
7. Drift check where applicable — `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema --script
   --exit-code` must be an empty migration (exit 0) on both `izlan_dev` and `izlan_test`
8. `git status --short` (both repos)
- **Do not use raw test count as a quality target.** Report the **critical invariants / regressions covered** alongside
  the counts.

## Migrations
- Generate with `prisma migrate diff --from-config-datasource --to-schema prisma/schema --script`; append custom SQL
  (partial unique indexes + CHECK constraints) manually; apply with `prisma migrate deploy` to **both** `izlan_dev` and
  `izlan_test`. Never edit an already-applied migration. Drift must be clean afterwards.
- DB credentials live only in `backend/.env` (gitignored). `izlan_test` isolation is enforced by `assertTestDatabase`
  (NODE_ENV=test + current_database()=izlan_test). No production destructive ops.

## Standing product/architecture invariants
- Learner sees **PUBLISHED** content only; drafts/in-review/archived-hidden never leak (visibility filter must be
  centralized, not "frontend hides button").
- Lesson = logical identity; LessonRevision immutable once published; edits create a new revision. Runtime pins the
  exact `lessonRevisionId` at lesson start (roadmap/daily-plan hold logical lesson ids).
- AI may assist but **never auto-publishes**; AI output is DRAFT/suggestion (`Activity.source` provenance).
- Ledgers are append-only; money is integer; no client economic authority; own-user IDOR is 404-safe.
- Never log secrets / OTP / answer-keys / raw provider payloads. RBAC is permission-code based with **no ADMIN
  role-name bypass**.
- **Payment provider track is PAUSED** (no CLICK/Payme merchant application, merchant docs, sandbox or test
  credentials). Completed payment architecture must not be modified. Resume `2.1L-C` only after the CLICK PROTOCOL
  VERIFICATION BLOCKER is cleared from current official docs.

## Checkpoint requirements (every completed phase)
Record, in `izla-docs/checkpoints/<phase-id>.md` (immutable) and summarized in `izla-docs/PROJECT_STATE.md`:
- exact **code commit SHA** (izlan) + exact **docs commit SHA** (izla-docs)
- **branch name**
- **migration count**
- **unit / e2e totals** + the critical invariants/regressions those tests cover
- **changed file paths**
- **TDs added**
- **remaining blockers**

## Governance docs (in izla-docs)
- `PROJECT_STATE.md` — current state only; may change.
- `PHASE_HISTORY.md` — append-only index of phases.
- `checkpoints/<phase-id>.md` — immutable accepted checkpoints. **Never rewrite an accepted historical checkpoint**;
  corrections go in a later checkpoint or an explicit correction note.
- `TECH_DECISIONS.md` — accepted decisions (TD-numbers).
- `OPEN_QUESTIONS.md` — **only unresolved owner decisions**. Once resolved, remove from OPEN_QUESTIONS and record the
  accepted decision in TECH_DECISIONS.
