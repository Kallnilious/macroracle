# Phase 4 — USDA FoodData Central + Layered Resolver

Status: **APPROVED**

---

## Goal

Add USDA FoodData Central (FDC) as the authoritative third-tier food data source. Build
the layered food resolver: PERSONAL (user's custom foods from Phase 3) wins over USDA.
A unified `/foods/search` endpoint queries both layers, merges results, and returns them
with personal results ranked first.

USDA responses are cached in a local `usda_foods` table (30-day TTL) to conserve the
free API quota (1,000 req/day) and provide partial resilience when the USDA API is
down.

---

## Scope

### IN

- `usda_foods` cache table (fdcId PK, description, nutrients jsonb, cached_at)
- SQL migration for `usda_foods`
- `GET /foods/search?q=&source=all|personal|usda` — unified search across layers
- `GET /usda/food/:fdcId` — fetch or serve-from-cache a single USDA food detail
- Layered resolver in `packages/core` (RN-safe): personal → USDA cache → USDA live
- USDA API client in `apps/api` (server-side only; key never exposed to client)
- Cache read/write/invalidation logic (30-day TTL check on `cached_at`)
- `SearchBar` and `SearchResults` frontend components; `/search` route
- `USDA_API_KEY` in `.env` / `.env.example`
- Unit tests: resolver merge logic
- Integration tests: search scenarios, USDA down graceful degradation

### OUT

- Open Food Facts / community layer (Phase 8)
- Barcode lookup via USDA (Phase 8 or later)
- Full USDA nutrient detail page (only macros extracted in this phase)
- Writing USDA foods back to the user's personal library (Phase 5 concern — "import food")
- Pagination on search results (top-20 results per layer is acceptable for v1)
- Fuzzy / semantic search (USDA FDC supports partial-string search natively)
- USDA data type filtering UI (Foundation, SR Legacy, Branded, Survey) — backend
  accepts `data_type` param from USDA but the frontend does not expose it in v1

---

## Data model

```sql
-- Migration: 005_create_usda_foods.sql

CREATE TABLE usda_foods (
  fdc_id        TEXT        PRIMARY KEY,            -- USDA fdcId (e.g. "747448")
  description   TEXT        NOT NULL,
  brand_owner   TEXT,                               -- null for non-branded foods
  data_type     TEXT        NOT NULL,               -- "Foundation", "SR Legacy", "Branded", "Survey (FNDDS)"
  nutrients     JSONB       NOT NULL,               -- full USDA nutrient array, stored as-is
  cached_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_usda_foods_description ON usda_foods USING gin(to_tsvector('english', description));
CREATE INDEX idx_usda_foods_cached_at ON usda_foods (cached_at);
```

### `nutrients` JSONB structure (subset stored from USDA response)

We store the entire USDA `foodNutrients` array as-is. At query time the resolver
extracts the four macros we need using nutrient number lookups:

| USDA Nutrient Number | Nutrient              |
|----------------------|-----------------------|
| 208                  | Energy (kcal)         |
| 203                  | Protein (g)           |
| 205                  | Carbohydrate, by diff (g) |
| 204                  | Total lipid (fat) (g) |

Storing the full `nutrients` JSONB means we can extract additional nutrients (fibre,
sodium, etc.) in future phases without re-fetching from USDA.

### Cache TTL

A cached row is considered fresh if `NOW() - cached_at < INTERVAL '30 days'`. If stale,
the resolver re-fetches from USDA and updates the row in place.

---

## API surface

`GET /foods/search` does not require authentication for USDA results (the food data is
public) but personal results require authentication. Implementation: if an Authorization
header is present and valid, include personal results; otherwise return only USDA
results. This keeps the endpoint flexible for unauthenticated browsing in future.

| Method | Path                   | Request params                                                                                   | Response 200                                                      | Errors                                                                                                          |
|--------|------------------------|--------------------------------------------------------------------------------------------------|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------|
| GET    | /foods/search          | `q` (string, required), `source` (enum: `all`\|`personal`\|`usda`, default `all`)               | `{ results: SearchResult[], warnings?: string[] }`                | 400 missing `q` or `q` < 2 chars; 401 if `source=personal` and unauthenticated                                 |
| GET    | /usda/food/:fdcId      | path: `fdcId` (string)                                                                           | `{ food: UsdaFoodDetail }`                                        | 404 not found in USDA; 503 USDA API down (if not in cache); 400 invalid fdcId format                           |

### `SearchResult` object shape

```json
{
  "id":                "<uuid or fdcId>",
  "source":            "personal" | "usda",
  "name":              "Chicken Breast, raw",
  "brand":             null,
  "calories_per_100g": 120,
  "protein_g":         22.5,
  "carbs_g":           0,
  "fat_g":             2.6,
  "fdcId":             "171477",     // null for personal foods
  "user_id":           "<uuid>",     // null for USDA foods
  "data_type":         "Foundation"  // null for personal foods
}
```

### `UsdaFoodDetail` object shape

```json
{
  "fdcId":             "171477",
  "description":       "Chicken, broiler or fryers, breast, raw",
  "brand_owner":       null,
  "data_type":         "Foundation",
  "calories_per_100g": 120,
  "protein_g":         22.5,
  "carbs_g":           0.0,
  "fat_g":             2.6,
  "cached_at":         "<iso8601>"
}
```

### USDA FDC API calls made by the backend

- **Search**: `GET https://api.nal.usda.gov/fdc/v1/foods/search?query=<q>&api_key=<key>&pageSize=20`
- **Detail**: `GET https://api.nal.usda.gov/fdc/v1/food/<fdcId>?api_key=<key>`

The API key is passed as a query parameter per USDA's spec. It is read from
`process.env.USDA_API_KEY` and never returned to the client.

---

## Frontend

### Routes

| Path    | Component    | Auth required? |
|---------|--------------|----------------|
| /search | SearchPage   | No (personal results need auth) |

### Components

- **`SearchPage`** — renders `SearchBar` and `SearchResults`; holds search state
  (`query`, `results`, `isLoading`, `error`, `warnings`).
- **`SearchBar`** — controlled text input with a "Search" button and a `source` toggle
  (All / My Foods / USDA). Fires the search on submit (not on every keystroke — avoid
  burning API quota).
- **`SearchResults`** — renders a list of `SearchResultCard` components. Shows a banner
  for any `warnings` in the response (e.g., "USDA is unavailable — showing personal
  results only").
- **`SearchResultCard`** — displays food name, source badge (personal vs USDA), macros
  per 100 g, and a source chip showing `data_type` for USDA results. In v1 there is no
  "Add to log" action here — that comes in Phase 5.

### State

- `SearchPage` owns all search state locally. No global store.
- Query is debounced at the component level (300 ms) only if we switch to live-search;
  for now, search fires on explicit submit to protect the USDA quota.
- USDA warnings are displayed inline as a non-blocking alert banner.

---

## Algorithms

### Layered resolver (pseudocode, lives in `packages/core/src/resolver.ts`)

The resolver operates on normalized `FoodResult` objects. The API handler feeds it data;
it knows nothing about HTTP or databases.

```
type FoodResult = {
  id: string
  source: "personal" | "usda"
  name: string
  brand: string | null
  calories_per_100g: number
  protein_g: number
  carbs_g: number
  fat_g: number
}

function mergeResults(
  personalResults: FoodResult[],
  usdaResults:     FoodResult[]
): FoodResult[]

  // Personal results always ranked first.
  // Deduplicate by (lowercase name + lowercase brand):
  // if a USDA result has the same name+brand as a personal result, drop the USDA one.
  // This lets a user's custom food shadow the USDA version.

  seen = new Set()

  output = []

  for food in personalResults:
    key = (food.name.toLowerCase() + "|" + (food.brand ?? "").toLowerCase())
    seen.add(key)
    output.push(food)

  for food in usdaResults:
    key = (food.name.toLowerCase() + "|" + (food.brand ?? "").toLowerCase())
    if key not in seen:
      output.push(food)

  return output
```

### USDA cache / fetch flow (API handler pseudocode, in `apps/api`)

```
async function searchUsda(query: string): Promise<FoodResult[]>

  // 1. Check cache: full-text search on usda_foods.description
  cachedRows = SELECT * FROM usda_foods
               WHERE to_tsvector('english', description) @@ plainto_tsquery('english', query)
                 AND cached_at > NOW() - INTERVAL '30 days'
               LIMIT 20

  if cachedRows.length > 0:
    return cachedRows.map(extractMacros)

  // 2. Cache miss (or all rows stale): call USDA live
  try:
    usdaResponse = await fetch(USDA_SEARCH_URL(query))
    foods = usdaResponse.foods  // array

    // 3. Upsert into cache
    for food in foods:
      INSERT INTO usda_foods (fdc_id, description, brand_owner, data_type, nutrients, cached_at)
      VALUES (...)
      ON CONFLICT (fdc_id) DO UPDATE SET
        description = EXCLUDED.description,
        nutrients   = EXCLUDED.nutrients,
        cached_at   = NOW()

    return foods.map(extractMacros)

  catch NetworkError | UsdaApiError:
    // 4. Graceful degradation: return stale cache if available, else empty
    staleRows = SELECT * FROM usda_foods
                WHERE to_tsvector('english', description) @@ plainto_tsquery('english', query)
                LIMIT 20
    warnings.push("USDA is temporarily unavailable. Showing cached results.")
    return staleRows.map(extractMacros)
```

### Nutrient extraction from USDA `nutrients` JSONB

```
MACRO_NUTRIENT_IDS = {
  calories: 208,
  protein:  203,
  carbs:    205,
  fat:      204
}

function extractMacros(usdaFood: UsdaCacheRow): FoodResult
  getNutrient = (id) =>
    usdaFood.nutrients.find(n => n.nutrientNumber === id)?.value ?? 0

  return {
    id:                usdaFood.fdc_id,
    source:            "usda",
    name:              usdaFood.description,
    brand:             usdaFood.brand_owner ?? null,
    calories_per_100g: getNutrient(208),
    protein_g:         getNutrient(203),
    carbs_g:           getNutrient(205),
    fat_g:             getNutrient(204),
    fdcId:             usdaFood.fdc_id,
    data_type:         usdaFood.data_type
  }
```

Note: USDA nutrient values are per 100 g for Foundation and SR Legacy data types.
Branded foods may use different serving sizes; in v1 we normalize to per-100 g and
log a warning for branded foods where USDA reports a non-100g serving basis.

---

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| `q` is empty or under 2 characters | 400 `{ error: "Query must be at least 2 characters" }` |
| `source=personal` with no auth token | 401 |
| USDA API is down; no cache rows | Return only personal results (if authenticated) with warning `"USDA unavailable"` |
| USDA API is down; stale cache exists | Return stale cache rows with warning `"USDA unavailable — showing cached data"` |
| USDA API rate limit hit (429) | Treat as API down; return cache with warning |
| USDA returns malformed JSON | Catch parse error; log server-side; degrade to cache or personal-only |
| USDA nutrient ID not found in response | `extractMacros` defaults missing nutrient to `0`; does not throw |
| Branded food with non-100g serving basis | Extract nutrients as-is (they are already per 100g in USDA response); add `data_type` to result for frontend display |
| `fdcId` path param is not numeric | 400 before DB or USDA query |
| Cache row exists but nutrients JSONB is malformed | Fall back to USDA live fetch; log the malformed row's `fdc_id` |
| Search returns USDA + personal food with same name | Resolver deduplicates; personal wins; USDA version is suppressed |
| No results from either layer | 200 `{ results: [] }` — not a 404 |
| USDA_API_KEY not set in environment | Fail loudly on startup: `Error: USDA_API_KEY is required` |
| Very common query (e.g. "chicken") — 20 USDA results may not include the best match | Acceptable for v1; result ranking is outside scope |

---

## Test plan

### Unit tests (`packages/core/src/__tests__/resolver.test.ts`)

| Test | Input | Expected output |
|------|-------|-----------------|
| Merge — personal only | personalResults=[A], usdaResults=[] | [A] |
| Merge — USDA only | personalResults=[], usdaResults=[B] | [B] |
| Merge — personal first | personal=[A], usda=[B] | [A, B] |
| Dedup — same name+brand | personal=[A(name="Oats",brand=null)], usda=[B(name="Oats",brand=null)] | [A only] — USDA suppressed |
| Dedup — same name, different brand | personal=[A(brand="Quaker")], usda=[B(brand="Bob's")] | [A, B] — not deduped |
| Dedup — case-insensitive | personal=[A(name="oats")], usda=[B(name="Oats")] | [A only] |
| Empty both layers | personal=[], usda=[] | [] |
| `extractMacros` — all nutrients present | USDA food with nutrients 208,203,205,204 | correct FoodResult with all macros |
| `extractMacros` — missing fat nutrient | USDA food without nutrient 204 | fat_g=0 |

### Integration tests (`apps/api/src/__tests__/usda.test.ts`, against `macroracle_test` DB)

For USDA live tests, mock the USDA HTTP calls with a test double (e.g., `nock` or
`msw`) — do not make real network calls in CI.

| Test | Steps | Assertion |
|------|-------|-----------|
| GET /foods/search — missing q | GET /foods/search | 400 |
| GET /foods/search — q too short | GET /foods/search?q=a | 400 |
| GET /foods/search — personal only (no USDA) | Mock USDA to return empty; create personal food "Oats"; search "Oats" authenticated | results has personal food, source="personal" |
| GET /foods/search — USDA only (unauthenticated) | Mock USDA to return "Chicken Breast"; GET unauthenticated | results has USDA food, source="usda" |
| GET /foods/search — both layers merged | Mock USDA "Chicken"; create personal "Chicken"; search authenticated | 2 results, personal first |
| GET /foods/search — dedup personal shadows USDA | Mock USDA with name="Oats",brand=null; personal food name="Oats",brand=null; search | 1 result, source="personal" |
| GET /foods/search — USDA caching | Mock USDA for "Oats" first call; second search "Oats" (USDA mock disabled) | second call returns cached results from DB |
| GET /foods/search — USDA down, no cache | Mock USDA to throw 503; search authenticated | 200, results=personal only, warnings includes USDA message |
| GET /foods/search — USDA down, stale cache | Seed usda_foods with stale row; mock USDA 503; search | 200, stale rows returned, warning present |
| GET /foods/search — source=personal, no auth | GET with source=personal, no token | 401 |
| GET /usda/food/:fdcId — cache hit | Seed usda_foods with fdcId="123"; GET /usda/food/123 | 200, food from cache |
| GET /usda/food/:fdcId — cache miss, USDA live | Mock USDA detail for fdcId="456"; GET /usda/food/456 | 200, food returned, row inserted in cache |
| GET /usda/food/:fdcId — not found | Mock USDA 404 for fdcId="999"; GET /usda/food/999 | 404 |
| GET /usda/food/:fdcId — invalid fdcId | GET /usda/food/not-a-number | 400 |

---

## Migration / rollback

### Forward

Run after Phases 1–3 migrations:
1. `005_create_usda_foods.sql` — creates `usda_foods` table and GIN index

### Rollback

```sql
DROP TABLE IF EXISTS usda_foods;
```

The GIN index is dropped automatically with the table. No FK dependencies from other
tables at this phase.

### Cache eviction (future maintenance)

When the cache grows large, stale rows (> 30 days) can be purged without data loss:

```sql
DELETE FROM usda_foods WHERE cached_at < NOW() - INTERVAL '30 days';
```

This is not needed in v1 but should be a scheduled task in production.

---

## Open questions

1. **USDA API key**: the free tier provides 1,000 requests/day. A single popular search
   that isn't cached counts as one request. Will this be sufficient for v1? Monitor usage
   after launch. If quota pressure arises, increase cache TTL or pre-populate the cache
   for common searches.

2. **USDA nutrient unit variations**: USDA Branded foods may report energy in kJ instead
   of kcal (nutrient ID 268 vs 208). Should we handle the kJ → kcal conversion
   (`kJ / 4.184`)? Check USDA response for `nutrientUnit` field. Flag as a v1
   correctness risk — add handling if any test foods expose it.

3. **USDA data type priority**: when USDA returns multiple results for the same food
   (e.g., Foundation + Branded versions of "Chicken Breast"), should Foundation/SR Legacy
   be ranked above Branded in the results? Leaning yes — more authoritative data types
   first. The resolver currently does not sort USDA results among themselves; this would
   be an enhancement.

4. **Cache invalidation on USDA data updates**: USDA updates their database periodically.
   A 30-day TTL means we may serve data up to 30 days stale. Is this acceptable? For
   nutrition data it is likely fine. If a user reports incorrect USDA data, we could add
   a manual cache-bust endpoint (admin only). Defer for now.

5. **GIN index on `description`**: the full-text search index speeds up cache lookups but
   the cache may be sparsely populated early on (most queries will miss and hit USDA
   live). Once the cache warms up, the index pays off. Evaluate whether the GIN index is
   worth the overhead at low cache fill rates — it almost certainly is.

6. **Rate limiting the search endpoint**: if `/foods/search` is hammered, it could exhaust
   the USDA quota quickly. Should we add per-user rate limiting (e.g., 60 searches/min)
   on this endpoint? Recommend adding basic rate limiting in this phase given the hard
   USDA quota ceiling.
