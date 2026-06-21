/**
 * Integration tests for /profile endpoints.
 *
 * Runs against the TEST_DATABASE_URL (macroracle_test DB).
 * Each test authenticates as a dedicated test user and cleans up after itself.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import pg from 'pg';
import { createApp } from '../app.js';
import { callApp } from '../test-helpers/callApp.js';

// ── DB setup ─────────────────────────────────────────────────────────────────

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '';

if (!TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL (or DATABASE_URL) must be set for integration tests');
}

const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });

// Ensure required tables and types exist. We use CREATE ... IF NOT EXISTS /
// DO $$ ... $$ blocks so this is idempotent on repeated test runs.
async function runMigrations() {
  // Create enum types if they don't exist (Postgres has no CREATE TYPE IF NOT EXISTS)
  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sex_enum') THEN
        CREATE TYPE sex_enum AS ENUM ('male', 'female');
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'activity_level_enum') THEN
        CREATE TYPE activity_level_enum AS ENUM (
          'sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active'
        );
      END IF;
    END $$;
  `);

  await pool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'goal_enum') THEN
        CREATE TYPE goal_enum AS ENUM ('cut', 'maintain', 'bulk');
      END IF;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS profiles (
      user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      age            INTEGER NOT NULL CHECK (age >= 13 AND age <= 120),
      sex            sex_enum NOT NULL,
      height_cm      NUMERIC(5,1) NOT NULL CHECK (height_cm >= 50 AND height_cm <= 300),
      weight_kg      NUMERIC(5,2) NOT NULL CHECK (weight_kg >= 20 AND weight_kg <= 500),
      activity_level activity_level_enum NOT NULL,
      goal           goal_enum NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

// ── Test state ───────────────────────────────────────────────────────────────

const TEST_EMAIL = 'profiletest@example.com';
const TEST_PASSWORD = 'testpassword123';

let app: ReturnType<typeof createApp>;
let accessToken: string;
let userId: string;

beforeAll(async () => {
  await runMigrations();
  app = createApp(pool);

  // Register the test user
  const reg = await callApp(app, 'POST', '/auth/register', {
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });

  if (reg.status !== 201 && reg.status !== 409) {
    throw new Error(`Failed to register test user: ${JSON.stringify(reg.body)}`);
  }

  // Login to get an access token
  const login = await callApp(app, 'POST', '/auth/login', {
    body: { email: TEST_EMAIL, password: TEST_PASSWORD },
  });

  if (login.status !== 200) {
    throw new Error(`Failed to login test user: ${JSON.stringify(login.body)}`);
  }

  const loginBody = login.body as { accessToken: string; user: { id: string } };
  accessToken = loginBody.accessToken;
  userId = loginBody.user.id;
});

afterEach(async () => {
  // Clean up profile after each test so tests are independent
  await pool.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
});

// Runs once after all tests to remove the test user
import { afterAll } from 'vitest';
afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email = 'profiletest@example.com'");
  await pool.end();
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PROFILE = {
  age: 30,
  sex: 'male',
  height_cm: 175,
  weight_kg: 80,
  activity_level: 'moderately_active',
  goal: 'maintain',
};

function authHeader() {
  return { Authorization: `Bearer ${accessToken}` };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /profile', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await callApp(app, 'GET', '/profile');
    expect(res.status).toBe(401);
  });

  it('returns 404 when no profile exists for the user', async () => {
    const res = await callApp(app, 'GET', '/profile', { headers: authHeader() });
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/not found/i);
  });

  it('returns 200 with profile + targets after profile is created', async () => {
    // Create profile first
    await callApp(app, 'PUT', '/profile', {
      body: VALID_PROFILE,
      headers: authHeader(),
    });

    const res = await callApp(app, 'GET', '/profile', { headers: authHeader() });
    expect(res.status).toBe(200);

    const body = res.body as {
      profile: { age: number; sex: string; activity_level: string; goal: string };
      targets: { calories: number; protein_g: number; carbs_g: number; fat_g: number; tdee: number };
    };

    expect(body.profile.age).toBe(30);
    expect(body.profile.sex).toBe('male');
    expect(body.profile.activity_level).toBe('moderately_active');
    expect(body.profile.goal).toBe('maintain');

    // Pinned reference values: male 30yr 175cm 80kg moderately_active maintain
    expect(body.targets.calories).toBe(2711);
    expect(body.targets.protein_g).toBe(203);
    expect(body.targets.carbs_g).toBe(305);
    expect(body.targets.fat_g).toBe(75);
    expect(body.targets.tdee).toBe(2711);
  });
});

describe('PUT /profile', () => {
  it('returns 401 when no auth token is provided', async () => {
    const res = await callApp(app, 'PUT', '/profile', { body: VALID_PROFILE });
    expect(res.status).toBe(401);
  });

  it('creates a profile and returns 200 with profile + targets', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: VALID_PROFILE,
      headers: authHeader(),
    });

    expect(res.status).toBe(200);

    const body = res.body as {
      profile: { age: number; sex: string };
      targets: { calories: number };
    };

    expect(body.profile.age).toBe(30);
    expect(body.profile.sex).toBe('male');
    expect(body.targets.calories).toBe(2711);
  });

  it('updates an existing profile and returns updated fields', async () => {
    // Create with one set of values
    await callApp(app, 'PUT', '/profile', {
      body: VALID_PROFILE,
      headers: authHeader(),
    });

    // Update to a different age and goal
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, age: 35, goal: 'cut' },
      headers: authHeader(),
    });

    expect(res.status).toBe(200);

    const body = res.body as {
      profile: { age: number; goal: string };
      targets: { calories: number; tdee: number };
    };

    expect(body.profile.age).toBe(35);
    expect(body.profile.goal).toBe('cut');
    // cut = maintain calories - 500
    expect(body.targets.calories).toBe(body.targets.tdee - 500);
  });

  it('returns 422 when a required field is missing (weight_kg)', async () => {
    const { weight_kg: _omit, ...partial } = VALID_PROFILE;
    const res = await callApp(app, 'PUT', '/profile', {
      body: partial,
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('weight_kg');
  });

  it('returns 422 for an invalid age (below 13)', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, age: 10 },
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('age');
  });

  it('returns 422 for an invalid age (above 120)', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, age: 121 },
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('age');
  });

  it('returns 422 for an invalid sex value', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, sex: 'other' },
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('sex');
  });

  it('returns 422 for an invalid activity_level', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, activity_level: 'couch_potato' },
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('activity_level');
  });

  it('returns 422 for an invalid goal', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, goal: 'shred' },
      headers: authHeader(),
    });

    expect(res.status).toBe(422);
    const body = res.body as { error: string; field: string };
    expect(body.field).toBe('goal');
  });

  it('calories are goal-adjusted: bulk adds 300 kcal over tdee', async () => {
    const res = await callApp(app, 'PUT', '/profile', {
      body: { ...VALID_PROFILE, goal: 'bulk' },
      headers: authHeader(),
    });

    expect(res.status).toBe(200);
    const body = res.body as {
      targets: { calories: number; tdee: number };
    };
    expect(body.targets.calories).toBe(body.targets.tdee + 300);
  });
});
