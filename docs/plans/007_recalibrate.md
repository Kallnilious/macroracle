# Phase 7 — Weekly Recalibration

Status: **APPROVED**

## Goal

Every Sunday night (or on manual trigger), estimate the user's true TDEE from the past
7 days of weight trend combined with logged food intake. Apply the result — with a
smoothing factor to dampen noise — to the user's macro targets. The oracle self-calibrates.

This closes the feedback loop: `log → summary → oracle → log → calibrate → better targets`.

## Scope

### IN

- `weight_logs` table for daily weigh-ins.
- `calibration_history` table to record each calibration event.
- `POST /weight` — log today's weight.
- `GET /weight` — last 30 days of weight entries.
- `POST /calibrate` — manually trigger recalibration (and the Sunday cron will call this internally).
- `GET /calibrate/history` — list past calibration events.
- Recalibration algorithm in `packages/core/src/calibrate.ts` (pure function, RN-safe).
- Minimum-data guard: require at least 4 weight entries + 5 logged days in the window.
- Smoothing: `new_tdee = 0.7 * estimated_tdee + 0.3 * current_tdee`.
- Frontend: `WeightChart` (sparkline last 30 days) and `CalibrationSummary` on a new `/weight` page.
- Unit + integration tests.

### OUT

- Automated Sunday cron job (Phase 9 infrastructure concern; `POST /calibrate` is the hook).
- Push notifications ("Your calibration is ready").
- Body-composition tracking (fat %, muscle mass) — out of scope for v1.
- Integration with wearables / Apple Health / Google Fit.
- Multi-week trend analysis beyond the 7-day window.
- Adjusting activity level multiplier (e.g., changing sedentary → active) — user sets that manually in profile.

## Data model

### Migration: `007_recalibrate.sql`

```sql
-- Daily weigh-ins
CREATE TABLE weight_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weight_kg   NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg < 500),
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes       TEXT
);

CREATE UNIQUE INDEX weight_logs_user_day
  ON weight_logs (user_id, DATE(logged_at AT TIME ZONE 'UTC'));
-- One weigh-in per user per day (UTC). Second weigh-in on the same day overwrites via
-- ON CONFLICT in the upsert (see API).

-- Calibration history
CREATE TABLE calibration_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  window_start      DATE NOT NULL,
  window_end        DATE NOT NULL,
  weight_entries    INT NOT NULL,      -- number of weight logs in window
  logged_days       INT NOT NULL,      -- number of days with at least one food log entry
  delta_kg          NUMERIC(5,3),      -- avg_weight_end - avg_weight_start; NULL if insufficient
  avg_intake_kcal   NUMERIC(8,2),      -- average daily kcal intake over logged days
  estimated_tdee    NUMERIC(8,2),      -- raw estimate before smoothing
  previous_tdee     NUMERIC(8,2),      -- profile.tdee_override (or calculated TDEE) before update
  smoothed_tdee     NUMERIC(8,2),      -- the value written to profile
  status            TEXT NOT NULL,     -- 'applied' | 'insufficient_data' | 'outlier_skipped'
  skip_reason       TEXT,              -- set if status != 'applied'
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX calibration_history_user ON calibration_history (user_id, computed_at DESC);

-- Add tdee_override to profiles if not already present (may already exist from Phase 2)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tdee_override NUMERIC(8,2) DEFAULT NULL;
-- NULL means "use Mifflin-St Jeor calculated value"; set after first calibration.
```

**Effective TDEE resolution order:**
1. `profiles.tdee_override` if not NULL (set by calibration).
2. Calculated from Mifflin-St Jeor + activity multiplier (Phase 2 formula).

## API surface

All endpoints require `Authorization: Bearer <jwt>`.

---

### `POST /weight`

Log a weight entry. One per day; second entry on the same day upserts (replaces).

**Request body:**
```json
{
  "weight_kg": 82.4,
  "logged_at": "2026-06-21T07:30:00Z",  // optional; defaults to NOW()
  "notes": "morning, after workout"      // optional
}
```

**Response `201`:**
```json
{
  "id": "uuid",
  "weight_kg": 82.4,
  "logged_at": "2026-06-21T07:30:00Z"
}
```

**Upsert SQL:**
```sql
INSERT INTO weight_logs (user_id, weight_kg, logged_at, notes)
VALUES ($1, $2, $3, $4)
ON CONFLICT (user_id, DATE(logged_at AT TIME ZONE 'UTC'))
DO UPDATE SET weight_kg = EXCLUDED.weight_kg,
              logged_at = EXCLUDED.logged_at,
              notes = EXCLUDED.notes;
```

**Errors:**
- `422 invalid_weight` — weight_kg ≤ 0 or ≥ 500.

---

### `GET /weight`

Returns the last 30 days of weight logs for the authenticated user, ordered by date ascending.

**Response `200`:**
```json
{
  "entries": [
    { "id": "uuid", "weight_kg": 82.4, "logged_at": "2026-06-21T07:30:00Z" }
  ],
  "count": 1
}
```

---

### `POST /calibrate`

Trigger recalibration for the past 7 days (ending today). Can be called manually by the
user or by an automated Sunday job.

**Request body:** Empty `{}` or omitted.

**Response `200` — calibration applied:**
```json
{
  "status": "applied",
  "delta_kg": -0.4,
  "avg_intake_kcal": 2150.3,
  "estimated_tdee": 2490.8,
  "previous_tdee": 2400.0,
  "smoothed_tdee": 2463.6,
  "message": "Your estimated TDEE is 2464 kcal/day. Targets updated."
}
```

**Response `200` — insufficient data:**
```json
{
  "status": "insufficient_data",
  "weight_entries": 2,
  "logged_days": 4,
  "missing": ["Need at least 4 weight entries (have 2)", "Need at least 5 logged days (have 4)"],
  "message": "Not enough data to calibrate. Keep logging and try again next week."
}
```

**Response `200` — outlier detected:**
```json
{
  "status": "outlier_skipped",
  "delta_kg": 1.8,
  "message": "Weight change of 1.8 kg in 7 days is outside the expected range (±1.0 kg). Calibration skipped to avoid overreacting to noise."
}
```

All cases return HTTP 200 — the calibration endpoint always "succeeds" in the sense that
it gives the user a useful response. The `status` field distinguishes outcomes.

**Errors:**
- `422 no_profile` — cannot compute baseline TDEE without a profile.

---

### `GET /calibrate/history`

Returns the last 10 calibration events for the authenticated user.

**Response `200`:**
```json
{
  "history": [
    {
      "id": "uuid",
      "window_start": "2026-06-14",
      "window_end": "2026-06-21",
      "delta_kg": -0.4,
      "avg_intake_kcal": 2150.3,
      "estimated_tdee": 2490.8,
      "previous_tdee": 2400.0,
      "smoothed_tdee": 2463.6,
      "status": "applied",
      "computed_at": "2026-06-21T22:00:00Z"
    }
  ]
}
```

## Frontend

### `WeightPage` (`apps/web/src/pages/WeightPage.tsx`)

Route: `/weight`

- **`WeightLogForm`:** weight_kg input + optional notes + submit → `POST /weight`.
- **`WeightChart`:** sparkline of last 30 days using a minimal chart library
  (recharts is acceptable; if not already in deps, use a simple SVG path to keep bundles lean).
  X-axis: dates. Y-axis: weight_kg. Highlight today's point.
- **"Calibrate Now" button:** calls `POST /calibrate`; shows result inline.
- **`CalibrationSummary`:** displays the most recent calibration from `GET /calibrate/history[0]`.
  Shows: old TDEE → new TDEE, delta_kg, avg_intake, status badge, advice text if insufficient.

### Navigation

Add `/weight` to the nav bar (Phase 9 formalises routing; stub route now).

## Algorithms

All calibration math lives in `packages/core/src/calibrate.ts`.

---

### `estimateTDEE` — main calibration function

```typescript
export interface CalibrationInput {
  weightLogs: Array<{ weight_kg: number; date: string }>  // sorted by date asc, last 7 days
  dailyIntakes: Array<{ date: string; kcal: number }>     // one entry per logged day in window
  currentTdee: number                                      // effective TDEE before calibration
}

export type CalibrationResult =
  | { status: 'applied'; delta_kg: number; avg_intake_kcal: number; estimated_tdee: number; smoothed_tdee: number }
  | { status: 'insufficient_data'; weight_entries: number; logged_days: number; missing: string[] }
  | { status: 'outlier_skipped'; delta_kg: number }

export function estimateTDEE(input: CalibrationInput): CalibrationResult {
  const { weightLogs, dailyIntakes, currentTdee } = input

  // 1. Guard: minimum data
  const missing: string[] = []
  if (weightLogs.length < 4)
    missing.push(`Need at least 4 weight entries (have ${weightLogs.length})`)
  if (dailyIntakes.length < 5)
    missing.push(`Need at least 5 logged days (have ${dailyIntakes.length})`)
  if (missing.length > 0)
    return { status: 'insufficient_data', weight_entries: weightLogs.length, logged_days: dailyIntakes.length, missing }

  // 2. Compute weight trend: average first 3 vs last 3 entries
  const sorted = [...weightLogs].sort((a, b) => a.date.localeCompare(b.date))
  const startWeights = sorted.slice(0, 3).map(w => w.weight_kg)
  const endWeights = sorted.slice(-3).map(w => w.weight_kg)
  const avgStart = startWeights.reduce((s, v) => s + v, 0) / startWeights.length
  const avgEnd   = endWeights.reduce((s, v) => s + v, 0) / endWeights.length
  const delta_kg = round2(avgEnd - avgStart)

  // 3. Outlier guard: |delta_kg| > 1.0 is physiologically unlikely in 7 days
  if (Math.abs(delta_kg) > 1.0)
    return { status: 'outlier_skipped', delta_kg }

  // 4. Compute average daily intake (only from days where the user actually logged)
  const total_kcal = dailyIntakes.reduce((s, d) => s + d.kcal, 0)
  const avg_intake_kcal = round2(total_kcal / dailyIntakes.length)

  // 5. Estimate TDEE
  // 1 kg body mass ≈ 7700 kcal surplus/deficit
  const actual_surplus_deficit = delta_kg * 7700   // kcal over the 7-day window
  const estimated_tdee = round2((total_kcal - actual_surplus_deficit) / 7)

  // 6. Sanity bounds: TDEE must be in [1000, 5000] kcal/day
  if (estimated_tdee < 1000 || estimated_tdee > 5000)
    return { status: 'outlier_skipped', delta_kg }

  // 7. Smooth: 70% new estimate, 30% current (anchored to avoid overreaction)
  const smoothed_tdee = round2(0.7 * estimated_tdee + 0.3 * currentTdee)

  return { status: 'applied', delta_kg, avg_intake_kcal, estimated_tdee, smoothed_tdee }
}
```

**On `status: 'applied'`**, the API handler:
1. Updates `profiles.tdee_override = smoothed_tdee`.
2. Recalculates macro targets from the new TDEE (same Phase 2 logic: protein = TDEE * 0.30 / 4, etc.).
3. Writes a row to `calibration_history`.

---

### `currentTdee` resolution (API handler, not core)

```typescript
function effectiveTdee(profile: Profile): number {
  return profile.tdee_override ?? calculateTdee(profile)  // Phase 2 formula
}
```

---

### Data assembly (API handler query sketch)

```sql
-- Weight logs for the past 7 days
SELECT weight_kg, DATE(logged_at)::text AS date
FROM weight_logs
WHERE user_id = $1
  AND logged_at >= NOW() - INTERVAL '7 days'
ORDER BY logged_at ASC;

-- Daily kcal intake for the past 7 days (only days with at least one entry)
SELECT DATE(le.logged_at)::text AS date,
       SUM(f.calories_per_100g * le.grams / 100) AS kcal
FROM log_entries le
JOIN foods f ON f.id = le.food_id
WHERE le.user_id = $1
  AND le.logged_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE(le.logged_at)
HAVING SUM(f.calories_per_100g * le.grams / 100) > 0  -- exclude zero-intake days
ORDER BY date ASC;
```

## Edge cases & failure modes

| Scenario | Handling |
|---|---|
| Fewer than 4 weight entries | `insufficient_data` — no calibration, user prompted to log more |
| Fewer than 5 logged days | `insufficient_data` — same |
| Weight change > 1.0 kg in 7 days | `outlier_skipped` — likely water retention / illness / scale inconsistency |
| Estimated TDEE < 1000 or > 5000 kcal | `outlier_skipped` — physiologically implausible; protect against bad data |
| Some days have zero logged intake | Those days are excluded from `avg_intake_kcal` (the SQL `HAVING` clause). If too many are excluded, `logged_days < 5` catches it. |
| User logs weight twice on same day | The unique index + upsert ensures only the latest entry for that UTC date is kept. |
| `currentTdee` is NULL (profile incomplete) | `422 no_profile` before reaching calibration logic. |
| User has never logged food | `logged_days = 0 < 5` → `insufficient_data`. |
| Profile macro targets already at smoothed_tdee | Harmless no-op; targets updated to same values. |
| Calibration triggered multiple times in one day | Writes multiple rows to `calibration_history` (no unique constraint per day); `tdee_override` is overwritten each time. Not harmful. Consider a daily unique constraint if this is annoying. |
| User switches from metric to imperial weight (future) | All storage is `weight_kg`. If an imperial input UI is added later, convert at the boundary before storing. |

## Test plan

### Unit tests — `packages/core/src/__tests__/calibrate.test.ts`

Use helper `makeInput(overrides)` for concise setup.

1. **Happy path:** 7 weight logs (sorted), 6 logged days, reasonable delta → `status: 'applied'`, `smoothed_tdee` correct to 2dp.
2. **Formula verification:** Hard-code: avg_start=80, avg_end=79.6 → delta=-0.4; intake=15052 (7*2150.3); surplus = -0.4 * 7700 = -3080; estimated_tdee = (15052 - (-3080)) / 7 = 2590.3 (verify exactly).
3. **Smoothing:** current_tdee=2400, estimated=2590 → smoothed = 0.7*2590 + 0.3*2400 = 1813 + 720 = 2533 (verify).
4. **Insufficient weight entries:** 3 weight logs → `insufficient_data`, `missing` includes weight message.
5. **Insufficient logged days:** 4 logged days → `insufficient_data`, `missing` includes days message.
6. **Both insufficient:** 2 weight + 3 days → `missing` has two entries.
7. **Outlier: weight gain > 1.0 kg:** delta = 1.2 → `outlier_skipped`.
8. **Outlier: estimated_tdee < 1000:** Construct inputs that yield TDEE = 800 → `outlier_skipped`.
9. **Outlier: estimated_tdee > 5000:** Construct inputs that yield TDEE = 5200 → `outlier_skipped`.
10. **Zero-intake days excluded:** 2 days with kcal=0 passed → verify those days don't inflate average (they should not be in `dailyIntakes` due to SQL HAVING clause; test the pure function with them absent).
11. **Exactly 4 weight entries + 5 logged days:** Minimum threshold → `applied` (boundary test).
12. **3 weight entries at the boundary:** → `insufficient_data` (one below threshold).

### Integration tests — `apps/api/src/__tests__/calibrate.test.ts`

Setup: create user, full profile.

1. `POST /weight` → 201, entry stored; `GET /weight` includes it.
2. `POST /weight` twice on same UTC day → second call upserts; `GET /weight` shows one entry for that day.
3. `POST /calibrate` with < 4 weight entries → 200 `insufficient_data`.
4. Seed 7 weight entries + 6 days of food logs via direct DB insert; `POST /calibrate` → 200 `applied`; `profiles.tdee_override` updated; `calibration_history` row created.
5. `GET /calibrate/history` after step 4 → returns 1 row with correct values.
6. `POST /calibrate` with outlier weight swing → 200 `outlier_skipped`; `profiles.tdee_override` unchanged.
7. `POST /calibrate` with no profile → 422 `no_profile`.

Run: `npm test` from repo root.

## Migration / rollback

**Apply:**
```
node apps/api/dist/db/migrate.js up
# runs 007_recalibrate.sql:
#   CREATE TABLE weight_logs
#   CREATE TABLE calibration_history
#   ALTER TABLE profiles ADD COLUMN tdee_override
```

**Rollback:**
```sql
-- 007_recalibrate_rollback.sql
DROP TABLE IF EXISTS calibration_history;
DROP TABLE IF EXISTS weight_logs;
ALTER TABLE profiles DROP COLUMN IF EXISTS tdee_override;
```

**Data risk:** Dropping `weight_logs` and `calibration_history` destroys user weight
tracking data. In production, disable the feature rather than drop. `tdee_override`
dropping reverts targets to the Mifflin-St Jeor formula — user experience degrades but
data is not lost.

## Open questions

1. **7-day window or rolling?** Currently the window is always "today − 7 days". Should it
   be "last Sunday to Saturday" to align with a weekly weigh-in habit? The `POST /calibrate`
   API is agnostic — the window could be parameterised. Deferred.

2. **7700 kcal/kg constant:** Commonly cited but it's a rough average. Fat is ~9000 kcal/kg,
   lean mass is ~1000 kcal/kg. If body composition changes significantly, this constant introduces
   error. Acceptable for v1. Document the limitation in the UI.

3. **Weeks user didn't log consistently:** If the user logged only 3 of 7 days, we get
   `insufficient_data`. This is strict. Should we interpolate missing days (carry-forward)?
   Interpolation adds complexity and may introduce more error than it removes. Current decision:
   require real data. Revisit if users frequently hit `insufficient_data`.

4. **Outlier threshold (1.0 kg):** A world-class athlete cutting for a competition might
   legitimately lose > 1 kg/week. Should this threshold be configurable per profile
   (e.g., based on activity level or goal)? Deferred.

5. **Macro split after TDEE change:** When `smoothed_tdee` updates, the API recalculates macro
   targets using the Phase 2 fixed split (protein 30%, carbs 40%, fat 30%). Should the user's
   manually set split percentages be preserved? This depends on whether Phase 2 stored the split
   or derived it. Confirm before implementing.

6. **`tdee_override` initial value:** After first calibration, the override is set. If the
   user significantly changes their activity level and wants to reset to Mifflin-St Jeor,
   there is no "clear override" endpoint yet. Add a `DELETE /calibrate/override` or a
   profile update field in Phase 9.
