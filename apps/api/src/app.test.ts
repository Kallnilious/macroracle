import { describe, it, expect, afterAll } from 'vitest';
import http from 'node:http';
import pg from 'pg';
import { createApp } from './app.js';

const { Pool } = pg;

// Calls an Express app in-process on a random port and returns parsed JSON.
function callApp(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('bad address'));
      }
      fetch(`http://127.0.0.1:${addr.port}${path}`, { method })
        .then(async (r) => {
          const body = (await r.json()) as Record<string, unknown>;
          server.close(() => resolve({ status: r.status, body }));
        })
        .catch((err) => server.close(() => reject(err)));
    });
  });
}

describe('GET /health — with a live database', () => {
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
  });
  const app = createApp(pool);
  afterAll(() => pool.end());

  it('returns 200 with db: up', async () => {
    const { status, body } = await callApp(app, 'GET', '/health');
    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
    expect(typeof body.time).toBe('string');
  });
});

describe('GET /health — with an unreachable database', () => {
  const pool = new Pool({
    connectionString: 'postgresql://node@localhost:9999/nonexistent',
    connectionTimeoutMillis: 500,
  });
  const app = createApp(pool);
  afterAll(() => pool.end());

  it('returns 503 with db: down', async () => {
    const { status, body } = await callApp(app, 'GET', '/health');
    expect(status).toBe(503);
    expect(body.db).toBe('down');
  }, 5000);
});
