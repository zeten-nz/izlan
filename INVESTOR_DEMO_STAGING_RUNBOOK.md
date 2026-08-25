# Investor Demo — Staging Runbook

> How to stand up a **non-production** investor-staging environment. This is **not** full production hardening.
> **Security rules (non-negotiable):** never commit secrets or passwords; never put JWT private keys in the repo or in
> logs; never expose `DEMO_*_PASSWORD` in the frontend; supply all secrets via the deploy environment only.

## Two distinct runtime modes (do not conflate)

**A. One-off DEMO DATA PREPARATION** (a short-lived seed process, run once against the staging DB):
- `NODE_ENV` = an explicitly non-production value (`development`) — the fixture/demo/investor seeds are **hard-forbidden
  when `NODE_ENV=production`** by design.
- Requires **all three** opt-in flags: `ALLOW_INVESTOR_DEMO=true`, `ALLOW_DEMO_SEED=true`, `ALLOW_DEV_FIXTURE=true`
  (the investor command does **not** bypass the sub-seed guards — each seed still enforces its own flag).
- Requires the `DEMO_*_PASSWORD` env vars. Points at the staging `DATABASE_URL`. Exits when done.

**B. DEPLOYED APPLICATION RUNTIME** (the long-running app serving the demo):
- `NODE_ENV=production` with the **Nest production build** (`node dist/main.js`) and the **Next production build**
  (`next build` + `next start`), `AUTH_COOKIE_SECURE=true`, HTTPS, and exact `CORS_ORIGINS`.
- **The fixture/demo/investor flags MUST NOT be set here.** The app never seeds; it only serves the data prepared in
  mode A. Running the app as `NODE_ENV=production` against a staging DB that was seeded by a non-production mode-A
  process is fine — the data is just data; `NODE_ENV` only governs process behaviour/guards, not stored rows.

Two origins: the web app (learner + staff, one Next.js app) and the backend API. HTTPS on both. `NODE_ENV` must be one
of `development | test | production` (the env validator rejects anything else — do not invent values).

## Required environment variable NAMES (values come from the deploy env — never the repo)

Backend:
- `NODE_ENV` (non-production for the seed step, e.g. `development`)
- `DATABASE_URL` (postgres:// … for the staging DB)
- `AUTH_JWT_ACTIVE_KID`, `AUTH_JWT_PRIVATE_KEY_B64`, `AUTH_JWT_PUBLIC_KEYS_JSON`, `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`
- `AUTH_ACCESS_TTL_SECONDS` (optional; default 900)
- `AUTH_COOKIE_SECURE=true` (behind HTTPS — required so the refresh cookie is Secure)
- `TRUST_PROXY=true` (behind a TLS-terminating proxy)
- `CORS_ORIGINS` (exact staging **web** origin only; credentialed CORS — no wildcard)
- `AUTH_OTP_PEPPER`
- Opt-in flags for the ONE-OFF seed step ONLY — **all three required**, and **never set on the long-running app (mode B)**:
  `ALLOW_INVESTOR_DEMO=true`, `ALLOW_DEMO_SEED=true`, `ALLOW_DEV_FIXTURE=true`
- `DEMO_ADMIN_PASSWORD`, `DEMO_METHODIST_PASSWORD`, `DEMO_LEARNER_PASSWORD` (policy-valid; env-owned; delivered to the
  presenter out-of-band; never printed by any command)
- SMS/OTP: **no real provider is implemented yet** — see "Registration / OTP delivery" below. On the mode-B app,
  leave `SMS_DRIVER` **unset** (production-safe default). Never set `SMS_DRIVER=console` on a `NODE_ENV=production`
  process — the app refuses to start.

Web:
- `NEXT_PUBLIC_API_BASE_URL` (the staging backend origin)

## Bring-up sequence

```
# 1. Backend build + DB migrate
npm ci
npm run build                       # nest build (mode B artifact)
npx prisma migrate deploy           # apply migrations to the staging DB

# 2. ONE-OFF DEMO DATA PREPARATION (mode A: NON-production NODE_ENV + all three opt-in flags)
NODE_ENV=development npm run db:seed:system     # LEARNER/METHODIST/MODERATOR/ADMIN roles + permissions
NODE_ENV=development \
  ALLOW_INVESTOR_DEMO=true ALLOW_DEMO_SEED=true ALLOW_DEV_FIXTURE=true \
  npm run db:prepare:investor-demo
#   → staff (admin +...001, methodist +...002), fresh learner (+...003),
#     returning learner (+...004), published English (A1) subject + placement pool.
#   Fails CLOSED up front (no partial write) if ANY of the three flags is missing, or in production.
#   Passwords are read from DEMO_*_PASSWORD and are NEVER printed.
#   (Optional) BASE STAGING SNAPSHOT here — accounts + minimal fixture, before curriculum.

# 3. Load polished curriculum (Content Studio / Bulk Import) — see INVESTOR_DEMO_CONTENT_RUNBOOK.md.
#    Import as DRAFT → Methodist review → publish top-down. No DB scripts for lesson content.

# 4. Start the DEPLOYED APP (mode B: production runtime — NO fixture flags)
NODE_ENV=production AUTH_COOKIE_SECURE=true npm run start:prod   # backend (node dist/main.js)
cd web && npm run build && npm run start                         # web on its own origin (HTTPS)

# 5. Smoke QA + establish any desired deterministic demo state (learner + staff paths).

# 6. Take the GOLDEN INVESTOR SNAPSHOT here — AFTER curriculum is published and QA'd
#    (see "Repeatable state" below). This is the snapshot used to reset between presentations.
```

## Health / readiness / smoke test

- Backend liveness/readiness: `GET /api/health`, `GET /api/ready` (DB reachability).
- Learner smoke (web): `/` → `/register` or `/login` → `/onboarding` → `/placement` → `/learn` → `/learn/roadmap` →
  `/learn/learning` → a lesson → `/learn/review` → `/learn/progress`.
- Staff smoke (web): `/staff/login` (Methodist) → `/staff/content` → a subject → lesson → revision → publish flow.
- Verify: no empty subject/roadmap/plan, no raw UUIDs, no "dev/runtime/fixture" labels, no answer-key leakage, and the
  future Admin nav items still read **"Tez orada"** (not fake pages).

## Repeatable state (reset strategy) — DB snapshot, not a delete command

The demo seeds are **idempotent** (they ensure rows) but do **not** wipe **accumulated learner state** (a placement
attempt, a generated roadmap/daily plan, lesson progress, XP/IZL). A safe+complete in-app "reset" would require deleting
across the whole learner-owned graph, which is dominated by `onDelete: Restrict` foreign keys — i.e. a large, fragile
domain-specific deletion engine. **We deliberately do not build that.** Instead, make presentations repeatable with a
**database snapshot/restore**:

Two snapshots, taken at different times — the **presentation reset uses the GOLDEN snapshot**:

- **BASE STAGING SNAPSHOT** (optional, after bring-up step 2): accounts + the minimal published fixture, BEFORE the
  polished curriculum. Useful only to rebuild staging from scratch — **do NOT use it to reset between presentations**,
  because restoring it would erase the later-authored/published demo curriculum.
- **GOLDEN INVESTOR SNAPSHOT** (after bring-up step 6): taken **AFTER** the English A1 curriculum is imported, reviewed,
  and published and the smoke QA + any deterministic demo state are in place. This snapshot contains the full polished,
  published content.

```
# GOLDEN snapshot — AFTER curriculum publish + QA (bring-up step 6):
pg_dump "$DATABASE_URL" -Fc -f demo-golden.dump

# Between presentations — restore the GOLDEN snapshot, present, restore again:
pg_restore --clean --if-exists -d "$DATABASE_URL" demo-golden.dump   # then restart the backend
```

Restoring the golden snapshot brings back the fresh learner (incomplete), the returning learner (onboarded), the
placement-ready subject, AND the published curriculum, atomically.

**Safety — dedicated demo DB only.** `pg_restore --clean` overwrites the target database. It is safe **only** against a
**dedicated investor-demo database/environment** used exclusively for presentations. **Never run `pg_restore --clean`
against a shared authoring/production database.** Restoring an older golden snapshot **discards anything created after
it was taken** — this is not "zero risk"; any newer authored/imported/published content on that DB is lost. Therefore,
after any approved curriculum change, run smoke QA and create a **new** golden snapshot to replace the old one.

Golden-snapshot lifecycle:
```
demo prep → curriculum import/review/publish → smoke QA → GOLDEN SNAPSHOT → presentations
Later content change: update curriculum → review/publish → smoke QA → REPLACE the golden snapshot
```

### Safe presentation-reset procedure (dedicated demo DB)
1. Stop or isolate the demo API so no writes occur during the restore.
2. Restore the dedicated investor-demo DB from the golden snapshot:
   `pg_restore --clean --if-exists -d "$DATABASE_URL" demo-golden.dump`
3. Start/restart the API.
4. Verify: `GET /api/health` and `GET /api/ready` (both healthy).
5. Smoke-check the learner + staff entry points (`/`, `/login`, `/staff/login`).
6. Present.

(This is documentation only — do not build deployment automation for it.)

Alternatively, for the **fresh-learner** flow you can simply register a brand-new phone each demo (leaves the DB clean).
For the **review** page, the presenter answers one objective **incorrectly** during the lesson step — that legitimately
creates the review candidate (do not fabricate review state).

## Registration / OTP delivery (SMS driver) — LOCAL QA vs STAGING

Registration and password-reset send a one-time code by SMS. Exactly **two** SMS adapters exist in the codebase; the
driver is chosen at startup by `SMS_DRIVER`:

| `SMS_DRIVER` | Adapter | Behaviour | Where it may run |
|---|---|---|---|
| `console` | `ConsoleSmsAdapter` | Logs the code as a WARN line (`[IZLAN DEV SMS] phone=… code=NNNNNN`) — **never** returns it in any API response or UI | **DEV / LOCAL QA ONLY.** The factory **throws at startup when `NODE_ENV=production`**, so a production process can never select it and can never print codes. |
| unset / anything else | `UnavailableSmsAdapter` | Sends nothing; returns `TEMPORARY_FAILURE` → the OTP endpoint answers **`503 AUTH_SMS_UNAVAILABLE`** | The **production-safe default**. |

**There is no real SMS provider adapter** (no Twilio / Eskiz / Play Mobile / etc. branch). **Production-capable SMS is
NOT available yet.** Adding one is a code change (a new adapter + a `SMS_DRIVER` value + its provider env vars) — out of
scope here.

What this means for the two runtimes:

- **LOCAL QA (`NODE_ENV=development`):** set `SMS_DRIVER=console` in the **local, gitignored `.env`** to exercise the
  genuine `register → OTP request → verify → login` flow end-to-end. Read the code from the dev backend log. **Never
  commit `.env`; never print the code; never surface it in the UI.** (This is exactly how the fresh-learner
  register→onboarding→placement→roadmap path is QA'd locally.)
- **INVESTOR STAGING APP (mode B, `NODE_ENV=production`):** `SMS_DRIVER=console` is **forbidden** (the app will not
  start). So **live account registration on staging requires a real SMS provider to be configured first** — which does
  not exist yet.

**Investor-presentation registration policy (until a real provider exists):** do **not** demonstrate live account
registration on the `NODE_ENV=production` staging app. Registration may be **described** as implemented, but the live
demo uses the **seeded FRESH LEARNER** account: `login → onboarding → placement → roadmap → daily plan`. **Never** fake
OTP success, **never** expose the OTP in the UI, and **never** weaken the production SMS guard to make registration
appear to work. Console SMS is **never** recommended for the deployed staging runtime.

## Staging readiness classification

| Item | Status |
|---|---|
| Migrations (`prisma migrate deploy`) | CONFIG ONLY |
| Mode-A seed step: non-production `NODE_ENV` + `ALLOW_INVESTOR_DEMO` + `ALLOW_DEMO_SEED` + `ALLOW_DEV_FIXTURE` (all three) | CONFIG ONLY |
| `db:seed:system` + `db:prepare:investor-demo` | READY (commands exist) |
| JWT keypair, issuer, audience | CONFIG ONLY (generate keys, keep private key out of repo) |
| `NEXT_PUBLIC_API_BASE_URL`, `CORS_ORIGINS`, `AUTH_COOKIE_SECURE=true`, `TRUST_PROXY=true`, HTTPS | CONFIG ONLY |
| Web + backend build/start, `/api/health`, `/api/ready` | READY |
| Real SMS provider for **live registration** on the production staging app | NOT IMPLEMENTED (no provider adapter; use seeded fresh-learner login for the demo, or add an adapter first) |
| DB snapshot/restore for repeatable demos | CONFIG ONLY (ops step) |
| Dashboards, monitoring, immediate-suspension hardening, index tuning, load testing | POST-DEMO HARDENING |

**No engineering blockers.** Staging is configuration + seeding + (optional) curriculum import.

## Do not

Do not weaken production guards for convenience. Do not commit `.env`, passwords, or JWT keys. Do not print secrets. Do
not run the demo seeds with `NODE_ENV=production` (they will refuse). Do not deploy the fresh feature areas that are
still "Tez orada". Do not set `SMS_DRIVER=console` on the `NODE_ENV=production` app (dev/local-QA only — it refuses to
start). Do not demonstrate live registration on staging until a real SMS provider adapter exists; do not fake OTP,
expose it in the UI, or weaken the SMS guard.
