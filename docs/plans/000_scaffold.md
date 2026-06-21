# Phase 0 — Scaffold

Status: **DRAFT — awaiting user approval.** No code until approved.

## Goal
Stand up the smallest runnable vertical slice of the monorepo so every later phase has a
home: a TypeScript workspace (`apps/web`, `apps/api`, `packages/core`), Vitest wired,
`.env.example`, a Postgres connection helper, and a plain-SQL migration runner. Done means:
`npm test` is green, the API answers a healthcheck (including a real DB ping), the web app
renders a hello page, and one migration applies cleanly to the sandbox DB.

## Scope
**IN**
- npm workspaces monorepo: root `package.json` + `apps/web`, `apps/api`, `packages/core`.
- Shared `tsconfig.base.json`; per-package `tsconfig.json`. Strict mode on.
- `packages/core`: TS package, RN-safe (no DOM, no Node-only APIs), one trivial exported
  function + its Vitest test, to prove the test harness and the import path.
- `apps/api`: Express + TS. `GET /health` → returns app status + DB connectivity. A `pg`
  Pool reading `DATABASE_URL`. A migration runner script.
- `apps/web`: React + Vite + TS. A single hello page. (No API call yet — keep it inert.)
- `db/migrations/0001_init.sql`: creates a `schema_migrations` ledger table only.
- `.env.example` (committed) documenting `DATABASE_URL`; real `.env` stays gitignored.
- Root scripts: `npm test`, `npm run migrate`, plus per-app `dev`/`build`.

**OUT** (explicitly deferred)
- Any domain tables (users, foods, logs) — those belong to Phases 1+.
- Auth, sessions, the decision engine, USDA/OFF integration.
- Docker/CI changes — the sandbox already exists; we do not touch it here.
- Web↔API wiring beyond the inert hello page.
- A migration *rollback* mechanism (down-migrations) — see Open Questions.

## Data model (SQL sketch)
Only the migration ledger this phase:
```sql
-- db/migrations/0001_init.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id          TEXT PRIMARY KEY,         -- filename, e.g. '0001_init.sql'
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## API surface
| Method | Path | Req | Res (200) | Errors |
|--------|------|-----|-----------|--------|
| GET | `/health` | — | `{ status: "ok", db: "up", time: <ISO> }` | `503 { status:"degraded", db:"down" }` if `SELECT 1` fails |

No other endpoints in Phase 0.

## Frontend
- Vite React+TS app. Single route `/` → `<App>` renders "Macroracle — the oracle is
  awakening." and nothing else. No router lib yet; no API fetch.
- State: none. Component: `App.tsx` only.

## Algorithms
Migration runner (`apps/api/src/migrate.ts`), deterministic:
```
connect Pool(DATABASE_URL)
ensure schema_migrations exists (run 0001 is idempotent via IF NOT EXISTS, but ledger-gate
  all files uniformly):
read sorted list of db/migrations/*.sql (lexical order = apply order)
SELECT id FROM schema_migrations  -> applied set
for each file not in applied set, in order:
  BEGIN
    run file contents
    INSERT INTO schema_migrations(id) VALUES (filename)
  COMMIT   (on error: ROLLBACK, print file+error, exit 1)
print "applied N migration(s)" / "up to date"
```
Healthcheck: `await pool.query('SELECT 1')` in try/catch → ok vs degraded.

## Edge cases & failure modes
- `DATABASE_URL` unset → migrate + `/health` fail loudly with a clear message (not a stack
  trace dump). Test this.
- `schema_migrations` missing on first run → runner creates/gates it before applying.
- Re-running `npm run migrate` with nothing new → no-op, exit 0, "up to date".
- A migration file already recorded but partially applied previously → out of scope; we
  rely on per-file transactions so a file is all-or-nothing.
- DB down while API is up → `/health` returns 503, process stays alive.

## Test plan (Vitest)
Unit (`packages/core`):
- the trivial exported fn returns expected value (proves harness + cross-package import).
Migration runner (integration, against sandbox Postgres):
- fresh DB: running migrate applies `0001`, `schema_migrations` has exactly one row.
- second run is a no-op (still one row, exit 0).
- unset `DATABASE_URL` → non-zero exit, error mentions the missing var (adversarial).
API integration:
- `GET /health` with DB up → 200, body `db:"up"`.
- `GET /health` with DB unreachable (bad URL/closed pool) → 503, `db:"down"`.
"How to run": `npm test` (headless). Integration tests assume the sandbox's `DATABASE_URL`.

## Migration / rollback
- Forward-only this phase. Each migration runs in its own transaction, so a failing file
  rolls itself back; the ledger only records fully-applied files.
- Repo rollback = `git revert` the scaffold commits; DB rollback = drop the dev database
  (sandbox can `dropdb`/`createdb`). No down-migrations yet (Open Question).

## Open questions — RESOLVED with user (2026-06-21)
1. **Down-migrations**: ✅ forward-only + `git revert` for now (POC). Add paired up/down
   only if a future phase needs reversible schema in prod.
2. **Test DB isolation**: ✅ dedicated `macroracle_test` DB so integration tests can
   truncate freely without touching dev data. Requires a small sandbox entrypoint tweak to
   create it (see Scope IN below).
3. **Test runner**: ✅ Vitest everywhere (unit + integration).
4. **Lint/format**: ✅ ESLint + Prettier present but LENIENT — this is a POC, don't be
   strict about linting.

(Scope IN now also includes: create/connect the `macroracle_test` DB for integration tests;
minimal lenient ESLint+Prettier config.)

## Lab (post-phase deliverable)
After Phase 0 ships, write `docs/labs/000_scaffold.md`: a hands-on guide walking the user
through rebuilding the monorepo + migration runner + healthcheck from an empty repo, with
checkpoints. Phase 0 is not done until this lab exists.

---
On approval, this goes to the chaos-agent (CHAOS_TASK.md or direct relay) to implement in
small, reversible commits — committing often and pushing often, in the user's name — then we
review against this plan and the chaos-agent writes the Phase 0 lab.
