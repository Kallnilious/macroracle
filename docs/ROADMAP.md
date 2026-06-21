# Macroracle Roadmap

Each phase gets a full plan in docs/plans/NNN_*.md and user sign-off BEFORE code, and a
hands-on lab in docs/labs/NNN_*.md AFTER it ships (so the user can rebuild it themselves).
Discipline: commit often, push often, test often. A phase is not done until its lab exists.

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
