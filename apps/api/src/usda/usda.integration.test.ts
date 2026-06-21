/**
 * Integration tests for /foods/search and /usda/food/:fdcId endpoints.
 *
 * Requires a running Postgres instance reachable via TEST_DATABASE_URL.
 * Run:
 *   TEST_DATABASE_URL=postgres://... npx vitest run src/usda/usda.integration.test.ts
 *
 * Uses the migration runner (reads from db/migrations/) to apply all migrations.
 * fetch is mocked via vi.stubGlobal to avoid real USDA API calls.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
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

// ── App setup ─────────────────────────────────────────────────────────────────

process.env.JWT_SECRET = 'usda-integration-test-secret';
process.env.USDA_API_KEY = 'TEST_KEY';
const app = createApp(pool);

// ── Test user ─────────────────────────────────────────────────────────────────

const USER_EMAIL = 'usdatest@example.com';
const TEST_PASSWORD = 'testpassword123';
let userToken: string;
let userId: string;

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

// ── Mock USDA response ────────────────────────────────────────────────────────

const MOCK_USDA_RESPONSE = {
  foods: [
    {
      fdcId: 747448,
      description: 'Oats, whole grain',
      brandOwner: null,
      dataType: 'Foundation',
      foodNutrients: [
        { nutrientNumber: '208', value: 389 },
        { nutrientNumber: '203', value: 16.9 },
        { nutrientNumber: '205', value: 66.3 },
        { nutrientNumber: '204', value: 6.9 },
      ],
    },
  ],
};

// The real fetch is needed for callApp (it makes HTTP requests to 127.0.0.1).
// We wrap fetch so that:
//   - Calls to api.nal.usda.gov  → intercepted by our mock
//   - All other URLs             → pass through to the real fetch
const realFetch = global.fetch;

function stubUsdaFetch(
  handler: (url: string) => Response | null,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.nal.usda.gov')) {
        const result = handler(url);
        if (result !== null) return Promise.resolve(result);
        return Promise.reject(new Error('USDA mock returned null (simulate failure)'));
      }
      return realFetch(input, init);
    }),
  );
}

function makeUsdaOkResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function makeUsdaErrorFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('api.nal.usda.gov')) {
        return Promise.reject(new Error('Network error'));
      }
      return realFetch(input, init);
    }),
  );
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  await runMigrations();
  const u = await registerAndLogin(USER_EMAIL, TEST_PASSWORD);
  userToken = u.token;
  userId = u.id;
});

afterEach(async () => {
  await pool.query('DELETE FROM usda_foods');
  await pool.query('DELETE FROM foods WHERE user_id = $1', [userId]);
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await pool.query('DELETE FROM users WHERE email = $1', [USER_EMAIL]);
  await pool.end();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /foods/search — validation', () => {
  it('returns 400 when q is missing', async () => {
    const res = await callApp(app, 'GET', '/foods/search');
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/at least 2 characters/);
  });

  it('returns 400 when q is only 1 character', async () => {
    const res = await callApp(app, 'GET', '/foods/search?q=a');
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/at least 2 characters/);
  });
});

describe('GET /foods/search — USDA results', () => {
  it('returns usda foods with source="usda" when USDA API responds', async () => {
    stubUsdaFetch(() => makeUsdaOkResponse(MOCK_USDA_RESPONSE));

    const res = await callApp(app, 'GET', '/foods/search?q=oats');
    expect(res.status).toBe(200);

    const body = res.body as { results: Array<{ source: string; name: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0].source).toBe('usda');
    expect(body.results[0].name).toBe('Oats, whole grain');
  });

  it('places personal food first when authenticated user has a matching food', async () => {
    // Create personal food for this user (no USDA mock needed for POST /foods).
    const createRes = await callApp(app, 'POST', '/foods', {
      body: {
        name: 'Oats',
        calories_per_100g: 380,
        protein_g: 13,
        carbs_g: 68,
        fat_g: 7,
      },
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(createRes.status).toBe(201);

    stubUsdaFetch(() => makeUsdaOkResponse(MOCK_USDA_RESPONSE));

    const res = await callApp(app, 'GET', '/foods/search?q=oats', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(res.status).toBe(200);

    const body = res.body as { results: Array<{ source: string }> };
    expect(body.results.length).toBeGreaterThanOrEqual(1);
    expect(body.results[0].source).toBe('personal');
  });

  it('uses cache on second search — USDA fetch not called second time', async () => {
    let usdaCallCount = 0;
    stubUsdaFetch(() => {
      usdaCallCount += 1;
      return makeUsdaOkResponse(MOCK_USDA_RESPONSE);
    });

    // First search — hits USDA API and populates cache.
    const res1 = await callApp(app, 'GET', '/foods/search?q=oats');
    expect(res1.status).toBe(200);
    expect(usdaCallCount).toBe(1);

    // Second search — should use cache, not call USDA again.
    const res2 = await callApp(app, 'GET', '/foods/search?q=oats');
    expect(res2.status).toBe(200);

    const body2 = res2.body as { results: Array<{ source: string }> };
    expect(body2.results).toHaveLength(1);
    expect(body2.results[0].source).toBe('usda');
    // USDA was only called once total (for the first search)
    expect(usdaCallCount).toBe(1);
  });

  it('returns 200 with warnings when USDA is down and no cache exists', async () => {
    makeUsdaErrorFetch();

    const res = await callApp(app, 'GET', '/foods/search?q=oats');
    expect(res.status).toBe(200);

    const body = res.body as { results: unknown[]; warnings?: string[] };
    expect(body.results).toHaveLength(0);
    expect(body.warnings).toBeDefined();
    expect(body.warnings!.length).toBeGreaterThan(0);
    expect(body.warnings![0]).toMatch(/unavailable/i);
  });
});

describe('GET /foods/search — source filter', () => {
  it('returns 401 for source=personal without auth', async () => {
    const res = await callApp(app, 'GET', '/foods/search?q=oats&source=personal');
    expect(res.status).toBe(401);
  });
});

describe('GET /usda/food/:fdcId', () => {
  it('returns 200 from cache when usda_foods row exists and is fresh', async () => {
    // Seed cache directly.
    await pool.query(
      `INSERT INTO usda_foods (fdc_id, description, brand_owner, data_type, nutrients, cached_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        '123',
        'Oats, whole grain',
        null,
        'Foundation',
        JSON.stringify([
          { nutrientNumber: '208', value: 389 },
          { nutrientNumber: '203', value: 16.9 },
          { nutrientNumber: '205', value: 66.3 },
          { nutrientNumber: '204', value: 6.9 },
        ]),
      ],
    );

    // USDA fetch should NOT be called — this is a cache hit.
    // We still pass through non-USDA calls (needed for callApp's internal HTTP request).
    let usdaFetchCalled = false;
    stubUsdaFetch(() => {
      usdaFetchCalled = true;
      return makeUsdaOkResponse({});
    });

    const res = await callApp(app, 'GET', '/usda/food/123');
    expect(res.status).toBe(200);

    const body = res.body as { food: { fdcId: string; calories_per_100g: number } };
    expect(body.food.fdcId).toBe('123');
    expect(body.food.calories_per_100g).toBe(389);
    expect(usdaFetchCalled).toBe(false);
  });

  it('returns 400 for a non-numeric fdcId', async () => {
    const res = await callApp(app, 'GET', '/usda/food/invalid-id');
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/numeric/);
  });
});
