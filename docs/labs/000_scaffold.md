# Lab 000 — Monorepo Scaffold

**Goal**: Rebuild Phase 0 of Macroracle from scratch. By the end you will understand every
structural decision in the repo — not by reading code, but by making the same decisions
yourself and running into the same walls the original author hit.

This lab does not hand you answers. It gives you the problem, some progressive hints, and
a checkpoint to prove your solution works. The reference implementation is always in the
repo if you get truly stuck — but try at least 30 minutes on each challenge before looking.

---

## Concepts

### npm Workspaces

A monorepo is a single repository containing multiple packages that can depend on each
other. Without workspaces you would `npm install` in every subdirectory separately and
manage inter-package references by hand (brittle, easy to forget, painful on CI).

npm Workspaces (built into npm 7+) lets you declare all packages in a root
`package.json` under a `"workspaces"` key. `npm install` at the root then:

1. Installs all dependencies across every package into a single `node_modules` at the
   root (hoisted), saving disk space and ensuring a single version of shared deps.
2. Creates symlinks inside `node_modules` for your own workspace packages, so
   `import { foo } from '@macroracle/core'` resolves to `packages/core/src/index.ts`
   without publishing to npm.

The tradeoff: hoisting can cause "phantom dependency" bugs where a package accidentally
uses a dep it didn't declare. The fix is strict `package.json` declarations — if your
code imports it, declare it.

### TypeScript Strict Mode and `tsconfig.base.json`

`"strict": true` in TypeScript enables a basket of checks: `strictNullChecks`,
`noImplicitAny`, `strictFunctionTypes`, and more. The important one for a nutrition app
is `strictNullChecks` — it forces you to handle `null | undefined` explicitly instead of
letting them silently propagate and crash at runtime (which is exactly what you don't
want when reading a user's macro target).

A `tsconfig.base.json` at the root holds the shared compiler options. Each package then
has its own `tsconfig.json` that `extends` the base and adds only what is unique to that
package (e.g., `"lib": ["DOM"]` for the web app, `"module": "CommonJS"` for the API).
This prevents drift where one package silently uses looser settings than another.

### Vitest

Vitest is a test runner built on Vite. It uses the same module resolution and TypeScript
transform as the rest of the build, so imports that work in the app work in tests with no
extra config. It is dramatically faster than Jest for TypeScript projects because it skips
the separate Babel/ts-jest compilation step.

All packages in Macroracle use Vitest. The root `package.json` wires up `npm test` to
run all workspace tests in one shot.

### The Migration Ledger Pattern

When your app has a database, you need a way to evolve its schema over time without
destroying data. The naive approach: keep a folder of `.sql` files and run them all on
startup. The problem: how do you know which ones have already run? Running them again
would at best error (CREATE TABLE that already exists) and at worst corrupt data.

The ledger pattern solves this with a table in the database itself:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename  TEXT PRIMARY KEY,
    run_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Before running a migration file, the runner checks whether `filename` is in this table.
If it is, skip. If it isn't, run the SQL in a transaction and insert the filename into
the ledger on success. If the SQL fails, the transaction rolls back and the ledger row
is never inserted, so the file will be retried next time.

This is idempotent (safe to run twice), deterministic (always runs files in alphabetical
order), and self-documenting (you can query the table to see migration history).

### Express Factory Function Pattern

The naive way to write an Express app: create the `app` and `server` in a module-level
variable and `export` it. The test imports it, the same server starts, and now your test
is coupled to a live database connection string baked into the module.

The factory pattern instead exports `createApp(pool)` — a function that takes a database
pool as an argument and returns a configured Express app. Tests call
`createApp(fakePool)` and inject a broken or mock pool without touching the real database.
The production entry point calls `createApp(realPool)`.

This is the simplest form of dependency injection. It costs almost nothing and makes the
difference between tests you can run anywhere and tests that only work when a database is
listening on a specific port with a specific password.

---

## Challenges

Work through these in order. Each one depends on the previous.

---

### Challenge 1 — Root monorepo skeleton

**What to build**: A root `package.json` that declares two workspace globs
(`apps/*` and `packages/*`), a `tsconfig.base.json` with strict settings appropriate
for a TypeScript project that needs to run in both Node and the browser, and the
directory skeleton (`apps/web`, `apps/api`, `packages/core`, `db/migrations`,
`docs`).

**Why it matters**: Everything else in this lab lives inside this skeleton. If
workspace resolution is wrong, cross-package imports will silently fall back to
`node_modules` and you'll spend hours debugging a "works on my machine" import path.

**Your task**: Without looking at the repo, answer these questions through
experimentation:

- What is the minimum a root `package.json` needs to declare workspaces? Does it need a
  `"name"`? A `"version"`?
- What `tsconfig` options control whether TypeScript can import `"path"` aliases vs.
  real package names?
- What does `"composite": true` do in a `tsconfig`, and when would you need it?

Create the skeleton, run `npm install` at the root, and verify npm created symlinks for
your (not yet created) workspace packages.

#### Hints

1. The `"workspaces"` key takes an array of glob strings. `"apps/*"` matches any
   direct subdirectory of `apps/`. You do NOT need to list each package individually.
2. `tsconfig.base.json` is not a TypeScript concept — it's just a filename convention.
   TypeScript recognises `"extends"` in any `tsconfig.json` and will merge the base
   options. The base file itself does not need to be named `tsconfig.base.json`, but
   the convention is universal enough to follow.
3. `"composite": true` is required when one TypeScript project references another via
   `"references"`. For Phase 0 it's optional; you'll need it later when `apps/api`
   imports from `packages/core` and you want `tsc --build` to rebuild only what changed.

#### Checkpoint 1

```bash
ls apps/ packages/ db/migrations docs/
npm install
ls node_modules/@macroracle   # should be empty or not exist yet — that's fine
```

Expected: directories exist, `npm install` completes without error, no workspace
packages symlinked yet (they don't exist).

---

### Challenge 2 — `packages/core` with a typed export and a Vitest test

**What to build**: `packages/core` should be an npm package named `@macroracle/core`.
It needs a `package.json`, a `tsconfig.json` extending the base, and a source file that
exports at least one typed function or value. Then write a Vitest test that imports from
`@macroracle/core` (the package name, NOT a relative path) and asserts the export
behaves correctly.

**Why it matters**: The import path `@macroracle/core` is the one `apps/api` and
`apps/web` will use. If the test uses a relative path (`../../packages/core/src/index`)
it doesn't prove the workspace resolution works — it just proves the file exists.

**Your task**:

- What fields does `package.json` need so that TypeScript (and Node) can find the
  entry point? (Hint: `"main"`, `"types"`, and/or `"exports"` — research the
  difference.)
- Write a function in `packages/core/src/index.ts` that does something trivially
  verifiable (e.g., `greet(name: string): string`). Strong typing is the point — make
  TypeScript complain if you call it wrong.
- Write a test file `packages/core/src/index.test.ts`. Import `greet` from
  `@macroracle/core`. Write two assertions: one that passes and one that would catch a
  type error at compile time (not just at runtime).
- Run the test. If it can't find the module, that's the workspace resolution bug — fix
  the `package.json` fields, not the test.

#### Hints

1. For Vitest to resolve `@macroracle/core` from within `packages/core`'s own test,
   you may need a `vitest.config.ts` or a `resolve.alias` that maps the package name
   to `./src/index.ts`. Alternatively, in a workspace setup where npm has already
   symlinked the package, it just works — check whether your `package.json` `"main"`
   field points to the compiled output (`dist/`) or the source (`src/`). During
   development, pointing at source is simpler.
2. Vitest uses the same `tsconfig.json` as your build. If TypeScript can't find the
   module, Vitest can't either. Run `tsc --noEmit` in `packages/core` to surface type
   errors before running tests.
3. A test that proves the type system: call your function with the wrong argument type
   inside an `// @ts-expect-error` comment. If TypeScript does NOT produce an error on
   that line, the `@ts-expect-error` directive itself becomes an error — proving your
   types are strict.

#### Checkpoint 2

```bash
cd packages/core && npm test
```

Expected: Vitest reports 1 test file, all tests pass. No `Cannot find module
'@macroracle/core'` error.

---

### Challenge 3 — The migration ledger table

**What to build**: `db/migrations/0001_init.sql` — the SQL that creates the
`schema_migrations` ledger table.

**Why it matters**: Before writing the runner that uses this table, you need to
understand what the table must contain and why each column is there.

**Your task**:

- Design the table schema. What is the primary key? What does it enforce? What does
  that enforcement prevent?
- Why is `DEFAULT NOW()` on `run_at` better than having the application insert the
  timestamp? (Think about timezones, clock skew, and what the timestamp is recording.)
- Why `TIMESTAMPTZ` and not `TIMESTAMP`? What goes wrong with the latter in a
  multi-timezone deployment?
- Write the `CREATE TABLE` statement using `CREATE TABLE IF NOT EXISTS`. Why `IF NOT
  EXISTS` specifically (rather than just `CREATE TABLE`)?

The file should be pure SQL. No application logic. Run it manually against a test
database and verify the table exists.

#### Hints

1. The primary key on `filename` enforces uniqueness at the database level. If your
   runner has a bug and tries to insert the same filename twice, the database rejects
   it — the ledger cannot lie about what ran.
2. `TIMESTAMPTZ` stores the timestamp as UTC internally and converts to the session
   timezone on display. `TIMESTAMP` stores whatever the application sends, with no
   timezone info attached. In a multi-region deployment (or if a developer runs
   migrations from a different timezone than production), `TIMESTAMP` gives you
   ambiguous data. `TIMESTAMPTZ` gives you a fact.
3. `CREATE TABLE IF NOT EXISTS` makes the migration file idempotent when run in
   isolation. The runner's ledger gate also prevents double-execution, but defence in
   depth is good — if someone runs the file manually a second time, nothing breaks.

#### Checkpoint 3

```bash
psql $DATABASE_URL -f db/migrations/0001_init.sql
psql $DATABASE_URL -c "\d schema_migrations"
```

Expected: table created (first run) or notice "already exists" (second run, harmless).
`\d` shows `filename TEXT PRIMARY KEY` and `run_at TIMESTAMPTZ`.

---

### Challenge 4 — Migration runner

**What to build**: `apps/api/src/migrate.ts` — a script that:

1. Reads all `.sql` files from `db/migrations/` in alphabetical order.
2. For each file, checks whether its filename already exists in `schema_migrations`.
3. If not, runs the file's SQL inside a transaction and inserts the filename into the
   ledger within the same transaction.
4. If the SQL fails, the transaction rolls back and the filename is NOT inserted.
5. Exits 0 on success, non-zero on failure.

**Why it matters**: This runner is what makes schema changes safe and repeatable. A
migration that fails halfway should leave the database unchanged. A migration that
succeeds should never run again.

**Your task**:

- How do you read files from a directory and sort them? (The sort order must be
  deterministic across operating systems — alphabetical on filenames works because the
  files are named `0001_`, `0002_`, etc.)
- How do you run multiple SQL statements inside a single transaction using `node-postgres`
  (`pg`)? (Hint: `BEGIN` / `COMMIT` / `ROLLBACK` are SQL statements you send like any
  other query, OR you use a client from the pool rather than the pool directly.)
- What happens if the migration SQL itself contains a transaction (`BEGIN` ... `COMMIT`)?
  PostgreSQL does not support nested transactions directly — you'd need savepoints. For
  now, assume migration files do not contain their own transaction control statements.
- The runner should be callable as a standalone script (`npx ts-node src/migrate.ts`) AND
  importable as a function from test files. How do you structure the module to support
  both?

#### Hints

1. `pg.Pool` is for concurrent queries from multiple callers. For a migration runner
   that executes statements serially, acquire a single `client` with
   `pool.connect()`, use it for all queries, and release it in a `finally` block.
   This guarantees all statements in a migration run on the same connection, which is
   required for `BEGIN` / `COMMIT` to work.
2. Wrap each migration in `try { BEGIN; run SQL; INSERT INTO schema_migrations; COMMIT }
   catch { ROLLBACK; throw }`. The ledger insert is inside the same transaction as the
   migration SQL — either both succeed or both are rolled back. This is the invariant
   that makes the runner idempotent.
3. The "importable as a function" pattern: export `async function runMigrations(pool:
   Pool): Promise<void>`. At the bottom of the file, add:
   ```ts
   if (require.main === module) {
     const pool = new Pool({ connectionString: process.env.DATABASE_URL });
     runMigrations(pool).catch(err => { console.error(err); process.exit(1); });
   }
   ```
   When run directly (`node migrate.js`), `require.main === module` is true and it
   self-executes. When imported in a test, it's false and nothing auto-runs.

#### Checkpoint 4

```bash
cd apps/api && npx ts-node src/migrate.ts
psql $DATABASE_URL -c "SELECT filename FROM schema_migrations ORDER BY filename;"
```

Expected first run: migration files listed, each printed as "running 0001_init.sql".
Expected second run: "0001_init.sql already applied, skipping" (or similar). The SELECT
shows one row: `0001_init.sql`.

---

### Challenge 5 — Express factory function (`createApp`)

**What to build**: `apps/api/src/app.ts` exporting `createApp(pool: Pool): Express`.
The app should have:

- `GET /health` returning `{ status: "ok", db: "ok" }` after a successful `SELECT 1`
  query against the pool, or `{ status: "error", db: "unreachable" }` with HTTP 503 if
  the query fails.
- A separate `apps/api/src/server.ts` that creates the real pool, calls `createApp`,
  and calls `app.listen(...)`. This is the only file that has side effects (I/O) at
  module load time.

**Why it matters**: The split between `app.ts` (pure setup, no side effects) and
`server.ts` (the actual server startup) is what makes the app testable. Tests import
`createApp`, inject a pool, and call endpoints without binding a port.

**Your task**:

- `GET /health` should send an HTTP 503 when the database is unreachable, not a 500.
  Why? (Think about what a load balancer does with 503 vs. 500.)
- The factory function takes a `Pool` — but `Pool` is the `pg` type. Where does the
  type come from, and how do you import it without importing the whole `pg` runtime if
  you're in a test that mocks the pool?
- What Express middleware do you need to parse JSON request bodies? (You don't need it
  for `/health`, but you'll need it for every future endpoint — add it now.)

#### Hints

1. The `/health` handler should `await pool.query('SELECT 1')` inside a try/catch.
   Success: `res.json({ status: 'ok', db: 'ok' })`. Failure: `res.status(503).json(
   { status: 'error', db: 'unreachable' })`. Do NOT let the error propagate to Express's
   default error handler — that would produce an HTML error page, not JSON.
2. HTTP 503 "Service Unavailable" tells the load balancer to stop routing traffic to this
   instance. HTTP 500 "Internal Server Error" is ambiguous — it could mean the app itself
   is broken (bug), not the database. The distinction matters for automated health checks
   in production.
3. Import `Pool` as a type only: `import type { Pool } from 'pg'`. The `import type`
   syntax is erased entirely at compile time and produces no runtime `require('pg')` in
   the compiled output. This is useful if you ever want to provide a mock pool in tests
   without triggering the real `pg` import.

#### Checkpoint 5

```bash
cd apps/api && npm run dev   # or npx ts-node src/server.ts
curl http://localhost:3001/health
```

Expected: `{"status":"ok","db":"ok"}` with HTTP 200.

---

### Challenge 6 — Integration tests for `/health`

**What to build**: `apps/api/src/app.test.ts` with at least two test cases:

1. **Happy path**: Create a real `Pool` pointing at the `macroracle_test` database
   (from `TEST_DATABASE_URL`). Run migrations against it. Create the app with that pool.
   Call `GET /health` using `supertest`. Assert HTTP 200 and `{ status: "ok", db: "ok" }`.
2. **Broken connection**: Create a `Pool` with an invalid connection string (e.g.,
   `postgres://bad:bad@localhost:9999/nope`). Create the app with that pool. Call
   `GET /health`. Assert HTTP 503 and `{ status: "error", db: "unreachable" }`.

**Why it matters**: Unit tests mock everything and prove logic. Integration tests use
real infrastructure and prove the seams work. If your `/health` endpoint accidentally
swallows the error and returns 200 even when the DB is down, the unit test won't catch
it — only the integration test with a real broken pool will.

**Your task**:

- Why do tests use `TEST_DATABASE_URL` and NOT `DATABASE_URL`? What catastrophic thing
  could happen if they shared the same database?
- `supertest` lets you call Express routes without binding a port. How do you use it?
  (Install `supertest` and `@types/supertest`.)
- The broken-pool test will make `pg` attempt a TCP connection and time out — which can
  make the test slow. How can you make the pool fail faster? (Hint: look at `pg.Pool`
  connection timeout options.)
- After the happy-path test runs, the test database will have the `schema_migrations`
  table. The second run of the test suite should not fail because that table already
  exists. Does your migration runner handle this? (Check Checkpoint 4.)

#### Hints

1. `supertest` usage:
   ```ts
   import request from 'supertest';
   const app = createApp(pool);
   const res = await request(app).get('/health');
   expect(res.status).toBe(200);
   ```
   `supertest` handles binding and closing the port internally.
2. For the broken-pool test, pass `connectionTimeoutMillis: 1000` to the `Pool`
   constructor so it fails in 1 second instead of the default 30. Your test timeout
   in Vitest should be set higher than that (`{ timeout: 5000 }`) so the test doesn't
   time out before the connection does.
3. Use Vitest's `beforeAll` / `afterAll` hooks to create and destroy the pool once per
   test file, not once per test. Creating a new pool per test is slow and can exhaust
   file descriptors if tests run in parallel.

#### Checkpoint 6

```bash
cd apps/api && npm test
```

Expected: 2 tests pass. No "address already in use" errors. No timeout errors (if you
set the connection timeout correctly).

---

### Challenge 7 — Vite + React + TS web app with a Vitest test

**What to build**: `apps/web` as a Vite + React + TypeScript application. It needs:

- A `package.json` naming it `@macroracle/web`, with Vite and React as dependencies.
- A `tsconfig.json` extending the base, with `"lib": ["DOM", "ES2022"]` and
  `"jsx": "react-jsx"`.
- A `vite.config.ts`.
- A minimal `src/App.tsx` that renders a heading with the text "Macroracle".
- A `src/App.test.tsx` that mounts the component and asserts the heading text is present.
- `npm test` in `apps/web` should run the Vitest tests headlessly (JSDOM environment,
  no browser window).

**Why it matters**: The web app is where users will interact with the oracle. Even for a
hello-world scaffold, wiring up the test environment correctly now means you never have
to debug "why won't Vitest find React" later.

**Your task**:

- What is the difference between `vite.config.ts` and `vitest.config.ts`? Can they be
  the same file? (Hint: yes, via the `test` key in `vite.config.ts`.)
- Why does `tsconfig.json` for the web app need `"lib": ["DOM"]` when the base config
  does not? What breaks if you omit it?
- `@testing-library/react` renders components into a JSDOM environment. What is JSDOM,
  and why does it exist? (It isn't a real browser — what does it fake, and what doesn't
  it fake?)
- The test should use `@testing-library/react`'s `render` and `screen.getByRole` or
  `screen.getByText`. Why `getByRole('heading', { name: /macroracle/i })` is better
  than `getByText('Macroracle')`?

#### Hints

1. Set the Vitest environment to JSDOM in `vite.config.ts`:
   ```ts
   export default defineConfig({
     test: {
       environment: 'jsdom',
       globals: true,
       setupFiles: './src/setupTests.ts',
     },
   });
   ```
   The `setupFiles` should import `@testing-library/jest-dom/vitest` (or the
   equivalent matchers) so you get `expect(...).toBeInTheDocument()`.
2. `"jsx": "react-jsx"` in `tsconfig.json` enables the React 17+ JSX transform, which
   does NOT require `import React from 'react'` at the top of every file. If you use
   `"jsx": "react"` (the old transform), you'll get "React is not defined" errors in
   JSX files that don't import React explicitly.
3. `getByRole('heading', { name: /macroracle/i })` is better than `getByText` because
   it tests accessibility semantics, not just text. A `<div>Macroracle</div>` would
   pass `getByText` but fail `getByRole('heading', ...)` — catching the case where you
   accidentally used the wrong element type.

#### Checkpoint 7

```bash
cd apps/web && npm test
```

Expected: 1 test file, 1 test passes. The heading "Macroracle" is found in the rendered
output. No "ReferenceError: document is not defined" errors.

---

## Running the full test suite

From the repo root:

```bash
npm test
```

Expected: all packages' tests run in sequence (or in parallel if you configure the
workspaces test script with `--workspaces`). All tests pass. Zero failures.

If any package fails, the exit code from the root `npm test` is non-zero — this is what
CI uses to gate merges.

---

## Reference Solution

Do not read these until you have attempted each challenge. The reference implementation
lives in the repo at:

- Root monorepo config: `/workspace/macroracle/package.json`,
  `/workspace/macroracle/tsconfig.base.json`
- Core package: `/workspace/macroracle/packages/core/`
- Migration ledger: `/workspace/macroracle/db/migrations/0001_init.sql`
- Migration runner: `/workspace/macroracle/apps/api/src/migrate.ts`
- Express factory: `/workspace/macroracle/apps/api/src/app.ts`,
  `/workspace/macroracle/apps/api/src/server.ts`
- API tests: `/workspace/macroracle/apps/api/src/app.test.ts`
- Web app: `/workspace/macroracle/apps/web/src/App.tsx`,
  `/workspace/macroracle/apps/web/src/App.test.tsx`,
  `/workspace/macroracle/apps/web/vite.config.ts`

When you read the reference, focus on the decisions, not the syntax. Ask yourself:
"Why did they do it that way? What breaks if they hadn't?"

---

## What's Next

Phase 1 introduces the user model, authentication (JWT, httpOnly cookies), and the
daily macro target record. Before reading the Phase 1 plan, try to answer:

- Where in the monorepo does user-related business logic live — `apps/api` or
  `packages/core`? (Think about what the RN port needs to reuse.)
- What does a "daily macro target" look like as a SQL table? What are its columns, its
  primary key, its foreign key?
- Should the API store passwords in plaintext, hashed with MD5, or something else?
  Research `bcrypt` and understand why MD5 is not acceptable even if it's fast.

The goal is to arrive at Phase 1 having already thought through the design, so the plan
document is a confirmation of your thinking rather than a surprise.
