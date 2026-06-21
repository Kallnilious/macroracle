/**
 * Auth integration tests.
 *
 * Requires a running Postgres instance reachable via TEST_DATABASE_URL.
 * Run:  TEST_DATABASE_URL=postgres://... npx vitest run src/auth/auth.integration.test.ts
 *
 * The suite applies migrations before all tests and wipes users/refresh_tokens
 * after each test so cases are fully isolated.
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
  // Ensure ledger table exists.
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

async function cleanDb(): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens');
  await pool.query('DELETE FROM users');
}

// ── app instance ──────────────────────────────────────────────────────────────

process.env.JWT_SECRET = 'integration-test-secret';

const app = createApp(pool);

beforeAll(async () => {
  await runMigrations();
});

afterEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await pool.end();
});

// ── helper: extract Set-Cookie value by name ──────────────────────────────────

function extractCookie(
  headers: Record<string, string[]>,
  name: string,
): string | null {
  const setCookie = headers['set-cookie'] ?? [];
  for (const c of setCookie) {
    const pairs = c.split(';').map((s) => s.trim());
    const nameValue = pairs[0];
    if (nameValue.startsWith(`${name}=`)) {
      return nameValue.slice(name.length + 1);
    }
  }
  return null;
}

// ── POST /auth/register ───────────────────────────────────────────────────────

describe('POST /auth/register', () => {
  it('happy path → 201, user.id is a UUID, email is lower-cased', async () => {
    const { status, body } = await callApp(app, 'POST', '/auth/register', {
      body: { email: 'Alice@Example.COM', password: 'password123' },
    });

    expect(status).toBe(201);
    const b = body as { user: { id: string; email: string } };
    expect(b.user.email).toBe('alice@example.com');
    expect(b.user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('duplicate email → 409', async () => {
    await callApp(app, 'POST', '/auth/register', {
      body: { email: 'dup@example.com', password: 'password123' },
    });
    const { status } = await callApp(app, 'POST', '/auth/register', {
      body: { email: 'dup@example.com', password: 'different-password' },
    });
    expect(status).toBe(409);
  });

  it('invalid email format → 422', async () => {
    const { status } = await callApp(app, 'POST', '/auth/register', {
      body: { email: 'not-an-email', password: 'password123' },
    });
    expect(status).toBe(422);
  });

  it('password shorter than 8 chars → 422', async () => {
    const { status } = await callApp(app, 'POST', '/auth/register', {
      body: { email: 'short@example.com', password: 'abc' },
    });
    expect(status).toBe(422);
  });
});

// ── POST /auth/login ──────────────────────────────────────────────────────────

describe('POST /auth/login', () => {
  async function registerUser(email: string, password: string): Promise<void> {
    await callApp(app, 'POST', '/auth/register', { body: { email, password } });
  }

  it('happy path → 200, accessToken in body, Set-Cookie refreshToken present', async () => {
    await registerUser('login@example.com', 'password123');
    const { status, body, headers } = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'login@example.com', password: 'password123' },
    });

    expect(status).toBe(200);
    const b = body as { accessToken: string; user: { id: string; email: string } };
    expect(typeof b.accessToken).toBe('string');
    expect(b.accessToken.split('.').length).toBe(3); // JWT format
    expect(b.user.email).toBe('login@example.com');

    const cookieVal = extractCookie(headers, 'refreshToken');
    expect(cookieVal).not.toBeNull();
  });

  it('wrong password → 401', async () => {
    await registerUser('wrongpw@example.com', 'correctpassword');
    const { status } = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'wrongpw@example.com', password: 'wrongpassword' },
    });
    expect(status).toBe(401);
  });

  it('unknown email → 401 (not 404)', async () => {
    const { status } = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'ghost@example.com', password: 'password123' },
    });
    expect(status).toBe(401);
  });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────────

describe('GET /auth/me', () => {
  it('valid Bearer token → 200, returns correct user', async () => {
    await callApp(app, 'POST', '/auth/register', {
      body: { email: 'me@example.com', password: 'password123' },
    });
    const loginRes = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'me@example.com', password: 'password123' },
    });
    const { accessToken } = loginRes.body as { accessToken: string };

    const { status, body } = await callApp(app, 'GET', '/auth/me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    expect(status).toBe(200);
    const b = body as { user: { email: string } };
    expect(b.user.email).toBe('me@example.com');
  });

  it('missing token → 401', async () => {
    const { status } = await callApp(app, 'GET', '/auth/me');
    expect(status).toBe(401);
  });
});

// ── POST /auth/refresh ────────────────────────────────────────────────────────

describe('POST /auth/refresh', () => {
  it('valid refreshToken cookie → 200, returns new accessToken', async () => {
    await callApp(app, 'POST', '/auth/register', {
      body: { email: 'refresh@example.com', password: 'password123' },
    });
    const loginRes = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'refresh@example.com', password: 'password123' },
    });

    const refreshCookie = extractCookie(loginRes.headers, 'refreshToken');
    expect(refreshCookie).not.toBeNull();

    const { status, body } = await callApp(app, 'POST', '/auth/refresh', {
      headers: { Cookie: `refreshToken=${refreshCookie}` },
    });

    expect(status).toBe(200);
    const b = body as { accessToken: string };
    expect(typeof b.accessToken).toBe('string');
    expect(b.accessToken.split('.').length).toBe(3);
  });

  it('no cookie → 401', async () => {
    const { status } = await callApp(app, 'POST', '/auth/refresh');
    expect(status).toBe(401);
  });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────────

describe('POST /auth/logout', () => {
  it('returns 200 and clears the refreshToken cookie', async () => {
    await callApp(app, 'POST', '/auth/register', {
      body: { email: 'logout@example.com', password: 'password123' },
    });
    const loginRes = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'logout@example.com', password: 'password123' },
    });
    const refreshCookie = extractCookie(loginRes.headers, 'refreshToken');

    const { status, headers } = await callApp(app, 'POST', '/auth/logout', {
      headers: { Cookie: `refreshToken=${refreshCookie}` },
    });

    expect(status).toBe(200);
    // The server should set-cookie with an empty or expired refreshToken
    const setCookies = headers['set-cookie'] ?? [];
    const refreshCookieHeader = setCookies.find((c) => c.startsWith('refreshToken='));
    expect(refreshCookieHeader).toBeDefined();
  });

  it('POST /auth/refresh after logout → 401', async () => {
    await callApp(app, 'POST', '/auth/register', {
      body: { email: 'logoutthen@example.com', password: 'password123' },
    });
    const loginRes = await callApp(app, 'POST', '/auth/login', {
      body: { email: 'logoutthen@example.com', password: 'password123' },
    });
    const refreshCookie = extractCookie(loginRes.headers, 'refreshToken');

    // Logout
    await callApp(app, 'POST', '/auth/logout', {
      headers: { Cookie: `refreshToken=${refreshCookie}` },
    });

    // Try to refresh with the now-revoked token
    const { status } = await callApp(app, 'POST', '/auth/refresh', {
      headers: { Cookie: `refreshToken=${refreshCookie}` },
    });

    expect(status).toBe(401);
  });
});
