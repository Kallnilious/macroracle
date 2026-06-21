# Phase 3 — Personal Foods CRUD

Status: **APPROVED**

---

## Goal

Users can create, read, update, and delete their own custom foods. Each food stores
macronutrients per 100 g as the canonical unit. Custom foods form the PERSONAL layer of
the three-tier food data model — they shadow lower layers (USDA in Phase 4, Open Food
Facts in Phase 8) and are always checked first by the decision engine's resolver.

This phase ships the ability to build a personal food library. It does not yet integrate
with logs or the decision engine — that comes in Phase 5 (food logging).

---

## Scope

### IN

- `foods` table (personal foods scoped to a user)
- SQL migration for `foods`
- `GET /foods` — list all foods for the authenticated user
- `GET /foods/:id` — get a single food by ID (must belong to the user)
- `POST /foods` — create a new custom food
- `PUT /foods/:id` — update a custom food (must belong to the user)
- `DELETE /foods/:id` — delete a custom food (must belong to the user; blocked if referenced in a log entry)
- All endpoints require `verifyJwt` middleware from Phase 1
- Frontend: `FoodList` and `FoodForm` components, `/foods` and `/foods/new` routes
- Validation: required macros, numeric ranges, reasonable bounds
- Integration tests: full CRUD, auth enforcement, cross-user isolation, validation errors

### OUT

- USDA FoodData Central integration (Phase 4)
- Open Food Facts / community foods (Phase 8)
- Food log entries (Phase 5)
- Serving size unit conversion (e.g. "1 cup") — Phase 5 concern
- Pagination on `GET /foods` (acceptable for v1; add when list exceeds 200 items)
- Food search / filtering (Phase 4 introduces the search layer)
- Barcode scanning
- Food images / media
- Nutritional data beyond the big 4 macros (fibre, sugar, sodium, etc.) — Phase 8

---

## Data model

```sql
-- Migration: 004_create_foods.sql

CREATE TABLE foods (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT        NOT NULL,
  brand             TEXT,                          -- nullable; e.g. "Quaker"
  calories_per_100g NUMERIC(7,2) NOT NULL CHECK (calories_per_100g >= 0 AND calories_per_100g <= 9000),
  protein_g         NUMERIC(7,2) NOT NULL CHECK (protein_g   >= 0 AND protein_g   <= 100),
  carbs_g           NUMERIC(7,2) NOT NULL CHECK (carbs_g     >= 0 AND carbs_g     <= 100),
  fat_g             NUMERIC(7,2) NOT NULL CHECK (fat_g       >= 0 AND fat_g       <= 100),
  serving_size_g    NUMERIC(7,2) CHECK (serving_size_g > 0),  -- nullable
  serving_name      TEXT,                          -- nullable; e.g. "1 cup", "1 slice"
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_foods_user_id ON foods (user_id);
CREATE INDEX idx_foods_user_name ON foods (user_id, name);
```

### Column notes

- **`name`**: not unique per user — two foods named "Chicken Breast" is allowed (the user
  may have different preparations). Duplicate detection is a UX hint, not a DB constraint.
- **`calories_per_100g`**: stored independently of the macro sum. The user supplies it; the
  app does not recompute calories from macros (different databases use different kcal factors).
  Inconsistency is the user's responsibility; the app may warn but not block.
- **`protein_g`, `carbs_g`, `fat_g`**: per 100 g. CHECKs cap at 100 g/100 g because no
  single macro can exceed the total weight of the food.
- **`serving_size_g` / `serving_name`**: optional convenience fields. The decision engine
  uses per-100 g values and scales by quantity. Serving info is display-only in v1.
- **`user_id` FK with `ON DELETE CASCADE`**: deleting a user removes all their personal
  foods (GDPR-compatible, consistent with profile cascade).
- No composite unique constraint on `(user_id, name)` — intentional per decision above.

---

## API surface

All endpoints require `Authorization: Bearer <accessToken>`. `req.user.sub` is the
`user_id` scope applied to all queries.

| Method | Path           | Request body / params                                                                                                                        | Response (success)                                        | Errors                                                                                       |
|--------|----------------|----------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------|----------------------------------------------------------------------------------------------|
| GET    | /foods         | —                                                                                                                                            | 200 `{ foods: Food[] }` (ordered by `name ASC`)           | 401 unauthenticated                                                                           |
| GET    | /foods/:id     | path: `id` (UUID)                                                                                                                            | 200 `{ food: Food }`                                      | 401; 404 not found or not owned by user                                                       |
| POST   | /foods         | `{ name, brand?, calories_per_100g, protein_g, carbs_g, fat_g, serving_size_g?, serving_name? }` | 201 `{ food: Food }`                                      | 401; 422 validation errors                                                                    |
| PUT    | /foods/:id     | same shape as POST body (all fields)                                                                                                         | 200 `{ food: Food }`                                      | 401; 404 not found or not owned; 422 validation errors                                        |
| DELETE | /foods/:id     | —                                                                                                                                            | 200 `{ message: "Food deleted" }`                         | 401; 404 not found or not owned; 409 food referenced in a log entry (cannot delete)          |

### `Food` object shape

```json
{
  "id":                "<uuid>",
  "user_id":           "<uuid>",
  "name":              "Rolled Oats",
  "brand":             null,
  "calories_per_100g": 389,
  "protein_g":         16.9,
  "carbs_g":           66.3,
  "fat_g":             6.9,
  "serving_size_g":    40,
  "serving_name":      "½ cup dry",
  "created_at":        "<iso8601>",
  "updated_at":        "<iso8601>"
}
```

### Security enforcement on GET /:id, PUT /:id, DELETE /:id

```sql
SELECT * FROM foods WHERE id = $1 AND user_id = $2
```

If no row is returned, always respond 404 (do not distinguish "does not exist" from
"exists but belongs to someone else" — prevents food ID enumeration).

### DELETE — log reference check

Before deleting, check if any `log_entries` row references this `food_id`:

```sql
SELECT 1 FROM log_entries WHERE food_id = $1 LIMIT 1
```

If a row exists, return 409 `{ error: "Food is referenced in your log and cannot be deleted" }`.
The `log_entries` table does not exist until Phase 5; skip this check until then (or add
it as a no-op stub with a TODO comment).

---

## Frontend

### Routes

| Path            | Component       | Auth required? |
|-----------------|-----------------|----------------|
| /foods          | FoodListPage    | Yes            |
| /foods/new      | FoodFormPage    | Yes            |
| /foods/:id/edit | FoodFormPage    | Yes            |

### Components

- **`FoodListPage`** — fetches `GET /foods` on mount; renders a list of `FoodCard`
  components; shows a "Add food" button linking to `/foods/new`.
- **`FoodCard`** — displays food name, brand, macros per 100 g; Edit and Delete buttons.
  Delete triggers a confirm dialog before calling `DELETE /foods/:id`. 409 responses show
  an inline message: "This food is used in your log. Remove those entries first."
- **`FoodFormPage`** — used for both create and edit. If `params.id` is present, fetches
  the food via `GET /foods/:id` and pre-fills the form; submits to `PUT /foods/:id`.
  If no `id`, form is blank; submits to `POST /foods`.
- **`FoodForm`** — controlled form component (used inside `FoodFormPage`):
  - Name: text input (required)
  - Brand: text input (optional)
  - Calories per 100 g: number input (required, ≥ 0)
  - Protein g: number input (required, ≥ 0)
  - Carbs g: number input (required, ≥ 0)
  - Fat g: number input (required, ≥ 0)
  - Serving size g: number input (optional)
  - Serving name: text input (optional)
  - Submit button: "Save Food"
  - Cancel button: navigates back to `/foods`
- **`useFoods`** hook — manages list fetch, optimistic delete, and navigation after
  create/update.

### State

- Food list lives in `FoodListPage` local state (no global store yet).
- After successful create/update, navigate to `/foods`.
- After successful delete, remove the item from local state optimistically; restore on
  409 or network error.
- Field-level validation errors rendered inline from 422 response body.

---

## Algorithms

No complex algorithms in this phase. The only logic is:

### Macro consistency warning (non-blocking)

The app may warn (but not block) if the macros imply a calorie count materially
different from `calories_per_100g`:

```
computed_kcal = (protein_g * 4) + (carbs_g * 4) + (fat_g * 9)
if abs(computed_kcal - calories_per_100g) > 20:
  warn("Calorie count doesn't match your macros. Using your entered value.")
```

This is a frontend-only, non-blocking UX hint. The stored `calories_per_100g` is always
the user's entered value.

---

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| `name` is empty string | 422 `{ fields: { name: "Name is required" } }` |
| `name` is very long (> 200 chars) | 422 field error |
| Negative macro values | 422; CHECK constraint is a backstop |
| macro_g > 100 (per 100 g) | 422 field error; CHECK constraint backstop |
| `calories_per_100g` > 9000 | 422 field error (max realistic value is ~900 kcal/100g for pure fat) |
| `serving_size_g` provided without `serving_name` | Allow (warn in UX but do not block) |
| `serving_name` provided without `serving_size_g` | Allow similarly |
| GET /foods with empty library | 200 `{ foods: [] }` — not a 404 |
| GET /foods/:id with invalid UUID format | 422 or 400 before DB query |
| User attempts to GET/PUT/DELETE another user's food | 404 (not 403, to prevent enumeration) |
| DELETE food referenced in log | 409 with explanatory message |
| DB down | 500, propagated through error handler |
| `updated_at` staleness | Application sets `updated_at = NOW()` in every UPDATE statement |

---

## Test plan

### Integration tests (`apps/api/src/__tests__/foods.test.ts`, against `macroracle_test` DB)

For all tests: register a user, log in, use the access token. Where isolation tests are
needed, register a second user with their own token.

| Test | Steps | Assertion |
|------|-------|-----------|
| POST /foods — happy path | POST valid food body | 201, response has `food.id` (UUID), all fields echoed |
| POST /foods — missing name | POST without `name` | 422 with `fields.name` error |
| POST /foods — missing calories | POST without `calories_per_100g` | 422 |
| POST /foods — negative protein | POST with `protein_g: -1` | 422 |
| POST /foods — protein > 100 | POST with `protein_g: 101` | 422 |
| POST /foods — unauthenticated | No auth header | 401 |
| GET /foods — empty | GET before creating any foods | 200 `{ foods: [] }` |
| GET /foods — populated | Create 2 foods, GET | 200, both foods in list, ordered by name |
| GET /foods/:id — own food | Create food, GET by id | 200, correct food |
| GET /foods/:id — other user's food | Create as user A, GET as user B | 404 |
| GET /foods/:id — non-existent | GET with random UUID | 404 |
| PUT /foods/:id — update name | Create food, PUT with new name | 200, name updated, `updated_at` changed |
| PUT /foods/:id — other user's food | Create as user A, PUT as user B | 404 |
| PUT /foods/:id — validation error | PUT with `fat_g: -5` | 422 |
| DELETE /foods/:id — happy path | Create food, DELETE | 200 message |
| DELETE /foods/:id — already deleted | Delete twice | 404 on second attempt |
| DELETE /foods/:id — other user's food | Create as user A, DELETE as user B | 404 |
| User isolation — list | User A and B each create foods; each GETs their list | Each user sees only their own foods |

---

## Migration / rollback

### Forward

Run after Phase 1 and Phase 2 migrations:
1. `004_create_foods.sql` — creates `foods` table and indexes

### Rollback

```sql
DROP TABLE IF EXISTS foods;
```

If `log_entries` (Phase 5) has been migrated, the FK from `log_entries.food_id` to
`foods.id` must be dropped first:

```sql
ALTER TABLE log_entries DROP CONSTRAINT IF EXISTS log_entries_food_id_fkey;
DROP TABLE IF EXISTS foods;
```

---

## Open questions

1. **Duplicate name UX**: should the frontend warn the user if they create a food with the
   same name as an existing personal food? A "Did you mean X?" hint would be useful but is
   not required for v1. Mark for Phase 5.

2. **Soft delete vs. hard delete**: the decision to block DELETE when a food is referenced
   in a log entry (409) means users can be stuck with a food they dislike. Should we add
   a soft-delete (`deleted_at`) so the food is hidden but log integrity is preserved?
   Leaning toward soft delete but deferring the decision until Phase 5 when log entries
   exist and we can evaluate the UX impact.

3. **Calorie / macro inconsistency tolerance**: the `>20 kcal` warning threshold is
   arbitrary. Should it be a percentage (e.g., > 5% of entered calories)? To be decided
   in implementation; document the chosen value in an ADR.

4. **Pagination**: `GET /foods` returns all foods for a user. With a large personal library
   this could be a heavy payload. Add a `limit` + `offset` or cursor-based pagination in
   Phase 4 or 5 when search is introduced. Do not implement now.

5. **`ON DELETE CASCADE` for foods when user is deleted**: the FK `user_id REFERENCES
   users(id) ON DELETE CASCADE` means deleting a user deletes all their foods. This is
   the intended GDPR behavior. Confirm with the user before Phase 7 (auth hardening)
   adds account deletion.
