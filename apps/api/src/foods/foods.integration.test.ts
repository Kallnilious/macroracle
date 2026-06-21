/**
 * Integration tests for /foods endpoints.
 *
 * Requires a running Postgres instance reachable via TEST_DATABASE_URL.
 * Run:  TEST_DATABASE_URL=postgres://... npx vitest run src/foods/foods.integration.test.ts
 *
 * Uses the migration runner (reads from db/migrations/) to apply all migrations
 * before the suite. Cleans up foods after each test, deletes test users after all.
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

process.env.JWT_SECRET = 'foods-integration-test-secret';
const app = createApp(pool);

// ── Test users ────────────────────────────────────────────────────────────────

const USER1_EMAIL = 'foodstest1@example.com';
const USER2_EMAIL = 'foodstest2@example.com';
const TEST_PASSWORD = 'testpassword123';

let user1Token: string;
let user1Id: string;
let user2Token: string;
let user2Id: string;

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

const VALID_FOOD = {
  name: 'Chicken Breast',
  brand: 'Generic',
  calories_per_100g: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
  serving_size_g: 100,
  serving_name: '100g serving',
  tags: ['protein', 'meat'],
};

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();

  const u1 = await registerAndLogin(USER1_EMAIL, TEST_PASSWORD);
  user1Token = u1.token;
  user1Id = u1.id;

  const u2 = await registerAndLogin(USER2_EMAIL, TEST_PASSWORD);
  user2Token = u2.token;
  user2Id = u2.id;
});

afterEach(async () => {
  // Wipe foods for both test users between tests so they are fully isolated
  await pool.query('DELETE FROM foods WHERE user_id = $1 OR user_id = $2', [user1Id, user2Id]);
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1 OR email = $2', [USER1_EMAIL, USER2_EMAIL]);
  await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /foods', () => {
  it('returns empty list initially', async () => {
    const res = await callApp(app, 'GET', '/foods', { headers: authHeader(user1Token) });
    expect(res.status).toBe(200);
    expect((res.body as { foods: unknown[] }).foods).toEqual([]);
  });

  it('returns 401 without auth token', async () => {
    const res = await callApp(app, 'GET', '/foods');
    expect(res.status).toBe(401);
  });
});

describe('POST /foods', () => {
  it('creates a food and returns 201 with id', async () => {
    const res = await callApp(app, 'POST', '/foods', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(201);
    const b = res.body as { food: { id: string; name: string; calories_per_100g: number } };
    expect(b.food.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(b.food.name).toBe('Chicken Breast');
    expect(b.food.calories_per_100g).toBe(165);
  });

  it('returns 401 without auth token', async () => {
    const res = await callApp(app, 'POST', '/foods', { body: VALID_FOOD });
    expect(res.status).toBe(401);
  });

  it('returns 422 when name is missing', async () => {
    const { name: _omit, ...body } = VALID_FOOD;
    const res = await callApp(app, 'POST', '/foods', {
      body,
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { field: string }).field).toBe('name');
  });

  it('returns 422 when calories_per_100g is missing', async () => {
    const { calories_per_100g: _omit, ...body } = VALID_FOOD;
    const res = await callApp(app, 'POST', '/foods', {
      body,
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { field: string }).field).toBe('calories_per_100g');
  });

  it('returns 422 when protein_g is negative', async () => {
    const res = await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, protein_g: -1 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { field: string }).field).toBe('protein_g');
  });

  it('returns 422 when protein_g is greater than 100', async () => {
    const res = await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, protein_g: 101 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(422);
    expect((res.body as { field: string }).field).toBe('protein_g');
  });
});

describe('GET /foods/:id', () => {
  it('returns the created food', async () => {
    const create = await callApp(app, 'POST', '/foods', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    const res = await callApp(app, 'GET', `/foods/${foodId}`, {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    const b = res.body as { food: { id: string; name: string; tags: string[] } };
    expect(b.food.id).toBe(foodId);
    expect(b.food.name).toBe('Chicken Breast');
    expect(b.food.tags).toEqual(['protein', 'meat']);
  });

  it('returns 401 without auth token', async () => {
    const res = await callApp(app, 'GET', '/foods/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });
});

describe('GET /foods (after create)', () => {
  it('returns the created food in the list', async () => {
    await callApp(app, 'POST', '/foods', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });

    const res = await callApp(app, 'GET', '/foods', { headers: authHeader(user1Token) });
    expect(res.status).toBe(200);
    const b = res.body as { foods: { name: string }[] };
    expect(b.foods).toHaveLength(1);
    expect(b.foods[0].name).toBe('Chicken Breast');
  });
});

describe('PUT /foods/:id', () => {
  it('updates name and calories, reflected in response', async () => {
    const create = await callApp(app, 'POST', '/foods', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    const res = await callApp(app, 'PUT', `/foods/${foodId}`, {
      body: { ...VALID_FOOD, name: 'Grilled Chicken', calories_per_100g: 170 },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(200);
    const b = res.body as { food: { name: string; calories_per_100g: number } };
    expect(b.food.name).toBe('Grilled Chicken');
    expect(b.food.calories_per_100g).toBe(170);
  });

  it('returns 404 for a nonexistent food', async () => {
    const res = await callApp(app, 'PUT', '/foods/00000000-0000-0000-0000-000000000000', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const res = await callApp(app, 'PUT', '/foods/00000000-0000-0000-0000-000000000000', {
      body: VALID_FOOD,
    });
    expect(res.status).toBe(401);
  });
});

describe('DELETE /foods/:id', () => {
  it('returns 204 and GET returns 404 afterward', async () => {
    const create = await callApp(app, 'POST', '/foods', {
      body: VALID_FOOD,
      headers: authHeader(user1Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    const del = await callApp(app, 'DELETE', `/foods/${foodId}`, {
      headers: authHeader(user1Token),
    });
    expect(del.status).toBe(204);

    const get = await callApp(app, 'GET', `/foods/${foodId}`, {
      headers: authHeader(user1Token),
    });
    expect(get.status).toBe(404);
  });

  it('returns 404 for a nonexistent food', async () => {
    const res = await callApp(app, 'DELETE', '/foods/00000000-0000-0000-0000-000000000000', {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth token', async () => {
    const res = await callApp(app, 'DELETE', '/foods/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(401);
  });
});

describe('Cross-user isolation', () => {
  it('GET /foods/:id for another user\'s food returns 404', async () => {
    // user2 creates a food
    const create = await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, name: 'User2 Secret Food' },
      headers: authHeader(user2Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    // user1 tries to access it
    const res = await callApp(app, 'GET', `/foods/${foodId}`, {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('PUT /foods/:id for another user\'s food returns 404', async () => {
    const create = await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, name: 'User2 Secret Food' },
      headers: authHeader(user2Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    const res = await callApp(app, 'PUT', `/foods/${foodId}`, {
      body: { ...VALID_FOOD, name: 'Hacked Name' },
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /foods/:id for another user\'s food returns 404', async () => {
    const create = await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, name: 'User2 Secret Food' },
      headers: authHeader(user2Token),
    });
    const foodId = (create.body as { food: { id: string } }).food.id;

    const res = await callApp(app, 'DELETE', `/foods/${foodId}`, {
      headers: authHeader(user1Token),
    });
    expect(res.status).toBe(404);
  });

  it('GET /foods only returns the authenticated user\'s foods', async () => {
    // user1 creates one food, user2 creates another
    await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, name: 'User1 Food' },
      headers: authHeader(user1Token),
    });
    await callApp(app, 'POST', '/foods', {
      body: { ...VALID_FOOD, name: 'User2 Food' },
      headers: authHeader(user2Token),
    });

    // user1 should only see their own food
    const res = await callApp(app, 'GET', '/foods', { headers: authHeader(user1Token) });
    expect(res.status).toBe(200);
    const b = res.body as { foods: { name: string }[] };
    expect(b.foods).toHaveLength(1);
    expect(b.foods[0].name).toBe('User1 Food');
  });
});
