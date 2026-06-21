/**
 * Integration tests for /log endpoints.
 *
 * Requires a running Postgres instance reachable via TEST_DATABASE_URL.
 * Run:  TEST_DATABASE_URL=postgres://... npx vitest run src/log/log.integration.test.ts
 *
 * Uses the migration runner (reads SQL files from db/migrations/) to apply all migrations
 * before the suite. Cleans up log_entries after each test, deletes test users/foods
 * in afterAll.
 *
 * Reference profile: male, 30yr, 175cm, 80kg, moderately_active, maintain
 *   → targets: 2711 kcal, 203g P, 305g C, 75g F
 * Reference food: Test Chicken (165 kcal/100g, 31g P, 0g C, 3.6g F)
 *   → 150g: { calories: 247.5, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 }
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../app.js';
import { callApp } from '../test-helpers/callApp.js';

const { Pool } = pg;

// ── DB setup ──────────────────────────────────────────────────────────────────

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!TEST_DB_URL) {
  throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set for integration tests');
}

const pool = new Pool({ connectionString: TEST_DB_URL });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../db/migrations');

async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const { rows } = await pool.query<{ id: string }>('SELECT id FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.id));

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(id) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

// ── App + JWT secret ──────────────────────────────────────────────────────────

process.env.JWT_SECRET = 'log-integration-test-secret';
const app = createApp(pool);

// ── Test identities ───────────────────────────────────────────────────────────

const USER1_EMAIL = 'logtest1@example.com';
const USER2_EMAIL = 'logtest2@example.com';
// A third user with NO profile — used only to test the 422 "no profile" case
const USER3_EMAIL = 'logtest3_noprofile@example.com';
const TEST_PASSWORD = 'testpassword123';

let user1Token: string;
let user1Id: string;
let user2Token: string;
let user2Id: string;
let user3Token: string;
let user3Id: string;

let testFoodId: string;
let user2FoodId: string;

// Reference profile (male, 30yr, 175cm, 80kg, moderately_active, maintain)
const REFERENCE_PROFILE = {
  age: 30,
  sex: 'male',
  height_cm: 175,
  weight_kg: 80,
  activity_level: 'moderately_active',
  goal: 'maintain',
};

// Expected targets for the reference profile
const EXPECTED_TARGETS = {
  calories: 2711,
  protein_g: 203,
  carbs_g: 305,
  fat_g: 75,
  tdee: 2711,
};

// Reference food
const TEST_FOOD = {
  name: 'Test Chicken',
  calories_per_100g: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
};

// Expected macros for 150g of Test Chicken
const EXPECTED_150G_MACROS = {
  calories: 247.5,
  protein_g: 46.5,
  carbs_g: 0,
  fat_g: 5.4,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function registerAndLogin(email: string, password: string) {
  const reg = await callApp(app, 'POST', '/auth/register', {
    body: { email, password },
  });
  if (reg.status !== 201 && reg.status !== 409) {
    throw new Error(`Failed to register ${email}: ${JSON.stringify(reg.body)}`);
  }

  const login = await callApp(app, 'POST', '/auth/login', {
    body: { email, password },
  });
  if (login.status !== 200) {
    throw new Error(`Failed to login ${email}: ${JSON.stringify(login.body)}`);
  }

  const body = login.body as { accessToken: string; user: { id: string } };
  return { token: body.accessToken, id: body.user.id };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();

  // Register and login all three test users
  const u1 = await registerAndLogin(USER1_EMAIL, TEST_PASSWORD);
  user1Token = u1.token;
  user1Id = u1.id;

  const u2 = await registerAndLogin(USER2_EMAIL, TEST_PASSWORD);
  user2Token = u2.token;
  user2Id = u2.id;

  const u3 = await registerAndLogin(USER3_EMAIL, TEST_PASSWORD);
  user3Token = u3.token;
  user3Id = u3.id;

  // Set profiles for user1 and user2 only (user3 intentionally has no profile)
  await callApp(app, 'PUT', '/profile', {
    body: REFERENCE_PROFILE,
    headers: authHeader(user1Token),
  });
  await callApp(app, 'PUT', '/profile', {
    body: REFERENCE_PROFILE,
    headers: authHeader(user2Token),
  });

  // Create a food for user1
  const food1Res = await callApp(app, 'POST', '/foods', {
    body: TEST_FOOD,
    headers: authHeader(user1Token),
  });
  testFoodId = (food1Res.body as { food: { id: string } }).food.id;

  // Create a food for user2 (for cross-user isolation tests)
  const food2Res = await callApp(app, 'POST', '/foods', {
    body: { ...TEST_FOOD, name: 'User2 Chicken' },
    headers: authHeader(user2Token),
  });
  user2FoodId = (food2Res.body as { food: { id: string } }).food.id;
});

afterEach(async () => {
  // Clean log entries for all test users between tests
  await pool.query(
    'DELETE FROM log_entries WHERE user_id = $1 OR user_id = $2 OR user_id = $3',
    [user1Id, user2Id, user3Id],
  );
});

afterAll(async () => {
  // Clean up in dependency order: log_entries first, then foods, profiles, users
  await pool.query(
    'DELETE FROM log_entries WHERE user_id = $1 OR user_id = $2 OR user_id = $3',
    [user1Id, user2Id, user3Id],
  );
  await pool.query(
    'DELETE FROM foods WHERE user_id = $1 OR user_id = $2 OR user_id = $3',
    [user1Id, user2Id, user3Id],
  );
  await pool.query(
    'DELETE FROM users WHERE email = $1 OR email = $2 OR email = $3',
    [USER1_EMAIL, USER2_EMAIL, USER3_EMAIL],
  );
  await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /log', () => {
  it('returns 401 without auth', async () => {
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
    });
    expect(res.status).toBe(401);
  });

  it('returns 422 when user has no profile', async () => {
    // user3 has no profile — create a food for them first so the food check
    // doesn't interfere (we need to hit the profile check, which comes first)
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
      headers: authHeader(user3Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toContain('profile');
  });

  it('returns 404 when food does not exist', async () => {
    const res = await callApp(app, 'POST', '/log', {
      body: {
        food_id: '00000000-0000-0000-0000-000000000000',
        grams: 150,
      },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 when food belongs to another user', async () => {
    // user1 tries to log user2's food
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: user2FoodId, grams: 150 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('happy path: returns 201 with correctly computed macros', async () => {
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(201);

    const b = res.body as {
      id: string;
      food_id: string;
      food_name: string;
      grams: number;
      logged_at: string;
      macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    };

    expect(b.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(b.food_id).toBe(testFoodId);
    expect(b.food_name).toBe('Test Chicken');
    expect(b.grams).toBe(150);
    expect(b.macros.calories).toBe(EXPECTED_150G_MACROS.calories);
    expect(b.macros.protein_g).toBe(EXPECTED_150G_MACROS.protein_g);
    expect(b.macros.carbs_g).toBe(EXPECTED_150G_MACROS.carbs_g);
    expect(b.macros.fat_g).toBe(EXPECTED_150G_MACROS.fat_g);
  });

  it('accepts a custom logged_at ISO string', async () => {
    const loggedAt = new Date().toISOString();
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 100, logged_at: loggedAt },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(201);
    expect((res.body as { logged_at: string }).logged_at).toBeTruthy();
  });

  it('returns 422 when grams is missing', async () => {
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { field: string }).field).toBe('grams');
  });

  it('returns 422 when grams is zero or negative', async () => {
    const res = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: -10 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /log/today', () => {
  it('returns 401 without auth', async () => {
    const res = await callApp(app, 'GET', '/log/today');
    expect(res.status).toBe(401);
  });

  it('returns empty entries list when nothing logged', async () => {
    const res = await callApp(app, 'GET', '/log/today', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    expect((res.body as { entries: unknown[] }).entries).toEqual([]);
  });

  it('returns today\'s entries after logging', async () => {
    // Log a food entry first
    await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
      headers: authHeader(user1Token),
    });

    const res = await callApp(app, 'GET', '/log/today', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    const b = res.body as { entries: { food_name: string; grams: number }[] };
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0].food_name).toBe('Test Chicken');
    expect(b.entries[0].grams).toBe(150);
  });

  it('entries include correctly computed macros', async () => {
    await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
      headers: authHeader(user1Token),
    });

    const res = await callApp(app, 'GET', '/log/today', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    const entry = (res.body as { entries: { macros: typeof EXPECTED_150G_MACROS }[] }).entries[0];
    expect(entry.macros.calories).toBe(EXPECTED_150G_MACROS.calories);
    expect(entry.macros.protein_g).toBe(EXPECTED_150G_MACROS.protein_g);
    expect(entry.macros.carbs_g).toBe(EXPECTED_150G_MACROS.carbs_g);
    expect(entry.macros.fat_g).toBe(EXPECTED_150G_MACROS.fat_g);
  });
});

describe('GET /log/summary', () => {
  it('returns 401 without auth', async () => {
    const res = await callApp(app, 'GET', '/log/summary');
    expect(res.status).toBe(401);
  });

  it('returns 422 when user has no profile', async () => {
    const res = await callApp(app, 'GET', '/log/summary', {
      headers: authHeader(user3Token),
    });
    expect(res.status).toBe(422);
  });

  it('returns targets, consumed, and remaining when no food logged', async () => {
    const res = await callApp(app, 'GET', '/log/summary', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);

    const b = res.body as {
      targets: typeof EXPECTED_TARGETS;
      consumed: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
      remaining: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    };

    // Targets match reference profile computation
    expect(b.targets.calories).toBe(EXPECTED_TARGETS.calories);
    expect(b.targets.protein_g).toBe(EXPECTED_TARGETS.protein_g);
    expect(b.targets.carbs_g).toBe(EXPECTED_TARGETS.carbs_g);
    expect(b.targets.fat_g).toBe(EXPECTED_TARGETS.fat_g);
    expect(b.targets.tdee).toBe(EXPECTED_TARGETS.tdee);

    // Nothing consumed yet
    expect(b.consumed.calories).toBe(0);
    expect(b.consumed.protein_g).toBe(0);

    // Remaining = targets (nothing consumed)
    expect(b.remaining.calories).toBe(EXPECTED_TARGETS.calories);
    expect(b.remaining.protein_g).toBe(EXPECTED_TARGETS.protein_g);
  });

  it('remaining decreases after logging a food', async () => {
    // Log 150g of Test Chicken
    await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 150 },
      headers: authHeader(user1Token),
    });

    const res = await callApp(app, 'GET', '/log/summary', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);

    const b = res.body as {
      targets: { calories: number; protein_g: number };
      consumed: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
      remaining: { calories: number; protein_g: number };
    };

    expect(b.consumed.calories).toBe(EXPECTED_150G_MACROS.calories);
    expect(b.consumed.protein_g).toBe(EXPECTED_150G_MACROS.protein_g);
    expect(b.remaining.calories).toBe(
      Math.round((EXPECTED_TARGETS.calories - EXPECTED_150G_MACROS.calories) * 100) / 100,
    );
    expect(b.remaining.protein_g).toBe(
      Math.round((EXPECTED_TARGETS.protein_g - EXPECTED_150G_MACROS.protein_g) * 100) / 100,
    );
  });
});

describe('DELETE /log/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await callApp(app, 'DELETE', '/log/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });

  it('deletes an entry and returns 204', async () => {
    const logRes = await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 100 },
      headers: authHeader(user1Token),
    });
    const entryId = (logRes.body as { id: string }).id;

    const delRes = await callApp(app, 'DELETE', `/log/${entryId}`, {
      headers: authHeader(user1Token),
    });
    expect(delRes.status).toBe(204);

    // Verify it is gone from today's list
    const todayRes = await callApp(app, 'GET', '/log/today', {
      headers: authHeader(user1Token),
    });
    const entries = (todayRes.body as { entries: { id: string }[] }).entries;
    expect(entries.find((e) => e.id === entryId)).toBeUndefined();
  });

  it('returns 404 for a non-existent entry', async () => {
    const res = await callApp(app, 'DELETE', '/log/00000000-0000-0000-0000-000000000000', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it("returns 404 when trying to delete another user's entry", async () => {
    // user2 logs a food
    const logRes = await callApp(app, 'POST', '/log', {
      body: { food_id: user2FoodId, grams: 100 },
      headers: authHeader(user2Token),
    });
    const entryId = (logRes.body as { id: string }).id;

    // user1 tries to delete user2's entry
    const delRes = await callApp(app, 'DELETE', `/log/${entryId}`, {
      headers: authHeader(user1Token),
    });
    expect(delRes.status).toBe(404);
  });
});

describe('GET /log', () => {
  it('returns 401 without auth', async () => {
    const res = await callApp(app, 'GET', '/log');
    expect(res.status).toBe(401);
  });

  it('returns today\'s entries when no date param', async () => {
    await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 200 },
      headers: authHeader(user1Token),
    });

    const res = await callApp(app, 'GET', '/log', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    const b = res.body as { entries: { grams: number }[] };
    expect(b.entries).toHaveLength(1);
    expect(b.entries[0].grams).toBe(200);
  });

  it('returns empty for a past date with no entries', async () => {
    const res = await callApp(app, 'GET', '/log?date=2024-01-01', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    expect((res.body as { entries: unknown[] }).entries).toEqual([]);
  });

  it('does not return entries from a different date', async () => {
    // Log today
    await callApp(app, 'POST', '/log', {
      body: { food_id: testFoodId, grams: 100 },
      headers: authHeader(user1Token),
    });

    // Query a specific past date — should be empty
    const res = await callApp(app, 'GET', '/log?date=2000-01-01', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    expect((res.body as { entries: unknown[] }).entries).toEqual([]);
  });
});
