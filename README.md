# Macroracle

**Macro + oracle.** An active nutrition *decision engine* — not a passive food log.

Tell it "I'm hungry" (optionally with a craving, your location, and whether you feel like
cooking) and Macroracle tells you *what to eat* to fit your remaining daily macros and your
tastes. It self-calibrates your metabolic rate each week from your weight trend, intake, and
activity. The tone is a tongue-in-cheek oracle — suggestions are "prophecies."

Web-first (React), with a React Native port planned later.

## Status

Early scaffolding. Built phase-by-phase, plan-first. See:

- [`docs/ROADMAP.md`](docs/ROADMAP.md) — the phased plan.
- [`docs/plans/`](docs/plans/) — the detailed plan for each phase (written and approved before any code).
- [`docs/labs/`](docs/labs/) — hands-on, challenge-based tutorials to rebuild each phase yourself.
- [`docs/decisions/`](docs/decisions/) — architecture decision records.

## Stack

React + Vite + TypeScript (web) · Node + Express + TypeScript · PostgreSQL (`pg` + plain SQL
migrations, no ORM) · a deterministic, rules-based decision engine in `packages/core`
(framework-free so the React Native port can reuse it unchanged).
