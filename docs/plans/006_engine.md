# Phase 6 — Decision Engine ("I'm hungry")

Status: **APPROVED**

## Goal

User says "I'm hungry" — optionally providing a craving keyword and a cook/no-cook flag.
The engine (living in `packages/core`, DOM-free and RN-safe) reads the user's remaining
macros from Phase 5 and their available foods, scores every candidate, and returns the top 5
as **prophecies** — Macroracle's tongue-in-cheek term for food suggestions.

This is the core product differentiator. Everything before this phase was infrastructure.

## Scope

### IN

- `POST /oracle/ask` — the main prophecy endpoint.
- `GET /oracle/last` — retrieve the last prophecy for the current user.
- `tags text[]` column on `foods` (migration) and a `user_preferences` table.
- Scoring algorithm in `packages/core/src/engine.ts`: macro fit + craving match + preference
  penalty + variety bonus.
- `parseCraving` stub function in `packages/core/src/craving.ts` (clean seam for LLM later).
- Serving-size suggestion calculation.
- Rationale string generation.
- `OracleInput`, `ProphecyCard`, `OraclePage` frontend components.
- Full unit + integration test coverage.

### OUT

- LLM craving parser (the seam exists; the LLM does not).
- Restaurant / location-aware suggestions.
- Multi-food meal composition (suggesting a combination of foods — single food only in v1).
- Scheduling / "eat this at 6pm" logic.
- Persistent prophecy history beyond `last` (one row per user).
- User-initiated preference management UI (preferences are set programmatically for now;
  a settings page is Phase 9).

## Data model

### Migration: `006_engine.sql`

```sql
-- Tags on foods (array of lowercase strings, e.g. ['no_cook', 'high_protein', 'vegan'])
ALTER TABLE foods ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

-- User preferences: disliked foods and preferred tags
CREATE TABLE user_preferences (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  disliked_food_ids UUID[] NOT NULL DEFAULT '{}',
  preferred_tags   TEXT[] NOT NULL DEFAULT '{}',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Store the last prophecy per user (upsert on ask)
CREATE TABLE oracle_last (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  prophecies  JSONB NOT NULL,
  asked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**No separate `oracle_history` table in Phase 6.** `oracle_last` is a single-row-per-user
upsert. Full history can be added later if analytics are needed.

### `user_preferences` row is created (empty) on first `POST /oracle/ask` if it doesn't exist.

## API surface

All endpoints require `Authorization: Bearer <jwt>`. All responses are JSON.

---

### `POST /oracle/ask`

Ask the oracle. Returns up to 5 food prophecies ranked by score.

**Request body:**
```json
{
  "craving": "chicken",       // optional free-text craving
  "can_cook": true,           // required boolean
  "tags": ["high_protein"]    // optional additional tag filters
}
```

**Response `200`:**
```json
{
  "prophecies": [
    {
      "food_id": "uuid",
      "food_name": "Chicken Breast",
      "serving_suggestion_g": 185,
      "predicted_macros": {
        "calories": 305.75,
        "protein_g": 57.35,
        "carbs_g": 0,
        "fat_g": 6.66
      },
      "score": 0.87,
      "rationale": "Fills 90% of your remaining protein and 0% of remaining carbs."
    }
  ],
  "asked_at": "2026-06-21T15:30:00Z",
  "remaining_macros": {
    "calories": 1952.5,
    "protein_g": 118.5,
    "carbs_g": 220.0,
    "fat_g": 67.6
  }
}
```

**Special case — all macros met:**
```json
{
  "prophecies": [],
  "message": "You're on track! No prophecy needed — your macros are covered for today.",
  "remaining_macros": { "calories": -50, "protein_g": -5, "carbs_g": 10, "fat_g": -2 }
}
```

**Errors:**
- `401` — missing/invalid JWT.
- `422 no_profile` — user has no profile; cannot compute remaining macros.
- `422 no_foods` — no foods exist in the resolver for this user; cannot rank.
- `200` with `prophecies: []` and `message` — `can_cook: false` but no `no_cook`-tagged
  foods exist. Not a 4xx — the oracle answers but explains its constraint.

---

### `GET /oracle/last`

Returns the last prophecy result for the authenticated user.

**Response `200`:**
```json
{
  "prophecies": [ /* same structure as POST response */ ],
  "asked_at": "2026-06-21T15:30:00Z"
}
```

**Response `404`:** User has never asked the oracle.

---

### `GET /foods/:id/tags` and `PATCH /foods/:id/tags` (supporting endpoints)

Allow tagging foods (used from the FoodsPage and by seeds). Part of Phase 6 because tags
are needed for `can_cook` filtering.

**`PATCH /foods/:id/tags` request:**
```json
{ "tags": ["no_cook", "high_protein"] }
```
**Response `200`:** Updated food object.

## Frontend

### `OracleInput` (`apps/web/src/components/OracleInput.tsx`)

- Craving text box: placeholder "What are you craving?" (optional).
- Cook toggle: radio or toggle switch "I can cook" / "No cooking tonight".
- "Ask the Oracle" submit button.
- On submit: `POST /oracle/ask`; show loading state; on success, render `ProphecyCard` list.
- Error state: display `no_profile` / `no_foods` messages with action links.

### `ProphecyCard` (`apps/web/src/components/ProphecyCard.tsx`)

For each prophecy:
- Food name (large, prominent).
- Suggested serving in grams: "Eat **185 g**".
- Macro breakdown of that serving: protein / carbs / fat / calories.
- Rationale string (italic, tone-of-oracle flavour: "The oracle foresees…").
- Score displayed only in dev mode (via `import.meta.env.DEV`).
- "Log this" button → pre-fills `LogEntryForm` with food_id + suggested grams (navigates to /log).

### `OraclePage` (`apps/web/src/pages/OraclePage.tsx`)

- Top: current remaining macros (summary strip, fetched from `GET /log/summary`).
- Middle: `OracleInput`.
- Below input: `ProphecyCard` list (appears after ask).
- Bottom link: "What did I say last time?" → calls `GET /oracle/last` inline.
- This is the app's landing page (route `/`).

## Algorithms

All scoring logic lives in `packages/core/src/engine.ts`. No DOM imports. No Node.js APIs.
The API handler (`apps/api`) calls `rankFoods(...)` from core — it does not contain scoring logic.

---

### `parseCraving` — clean seam

```typescript
// packages/core/src/craving.ts
// v1: dumb substring match. An LLM can replace this function's body
// without touching any scoring math.
export function parseCraving(raw: string | undefined): string[] {
  if (!raw) return []
  return [raw.trim().toLowerCase()]
}
```

The return type is `string[]` (list of keywords) so an LLM version can return multiple
semantic matches. The scoring function receives `string[]`, not the raw string.

---

### `macroFitScore` — core scoring formula

```typescript
// Measures how well 100g of this food moves remaining macros toward zero.
// Returns a value in [0, 1] (approximately; can exceed 1 if food exceeds need).
function macroFitScore(food: FoodNutrients, remaining: MacroRemaining): number {
  const macros = [
    { weight: 0.5, remaining: remaining.protein_g, per100: food.protein_per_100g },
    { weight: 0.3, remaining: remaining.carbs_g,   per100: food.carbs_per_100g   },
    { weight: 0.2, remaining: remaining.fat_g,     per100: food.fat_per_100g     },
  ]

  let score = 0
  for (const m of macros) {
    if (m.remaining <= 0) continue  // this macro is already met; skip
    const contribution = Math.min(m.per100, m.remaining) / m.remaining
    score += m.weight * contribution
  }
  return score
}
// Weights sum to 1.0. Protein weighted highest because it's the hardest macro to fill.
// If all remaining macros are ≤ 0, macroFitScore returns 0 for every food
// → "all macros met" branch is triggered before ranking.
```

---

### `scoreFood` — full scoring function

```typescript
function scoreFood(
  food: Food,
  remaining: MacroRemaining,
  cravingKeywords: string[],
  canCook: boolean,
  additionalTags: string[],
  userPrefs: UserPreferences,
  recentFoodIds: Set<string>   // food_ids logged in last 7 days
): number | null {             // null = skip this food

  // Hard filter: cooking constraint
  if (!canCook && !food.tags.includes('no_cook')) return null

  // Hard filter: additional tag filters (all must match)
  for (const tag of additionalTags) {
    if (!food.tags.includes(tag)) return null
  }

  // Hard filter: disliked foods
  if (userPrefs.disliked_food_ids.includes(food.id)) return null

  const base = macroFitScore(food, remaining)

  // Craving match: +0.3 if any craving keyword appears in the food name (case-insensitive)
  const cravingScore = cravingKeywords.some(kw =>
    food.name.toLowerCase().includes(kw)
  ) ? 0.3 : 0

  // Variety bonus: +0.1 if food hasn't been logged in the last 7 days
  const varietyBonus = !recentFoodIds.has(food.id) ? 0.1 : 0

  // Preferred tags bonus: +0.05 per matching preferred tag (capped at +0.15)
  const prefBonus = Math.min(
    food.tags.filter(t => userPrefs.preferred_tags.includes(t)).length * 0.05,
    0.15
  )

  return base + cravingScore + varietyBonus + prefBonus
}
```

---

### `servingSuggestion` — how many grams to recommend

```typescript
// Suggest the grams that fill the highest-weighted depleted macro to 90%.
// Primary: protein (weight 0.5). Fallback: carbs, then fat, then calories.
// Hard cap: 500g.
function servingSuggestion(food: FoodNutrients, remaining: MacroRemaining): number {
  const candidates: Array<{ per100: number; remaining: number }> = []

  if (remaining.protein_g > 0 && food.protein_per_100g > 0)
    candidates.push({ per100: food.protein_per_100g, remaining: remaining.protein_g })
  if (remaining.carbs_g > 0 && food.carbs_per_100g > 0)
    candidates.push({ per100: food.carbs_per_100g, remaining: remaining.carbs_g })
  if (remaining.fat_g > 0 && food.fat_per_100g > 0)
    candidates.push({ per100: food.fat_per_100g, remaining: remaining.fat_g })

  if (candidates.length === 0) return 100  // fallback: standard portion

  // Use first candidate (protein-first ordering from construction order)
  const { per100, remaining: rem } = candidates[0]
  const targetGrams = (rem * 0.9 / per100) * 100
  return Math.min(Math.round(targetGrams), 500)
}
```

---

### `rationale` — human-readable explanation

```typescript
function buildRationale(
  food: FoodNutrients,
  servingG: number,
  remaining: MacroRemaining
): string {
  const factor = servingG / 100
  const pctProtein = remaining.protein_g > 0
    ? Math.round((food.protein_per_100g * factor / remaining.protein_g) * 100)
    : 0
  const pctCarbs = remaining.carbs_g > 0
    ? Math.round((food.carbs_per_100g * factor / remaining.carbs_g) * 100)
    : 0

  return `Fills ${pctProtein}% of your remaining protein and ${pctCarbs}% of remaining carbs.`
}
```

---

### `rankFoods` — top-level engine function

```typescript
// packages/core/src/engine.ts
export function rankFoods(params: {
  foods: Food[]
  remaining: MacroRemaining
  craving: string | undefined
  canCook: boolean
  tags: string[]
  userPrefs: UserPreferences
  recentFoodIds: Set<string>
}): Prophecy[] {

  // Check if all macros are already met
  const allMet = params.remaining.protein_g <= 0
    && params.remaining.carbs_g <= 0
    && params.remaining.fat_g <= 0
    && params.remaining.calories <= 0
  if (allMet) return []

  const cravingKeywords = parseCraving(params.craving)

  const scored = params.foods
    .map(food => ({
      food,
      score: scoreFood(
        food, params.remaining, cravingKeywords,
        params.canCook, params.tags, params.userPrefs, params.recentFoodIds
      )
    }))
    .filter(({ score }) => score !== null) as Array<{ food: Food; score: number }>

  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, 5).map(({ food, score }) => {
    const servingG = servingSuggestion(food, params.remaining)
    return {
      food_id: food.id,
      food_name: food.name,
      serving_suggestion_g: servingG,
      predicted_macros: computeEntryMacros(food, servingG),
      score: Math.round(score * 1000) / 1000,
      rationale: buildRationale(food, servingG, params.remaining)
    }
  })
}
```

The API handler:
1. Fetches remaining macros from `GET /log/summary` logic (shared DB query).
2. Fetches all non-deleted foods via the layered resolver.
3. Fetches recent food IDs (last 7 days of log entries for this user).
4. Calls `rankFoods(...)`.
5. Upserts result into `oracle_last`.
6. Returns response.

## Edge cases & failure modes

| Scenario | Handling |
|---|---|
| All macros already met | Return `prophecies: []` + explanatory `message`. HTTP 200. |
| No foods in DB for this user | Return `422 no_foods` before calling engine. |
| `can_cook: false` + no `no_cook` foods | Engine returns `[]`; API returns 200 with `message: "No no-cook options found — try again without the filter."` |
| All foods are disliked | Same as above — engine returns `[]`. Message: "All available foods are disliked. Try removing some preferences." |
| Single food in DB, it's already disliked | Returns `[]`. No panic. |
| Remaining macros are negative for all macros | `allMet` check catches this. |
| `protein_per_100g = 0` in food (e.g. pure carb food) | `servingSuggestion` skips that candidate, falls through to carbs. |
| All nutrient columns are 0 (bad data) | `servingSuggestion` returns fallback 100g; `macroFitScore` returns 0 for this food (won't be top 5 unless all foods are equally bad). |
| Craving string is empty string | `parseCraving("")` returns `[]`; craving score is 0 for all foods. Correct. |
| Very long craving string (injection) | `parseCraving` just lowercases it; it's never interpolated into SQL. No risk. |
| `recentFoodIds` query fails | Catch and log; fall back to empty Set (no variety bonus applied). Don't fail the whole request. |
| Foods table has 10,000 entries (future) | Linear scan in JS is fine up to ~50k foods in <10ms. If it becomes a problem, pre-filter in SQL by tag before passing to engine. |
| `oracle_last` upsert fails | Log error, but return the prophecies to the user — the last-seen store is non-critical. |

## Test plan

### Unit tests — `packages/core/src/__tests__/engine.test.ts`

Define a helper `makeFood(overrides)` and `makeRemaining(overrides)` for concise test setup.

1. **`macroFitScore`:** food with 30g protein/100g, remaining protein 60g → protein contribution = min(30,60)/60 = 0.5 → weighted 0.5 * 0.5 = 0.25. Verify exactly.
2. **`macroFitScore`:** all remaining ≤ 0 → returns 0.
3. **`macroFitScore`:** food overshoots remaining macro → `min(per100, rem)/rem = 1.0` → capped at weight for that macro.
4. **`servingSuggestion`:** 90% protein fill → verify formula: (rem * 0.9 / per100) * 100.
5. **`servingSuggestion`:** cap at 500g when protein remaining is very large.
6. **`servingSuggestion`:** all per-100g values are 0 → returns 100g fallback.
7. **`parseCraving`:** "Chicken" → `["chicken"]`. `undefined` → `[]`. `""` → `[]`.
8. **`scoreFood`:** `can_cook: false`, food has no `no_cook` tag → returns null.
9. **`scoreFood`:** food is in disliked list → returns null.
10. **`scoreFood`:** craving matches food name → score includes +0.3.
11. **`scoreFood`:** food in recentFoodIds → no variety bonus; food not in set → +0.1.
12. **`rankFoods`:** 3 foods, one is disliked, `can_cook: false` and one lacks `no_cook` → only 1 food in result.
13. **`rankFoods`:** all macros met → returns `[]`.
14. **`rankFoods`:** 10 foods, no constraints → returns exactly 5.
15. **`rankFoods`:** food with craving match outranks food with better macro fit by ≤ 0.3 → verify ordering.

### Integration tests — `apps/api/src/__tests__/oracle.test.ts`

Setup: create user, set profile, seed 3 foods (including one tagged `no_cook`), log some entries so remaining macros are non-zero.

1. `POST /oracle/ask { can_cook: true }` → 200, 3 prophecies (one per food), scores present.
2. `POST /oracle/ask { craving: "chicken", can_cook: true }` → food named "Chicken Breast" appears first.
3. `POST /oracle/ask { can_cook: false }` → only `no_cook`-tagged food appears.
4. `POST /oracle/ask { can_cook: false }` with no `no_cook` foods seeded → 200, `prophecies: []`, message present.
5. `GET /oracle/last` after a successful ask → returns same prophecies.
6. `GET /oracle/last` with no prior ask → 404.
7. `POST /oracle/ask` with no profile → 422 `no_profile`.
8. `POST /oracle/ask` with no foods in DB → 422 `no_foods`.
9. Log all macros as consumed (sum = targets), then `POST /oracle/ask` → `prophecies: []` with "on track" message.

Run: `npm test` from repo root.

## Migration / rollback

**Apply:**
```
node apps/api/dist/db/migrate.js up
# runs 006_engine.sql:
#   ALTER TABLE foods ADD COLUMN tags;
#   CREATE TABLE user_preferences;
#   CREATE TABLE oracle_last;
```

**Rollback:**
```sql
-- 006_engine_rollback.sql
DROP TABLE IF EXISTS oracle_last;
DROP TABLE IF EXISTS user_preferences;
ALTER TABLE foods DROP COLUMN IF EXISTS tags;
```

**Data risk:** Dropping `user_preferences` loses user tag/dislike preferences. Low risk in Phase 6 (feature is new). `oracle_last` is ephemeral — safe to drop.

## Open questions

1. **Weight of protein in scoring (0.5):** Arbitrary but defensible — protein is the hardest
   macro to fill and most fitness-focused users prioritise it. Should this be user-configurable
   per profile? Deferred.

2. **Craving as substring match vs. tag match:** Currently checks `food.name.includes(keyword)`.
   Should it also check `food.tags`? E.g., craving "sweet" matches tag `sweet`. Simple extension —
   decide before implementing.

3. **`oracle_last` vs. full history:** One row per user is simple. If we want "what did I eat
   this week based on oracle suggestions?" we need a history table. Phase 6 explicitly excludes
   history — revisit in Phase 9 or later.

4. **Preferred tags bonus cap (+0.15):** Is 0.15 the right ceiling? Too low and preferences
   don't matter; too high and they dominate macro fit. Tune empirically after Phase 6 ships.

5. **What counts as "recently logged" for variety bonus?** Currently 7 days. Could be
   user-configurable. 7 days is a reasonable default for weekly meal variety.

6. **`can_cook` as a per-request flag vs. a persistent preference:** Currently per-request.
   Should the user's last `can_cook` choice be remembered? Simple UX win — consider for Phase 9.
