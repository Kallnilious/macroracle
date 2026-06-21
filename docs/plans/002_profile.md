# Phase 2 — User Profile & Macro Targets

Status: **APPROVED**

---

## Goal

Allow users to fill in their physical profile (age, sex, height, weight, activity level,
goal). The app calculates their Total Daily Energy Expenditure (TDEE) using the
Mifflin-St Jeor BMR formula multiplied by an activity factor, then derives daily macro
targets (protein, carbs, fat, total calories). The calculation logic lives in
`packages/core` so it is reusable by the React Native port without modification.

The profile is the foundation for the decision engine — no profile, no prophecy.

---

## Scope

### IN

- `profiles` table (one row per user, upserted)
- SQL migration for `profiles`
- `GET /profile` — return current user's profile + calculated targets
- `PUT /profile` — create or update profile (upsert)
- Mifflin-St Jeor TDEE formula + activity multipliers in `packages/core`
- Macro split calculation (protein 30%, carbs 45%, fat 25% of adjusted TDEE) in `packages/core`
- `ProfileForm` React component with all fields + live target preview after save
- Unit tests for TDEE formula and macro split in `packages/core`
- Integration tests for GET/PUT profile endpoints

### OUT

- Weight history / trend tracking (Phase 6 — metabolic recalibration)
- Body fat percentage, LBM-based protein targets
- Multiple goal modes beyond cut/maintain/bulk
- Micronutrient targets (vitamins, minerals)
- Meal timing / intermittent fasting windows
- Calorie cycling / refeed days
- Imperial unit input (we store metric; UI conversion is a future nicety)

---

## Data model

```sql
-- Migration: 003_create_profiles.sql

CREATE TYPE sex_enum AS ENUM ('male', 'female');

CREATE TYPE activity_level_enum AS ENUM (
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extra_active'
);

CREATE TYPE goal_enum AS ENUM ('cut', 'maintain', 'bulk');

CREATE TABLE profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age            INTEGER NOT NULL CHECK (age >= 13 AND age <= 120),
  sex            sex_enum NOT NULL,
  height_cm      NUMERIC(5,1) NOT NULL CHECK (height_cm >= 50 AND height_cm <= 300),
  weight_kg      NUMERIC(5,2) NOT NULL CHECK (weight_kg >= 20 AND weight_kg <= 500),
  activity_level activity_level_enum NOT NULL,
  goal           goal_enum NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Notes:
- PK is `user_id` (not a surrogate key) because there is exactly one profile per user.
- `CHECK` constraints are a backstop against garbage data; primary validation happens in
  the application layer with descriptive error messages.
- `updated_at` must be maintained by the application on every PUT (no trigger in v1;
  add trigger if update volume warrants it).
- No `id` column — `user_id` is the natural PK for a 1:1 relation.

---

## API surface

All endpoints require `Authorization: Bearer <accessToken>` (via `verifyJwt` middleware
from Phase 1). `req.user.sub` is used as the `user_id` for all DB operations.

| Method | Path      | Request body                                                                                           | Response 200                                             | Errors                                                                          |
|--------|-----------|--------------------------------------------------------------------------------------------------------|----------------------------------------------------------|---------------------------------------------------------------------------------|
| GET    | /profile  | —                                                                                                      | `{ profile, targets }` (see shapes below)               | 401 unauthenticated; 404 profile not found                                      |
| PUT    | /profile  | `{ age, sex, height_cm, weight_kg, activity_level, goal }` | `{ profile, targets }`                                   | 401 unauthenticated; 422 validation error with field-level messages             |

### Response shape — `profile`

```json
{
  "user_id": "<uuid>",
  "age": 30,
  "sex": "male",
  "height_cm": 175.0,
  "weight_kg": 80.0,
  "activity_level": "moderately_active",
  "goal": "maintain",
  "created_at": "<iso8601>",
  "updated_at": "<iso8601>"
}
```

### Response shape — `targets`

```json
{
  "bmr":          1748,
  "tdee":         2709,
  "adjusted_kcal": 2709,
  "protein_g":    203,
  "carbs_g":      305,
  "fat_g":        75
}
```

All values are integers (rounded). The frontend displays them; the decision engine
consumes them to determine remaining macro budget.

### PUT upsert semantics

`PUT /profile` performs an `INSERT ... ON CONFLICT (user_id) DO UPDATE SET ...`.
This means a first `PUT` creates the profile and subsequent `PUT`s update it. There
is no separate `POST /profile`.

---

## Frontend

### Routes

| Path      | Component    | Auth required? |
|-----------|--------------|----------------|
| /profile  | ProfilePage  | Yes            |

### Components

- `ProfilePage` — wraps `ProfileForm`; fetches existing profile on mount (GET /profile);
  if 404, renders blank form; if 200, pre-fills form with existing values and shows
  current targets below the form.
- `ProfileForm` — controlled form with fields:
  - Age: number input (13–120)
  - Sex: radio buttons (`male` / `female`)
  - Height: number input in cm (50–300)
  - Weight: number input in kg (20–500)
  - Activity level: select dropdown (5 options with human-readable labels)
  - Goal: select dropdown (`cut` / `maintain` / `bulk` with kcal delta shown)
  - Submit button: "Save Profile"
- `MacroTargets` — read-only display card shown after successful save:
  - BMR, TDEE, Adjusted Calories
  - Protein / Carbs / Fat in grams with percentage labels
- `useProfile` hook — manages fetch/submit state, calls GET on mount, PUT on submit,
  updates displayed targets from response.

### State

- No global state for profile in this phase. `ProfilePage` owns the profile and targets
  locally via `useProfile`.
- On successful PUT, targets update in-place without a page reload.
- Form validation errors are displayed inline (field-level, from API 422 response).

---

## Algorithms

All formulas live in `packages/core/src/tdee.ts`. No DOM, no Node-only APIs.

### Mifflin-St Jeor BMR

```
function calculateBMR(params: { sex, weight_kg, height_cm, age }): number
  if sex === "male":
    bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) + 5
  else:  // female
    bmr = (10 * weight_kg) + (6.25 * height_cm) - (5 * age) - 161
  return Math.round(bmr)
```

### Activity multipliers

| activity_level    | Multiplier | Description                                      |
|-------------------|------------|--------------------------------------------------|
| sedentary         | 1.200      | Little or no exercise                            |
| lightly_active    | 1.375      | Light exercise 1–3 days/week                     |
| moderately_active | 1.550      | Moderate exercise 3–5 days/week                  |
| very_active       | 1.725      | Hard exercise 6–7 days/week                      |
| extra_active      | 1.900      | Very hard exercise + physical job or 2x training |

### TDEE calculation

```
function calculateTDEE(bmr: number, activity_level: ActivityLevel): number
  multipliers = { sedentary: 1.2, lightly_active: 1.375, moderately_active: 1.55,
                  very_active: 1.725, extra_active: 1.9 }
  return Math.round(bmr * multipliers[activity_level])
```

### Goal adjustment

```
GOAL_ADJUSTMENTS = { cut: -500, maintain: 0, bulk: +300 }

function adjustForGoal(tdee: number, goal: Goal): number
  return tdee + GOAL_ADJUSTMENTS[goal]
```

### Macro split

Target ratios: protein 30%, carbs 45%, fat 25% of `adjusted_kcal`.

```
function calculateMacros(adjusted_kcal: number): MacroTargets
  protein_kcal = adjusted_kcal * 0.30
  carbs_kcal   = adjusted_kcal * 0.45
  fat_kcal     = adjusted_kcal * 0.25

  return {
    protein_g: Math.round(protein_kcal / 4),   // protein: 4 kcal/g
    carbs_g:   Math.round(carbs_kcal   / 4),   // carbs:   4 kcal/g
    fat_g:     Math.round(fat_kcal     / 9),   // fat:     9 kcal/g
  }
```

### Orchestrating function (exported from packages/core)

```
function computeTargets(profile: Profile): Targets
  bmr           = calculateBMR(profile)
  tdee          = calculateTDEE(bmr, profile.activity_level)
  adjusted_kcal = adjustForGoal(tdee, profile.goal)
  macros        = calculateMacros(adjusted_kcal)
  return { bmr, tdee, adjusted_kcal, ...macros }
```

### Worked example (verification)

Male, 30 years, 175 cm, 80 kg, moderately_active, maintain:
- BMR = (10 × 80) + (6.25 × 175) − (5 × 30) + 5 = 800 + 1093.75 − 150 + 5 = **1748.75 → 1749**
- TDEE = 1749 × 1.55 = **2710.95 → 2711**
- Adjusted = 2711 + 0 = **2711**
- Protein = 2711 × 0.30 / 4 = **203 g**
- Carbs = 2711 × 0.45 / 4 = **305 g**
- Fat = 2711 × 0.25 / 9 = **75 g**

Tests should assert these exact values to pin the formula.

---

## Edge cases & failure modes

| Case | Handling |
|------|----------|
| GET /profile with no profile in DB | 404 `{ error: "Profile not found" }` — frontend renders blank form |
| PUT with missing required field | 422 `{ error: "Validation failed", fields: { age: "required" } }` |
| PUT with age outside 13–120 | 422 with field error "Age must be between 13 and 120" |
| PUT with weight outside 20–500 | 422 with field error |
| PUT with height outside 50–300 | 422 with field error |
| PUT with invalid enum value (e.g. sex: "other") | 422 — enum validated in app layer before DB insert |
| Very low adjusted_kcal (e.g. cut on sedentary tiny person) | Floor at 1200 kcal for females, 1500 kcal for males — warn the user; do not refuse |
| Unauthenticated request | 401 from verifyJwt middleware, never reaches profile handler |
| DB constraint violation (e.g. CHECK fails) | Catch pg error code 23514, return 422 — should not happen if app validation is correct |
| `computeTargets` called with null/undefined fields | Throw a typed `ValidationError` in packages/core — never return NaN |

---

## Test plan

### Unit tests (`packages/core/src/__tests__/tdee.test.ts`)

| Test | Input | Expected output |
|------|-------|-----------------|
| BMR male | weight=80, height=175, age=30, sex=male | 1749 |
| BMR female | weight=60, height=165, age=25, sex=female | 1414 |
| BMR boundary — minimum viable (female, 13yo, 50kg, 150cm) | age=13, sex=female, weight=50, height=150 | 1152 |
| TDEE sedentary | bmr=1749, activity=sedentary | 2099 |
| TDEE extra_active | bmr=1749, activity=extra_active | 3323 |
| Goal cut adjustment | tdee=2711, goal=cut | 2211 |
| Goal bulk adjustment | tdee=2711, goal=bulk | 3011 |
| Macro split at 2711 kcal | adjusted=2711 | protein=203, carbs=305, fat=75 |
| computeTargets full — male maintain | (30, male, 175, 80, moderately_active, maintain) | bmr=1749, tdee=2711, protein=203, carbs=305, fat=75 |
| computeTargets — female cut | (25, female, 165, 60, lightly_active, cut) | verify formula against hand calculation |
| Low-calorie floor warning | sedentary female cut with very small stats | adjusted >= 1200 |
| NaN guard | weight=NaN | throws ValidationError |

### Integration tests (`apps/api/src/__tests__/profile.test.ts`, against `macroracle_test` DB)

| Test | Steps | Assertion |
|------|-------|-----------|
| GET /profile — no profile | Register user, GET /profile | 404 |
| PUT /profile — create | Register user, PUT /profile with valid body | 201/200, response has `profile` and `targets` |
| GET /profile — after create | Register, PUT, GET | 200, profile matches what was PUT |
| PUT /profile — update | PUT once, PUT again with different weight | 200, updated_at changes, targets recalculate |
| PUT /profile — missing age | PUT without `age` field | 422 with field error `age` |
| PUT /profile — invalid sex enum | PUT with `sex: "robot"` | 422 |
| PUT /profile — age out of range | PUT with `age: 5` | 422 |
| GET /profile — unauthenticated | No Authorization header | 401 |
| PUT /profile — unauthenticated | No Authorization header | 401 |
| User isolation | Register two users, each PUTs own profile, each GETs only their own | Each user gets their own profile |

---

## Migration / rollback

### Forward

Run in order (after Phase 1 migrations have been applied):
1. `003_create_profiles.sql` — creates enums and `profiles` table

### Rollback

```sql
DROP TABLE IF EXISTS profiles;
DROP TYPE IF EXISTS goal_enum;
DROP TYPE IF EXISTS activity_level_enum;
DROP TYPE IF EXISTS sex_enum;
```

Enums must be dropped after the table that uses them. Rollback destroys all profile data.

---

## Open questions

1. **Calorie floor**: should the 1200/1500 kcal floor be a hard error (422), a soft
   warning returned alongside the targets, or silently applied? Leaning toward soft
   warning in the response body so the user is informed but not blocked.

2. **Imperial unit support**: the spec is metric-only storage. Should the ProfileForm
   accept lbs/inches and convert before sending, or is metric-only input acceptable for
   v1? Deferring but noting here — the API contract is metric either way.

3. **Macro split flexibility**: the 30/45/25 split is hardcoded. Should users be able to
   customise their split (e.g., higher protein for strength athletes)? Out of scope for
   v1 but the `computeTargets` signature should accept an optional `macroRatios` override
   parameter to make this easy to add later.

4. **Profile update triggers weight log**: Phase 6 (metabolic recalibration) needs a
   weight history. Should `PUT /profile` with a new `weight_kg` also insert a row into a
   future `weight_logs` table? Flag this as a Phase 6 concern — do not implement now,
   but avoid overwriting the weight field in a way that loses history.

5. **`updated_at` trigger vs. application**: for now the application sets `updated_at =
   NOW()` in the UPDATE statement. Should we add a Postgres trigger for correctness?
   Deferred — a trigger is cleaner but adds migration complexity. Revisit in Phase 3+.
