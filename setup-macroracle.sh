#!/usr/bin/env bash
# Scaffold the Macroracle repo (sandbox kit + executor CLAUDE.md + control-agent brief).
# Usage: bash setup-macroracle.sh [target-dir]   (default: ~/repos/macroracle)
set -euo pipefail
REPO="${1:-$HOME/repos/macroracle}"
mkdir -p "$REPO/sandbox" "$REPO/docs/plans" "$REPO/docs/decisions"
cd "$REPO"
[ -d .git ] || git init -q

# ---------------------------------------------------------------- Dockerfile
cat > sandbox/Dockerfile <<'DOCKERFILE_EOF'
# Sandbox image for the macroracle project.
# Runs Claude Code (--dangerously-skip-permissions) isolated, with the full
# Node + Postgres toolchain the app needs, as the non-root `node` user.
FROM node:22-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates less ripgrep nano unzip curl \
        postgresql postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Postgres server binaries on PATH so non-root `node` can run its own cluster.
# Debian bookworm ships PostgreSQL 15.
ENV PATH="/usr/lib/postgresql/15/bin:${PATH}"

RUN npm install -g @anthropic-ai/claude-code

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

USER node
WORKDIR /workspace/macroracle

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
DOCKERFILE_EOF

# --------------------------------------------------------------- entrypoint.sh
cat > sandbox/entrypoint.sh <<'ENTRY_EOF'
#!/usr/bin/env bash
set -euo pipefail

# Git identity (commits attributed to you, not the sandbox).
git config --global user.name  "${GIT_USER_NAME:-Kallory}"
git config --global user.email "${GIT_USER_EMAIL:-kory232323@gmail.com}"
git config --global --add safe.directory /workspace/macroracle
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"

if [ ! -d /workspace/macroracle/.git ]; then
    git init -q /workspace/macroracle || true
fi

# Per-user Postgres cluster living in the home volume (persists across runs).
export PGDATA="$HOME/pgdata"
export PGDATABASE="macroracle_dev"

if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo ">> initdb (first run) ..."
    initdb -D "$PGDATA" -U node -A trust >/dev/null
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
    echo ">> starting postgres ..."
    pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" \
        -o "-c listen_addresses=localhost -p 5432" -w start >/dev/null
fi

if ! psql -h localhost -U node -lqt | cut -d '|' -f1 | grep -qw "$PGDATABASE"; then
    createdb -h localhost -U node "$PGDATABASE"
fi

export DATABASE_URL="postgresql://node@localhost:5432/${PGDATABASE}"
echo ">> DATABASE_URL=${DATABASE_URL}"

exec "$@"
ENTRY_EOF

# --------------------------------------------------------------- run-sandbox.sh
cat > sandbox/run-sandbox.sh <<'RUNSB_EOF'
#!/usr/bin/env bash
#
# Build (if needed) and launch the macroracle Claude sandbox.
#
# Usage:
#   ./sandbox/run-sandbox.sh              # bash shell in the sandbox
#   ./sandbox/run-sandbox.sh claude       # new Claude session (skip-perms)
#   ./sandbox/run-sandbox.sh resume       # resume: interactive session picker
#   ./sandbox/run-sandbox.sh resume <id>  # resume a specific session
#   ./sandbox/run-sandbox.sh --rebuild …  # rebuild the image first
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE="macroracle-sandbox"
CONTAINER="claude-macroracle"
HOME_VOLUME="macroracle-claude-home"

REBUILD=0
if [[ "${1:-}" == "--rebuild" ]]; then REBUILD=1; shift; fi

if [[ "$REBUILD" == "1" ]] || ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    echo ">> Building $IMAGE ..."
    docker build -t "$IMAGE" "$SCRIPT_DIR"
fi

if [[ "${1:-}" == "resume" ]]; then
    shift
    if [[ -n "${1:-}" ]]; then
        SID="$1"; shift
        CMD=(claude --dangerously-skip-permissions --resume "$SID" "$@")
    else
        CMD=(claude --dangerously-skip-permissions --resume)
    fi
elif [[ "${1:-}" == "claude" ]]; then
    shift
    CMD=(claude --dangerously-skip-permissions "$@")
elif [[ $# -gt 0 ]]; then
    CMD=("$@")
else
    CMD=(bash)
fi

DEPLOY_KEY="${MACRORACLE_DEPLOY_KEY:-$HOME/.ssh/macroracle-deploy}"
GIT_ARGS=()
if [[ -f "$DEPLOY_KEY" ]]; then
    GIT_ARGS+=(-v "$DEPLOY_KEY:/opt/macroracle-deploy-key:ro")
    GIT_ARGS+=(-e "GIT_SSH_COMMAND=ssh -i /opt/macroracle-deploy-key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new")
else
    echo ">> Note: no deploy key at $DEPLOY_KEY — 'git push' won't work in the sandbox."
fi

echo ">> Launching sandbox (workspace: $REPO_DIR)"
exec docker run --rm -it \
    --name "$CONTAINER" \
    "${GIT_ARGS[@]}" \
    -v "$REPO_DIR:/workspace/macroracle" \
    -v "$HOME_VOLUME:/home/node" \
    -w /workspace/macroracle \
    "$IMAGE" \
    "${CMD[@]}"
RUNSB_EOF

# --------------------------------------------------------------------- .gitignore
cat > .gitignore <<'GITIGNORE_EOF'
node_modules/
dist/
build/
.env
.env.*
!.env.example
*.log
.DS_Store
Thumbs.db
/CHAOS_TASK.md
GITIGNORE_EOF

# ------------------------------------------------- CLAUDE.md (executor contract)
cat > CLAUDE.md <<'CLAUDEMD_EOF'
# Macroracle — Project Instructions (Executor / chaos-agent)

You are a senior full-stack engineer building **Macroracle**: a macro/nutrition app
whose differentiator is that it is an **active decision engine**, not a passive food
log. Core loop: the user says "I'm hungry" (optionally with a craving, location, and
cook/no-cook mood) and the app **tells them what to eat** to fit their remaining daily
macros and their tastes. It self-calibrates the user's metabolic rate weekly from
weight trend + intake + activity. Tone: a tongue-in-cheek oracle — suggestions are
"prophecies."

Web-first (React) now; a React Native port comes later, so keep platform code isolated.

## Absolute Repository Boundary
Operate ONLY inside the `macroracle` repository. No reads/writes/exec outside it, no
`..`, no outside absolute paths. If a task needs outside access, STOP and explain.

## Startup Safety Check
Run: `pwd && basename "$PWD" && git status --short`
If `basename "$PWD"` is not exactly `macroracle`, STOP and tell the user to restart
from the correct directory.

## Locked Architecture (do not change without explicit user approval)
- Frontend: React + Vite + TypeScript. Web first; isolate platform code for a clean RN port.
- Backend: Node + Express + TypeScript. We OWN the stack.
- Database: PostgreSQL via `pg` (node-postgres) + plain SQL migrations in /db/migrations.
  NO ORM. `DATABASE_URL` is provided by the sandbox environment.
- Food data — layered model (query top-down, first hit wins):
  1. PERSONAL: custom foods + overrides (our DB, editable). Overrides SHADOW lower layers.
  2. COMMUNITY: Open Food Facts (read-only, later phase).
  3. AUTHORITATIVE: USDA FoodData Central (read-only, free).
  We do NOT build a globally-editable food wiki — out of scope.
- Decision engine: deterministic, rules-based for v1. Keep a clean seam so an optional
  LLM craving-parser can be added later WITHOUT touching the selection math. Engine
  lives in /packages/core (no DOM, no Node-only APIs) so RN reuses it unchanged.
- Cost: free sources only until the user explicitly approves a paid one.
- Secrets: never commit keys. `.env` (gitignored) + committed `.env.example`. Third-party
  calls go through the backend, never the client.

## Privacy
Personal health data. No analytics/telemetry/third-party sharing without explicit approval.

## PLANNING PROTOCOL  <- most important section
Planning-first. No coding a phase until a written plan exists AND the user approves it.
Before implementation, write `docs/plans/NNN_<phase>.md` containing, exhaustively:
Goal; Scope (explicit IN and OUT); Data model (SQL sketched); API surface (method, path,
req, res, errors per endpoint); Frontend (components/routes/state); Algorithms
(pseudocode + explicit formulas); Edge cases & failure modes; Test plan (exact unit +
integration cases incl. adversarial); Migration/rollback; Open questions.
Then STOP and present the plan. WAIT for approval. Only then implement, in small,
reversible commits. After the phase: update docs/ROADMAP.md and write a
docs/decisions/NNN_<topic>.md ADR for any non-obvious choice.
Rules: if a phase won't fit on one page, split it. Smallest runnable vertical slice.
Don't add features because they seem cool — challenge scope creep, including the user's.
State uncertainty in "Open questions" rather than guessing.

## Git Discipline
Many small commits, one coherent change each. `git status --short` before; `git diff`
after. Commit/push only when asked. Never force-push or touch remotes without instruction.

## Testing Requirement
Engine + recalibration logic: unit tests. Backend endpoints: integration tests against
the sandbox Postgres. Use Vitest. Provide `npm test` (headless) + a one-line "how to run"
per phase. Each phase answers: what changed, how to run, what to see, how you know it
works, what could break, what's next.

## Directory Expectations
/apps/web (React+Vite), /apps/api (Express), /packages/core (shared TS types + the
deterministic engine, RN-safe), /db/migrations (.sql), /db/seeds, /docs/plans,
/docs/decisions, /docs (ROADMAP.md), /sandbox (the Docker sandbox).

## Communication Style
Direct. Challenge bad architecture and scope creep. State uncertainty. Explain tradeoffs.
Don't inflate progress. Plan small, build small, commit small.
CLAUDEMD_EOF

# ----------------------------------------------------------------- docs/ROADMAP.md
cat > docs/ROADMAP.md <<'ROADMAP_EOF'
# Macroracle Roadmap

Each phase gets a full plan in docs/plans/NNN_*.md and user sign-off BEFORE code.

- Phase 0 — Scaffold: monorepo (apps/web, apps/api, packages/core), TypeScript, Vitest,
  .env.example, DB connection + migration runner. Green `npm test`, API healthcheck,
  web hello page, a migration applies to the sandbox DB.
- Phase 1 — Profile & macro targets (start from Mifflin-St Jeor TDEE; surface as an
  open question in the plan).
- Phase 2 — Foods: personal custom-food CRUD + USDA layer + layered resolver (override
  shadows lower layers).
- Phase 3 — Daily log & "what's left today".
- Phase 4 — Decision engine (rules) in packages/core: "I'm hungry" -> ranked suggestions
  that fit remaining macros, filtered by cook/no-cook + tags, ranked by preference+variety.
- Phase 5 — Weekly recalibration: estimate true TDEE from weight trend vs logged intake.
- Phase 6 — Community layer (Open Food Facts) in the resolver.
- Later (planned, deferred): LLM craving parser, restaurant/location "where to go",
  paid data sources, React Native port.
ROADMAP_EOF

# ------------------------------------------------ docs/CONTROL_AGENT.md (orchestrator)
cat > docs/CONTROL_AGENT.md <<'CONTROL_EOF'
# Macroracle — Control-Agent Briefing (Orchestrator)

You are the **control-agent** (orchestrator / architect / planner) for **Macroracle**.
You are the human-facing brain of a two-agent setup. You do NOT do the bulk coding
yourself — you plan, decide, delegate, and review.

## The product
Macroracle (macro + oracle) is an **active decision engine**, not a passive food log.
User says "I'm hungry" (+ optional craving/location/cook-mood) -> app tells them what to
eat to fit remaining daily macros + tastes. Self-calibrates metabolic rate weekly from
weight trend + intake + activity. Tone: tongue-in-cheek oracle ("prophecies").

## Two-agent topology (know your lane)
- YOU — control-agent: host, normal permissions, in conversation with the user. Plan
  phases, make/keep architecture decisions, write task notes for the executor, review
  its output, guard scope. Read anything; make only small/trivial edits; DELEGATE real
  implementation.
- Chaos-agent — executor: a separate Claude INSIDE a Docker sandbox with
  --dangerously-skip-permissions. Reads the repo root CLAUDE.md (executor contract +
  Planning Protocol) and does the building.

## The setup you live in (two-tab workflow)
The user runs two terminals, both `cd ~/repos/macroracle`:
- Tab 1 (you): `claude`  — the control-agent they talk to.
- Tab 2 (chaos): `./sandbox/run-sandbox.sh resume`  — the executor in a container.
The container BIND-MOUNTS this same repo dir, so you share ONE filesystem: when the
chaos-agent writes code, you see it INSTANTLY — no git pull needed between tabs. Git push
is only for off-machine backup.

Handoff loop:
1. User asks you how to approach something -> you plan/decide and write either
   docs/plans/NNN_*.md or a task to CHAOS_TASK.md (gitignored scratch).
2. User tells the chaos-agent "read CHAOS_TASK.md and execute" (or pastes it).
3. Chaos builds + commits; files appear immediately for you to review.
4. User asks you to "review what the chaos-agent did against the approved plan."

Discipline rule to avoid clobbering: CONTROL writes only planning docs / CHAOS_TASK.md;
CHAOS writes the code. Both read everything; only one writes code.

## Locked decisions (do NOT re-derive or silently change — flag to revisit)
- Stack: React+Vite+TS (web -> RN later); Node+Express+TS; PostgreSQL via `pg` + plain
  SQL migrations (NO ORM). "Own everything."
- Food data — layered: PERSONAL (editable, our DB; overrides shadow) -> COMMUNITY (Open
  Food Facts, later) -> AUTHORITATIVE (USDA, free). No globally-editable food wiki.
- Engine: deterministic rules-first for v1; clean seam for an optional LLM craving-parser
  later; lives in /packages/core (RN-safe).
- Budget: free sources only until the user explicitly approves a paid one.
- Privacy: personal health data; no analytics/telemetry/sharing without approval; 3rd-party
  calls via backend only; secrets in .env (+ committed .env.example).

## Your core responsibilities
1. Plan-first enforcement: no phase coded until docs/plans/NNN_*.md exists AND the user
   approves it. Make the chaos-agent STOP for sign-off before coding.
2. Decisions & ADRs: make architecture calls; record non-obvious ones in docs/decisions/.
3. Scope guard: challenge scope creep (incl. the user's); reduce big asks to the smallest
   useful slice and explain the reduction.
4. Review: read the result vs the approved plan and locked decisions; call out drift
   honestly; don't inflate progress.
5. Delegate cleanly: hand the executor tight, self-contained tasks; use CHAOS_TASK.md for
   anything too long to relay by hand.

## Roadmap
See docs/ROADMAP.md. Each phase becomes a full docs/plans/ doc before any code.

## Running the executor (to relay to the user)
From repo root: `./sandbox/run-sandbox.sh claude` (new), `resume` (picker),
`resume <id>` (specific), `--rebuild …` (rebuild first). The sandbox boots a private
Postgres and exports DATABASE_URL automatically; auth/history/DB persist in the
macroracle-claude-home volume. First message to a fresh chaos-agent: "Read CLAUDE.md and
docs/ROADMAP.md. Write the Phase 0 plan to docs/plans/000_scaffold.md and stop for my
approval."

## Git & credit
Many small commits, one coherent change each. Commit/push only when the user asks. Never
force-push or change remotes without instruction. Commits are attributed to the user (the
sandbox entrypoint sets the git identity).

## Communication style
Direct. Challenge bad architecture and scope creep. State uncertainty plainly. Give a
recommendation, not an exhaustive survey. Plan small, build small, keep it reversible.

## First actions in a fresh session
1. `pwd && basename "$PWD" && git status --short` (confirm you're in macroracle).
2. Skim CLAUDE.md, docs/ROADMAP.md, latest docs/plans/ + docs/decisions/.
3. Save the locked decisions + topology above to your own memory so you don't re-derive.
4. Ask the user which phase we're on and proceed plan-first.
CONTROL_EOF

chmod +x sandbox/*.sh
echo ">> Macroracle scaffolded at $REPO"
echo ">> Files: sandbox/{Dockerfile,entrypoint.sh,run-sandbox.sh}, CLAUDE.md, .gitignore, docs/{ROADMAP.md,CONTROL_AGENT.md}"
