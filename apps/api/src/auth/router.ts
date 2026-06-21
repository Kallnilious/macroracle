import { Router, Request, Response, CookieOptions } from 'express';
import pg from 'pg';
import { hashPassword, verifyPassword } from './password.js';
import {
  signAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  revokeRefreshToken,
} from './tokens.js';
import { verifyJwt, AuthRequest } from './middleware.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;

// Cookie name is a constant to avoid typos across routes.
const REFRESH_COOKIE = 'refreshToken';

/** Cookie options — maxAge is in milliseconds for express. */
function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 604_800_000, // 7 days in ms
    path: '/auth/refresh',
  };
}

export function createAuthRouter(pool: pg.Pool): Router {
  const router = Router();

  // ── POST /auth/register ────────────────────────────────────────────────────
  router.post('/register', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: unknown; password?: unknown };

    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      res.status(422).json({ error: 'Invalid email address' });
      return;
    }

    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LEN) {
      res
        .status(422)
        .json({ error: `Password must be at least ${MIN_PASSWORD_LEN} characters` });
      return;
    }

    const normalizedEmail = email.toLowerCase();
    const passwordHash = await hashPassword(password);

    try {
      const { rows } = await pool.query<{ id: string; email: string; created_at: Date }>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id, email, created_at`,
        [normalizedEmail, passwordHash],
      );

      const user = rows[0];
      res.status(201).json({
        user: { id: user.id, email: user.email, createdAt: user.created_at },
      });
    } catch (err: unknown) {
      // Postgres unique-violation error code
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === '23505'
      ) {
        res.status(409).json({ error: 'Email already registered' });
        return;
      }
      console.error('register error', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── POST /auth/login ───────────────────────────────────────────────────────
  router.post('/login', async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: unknown; password?: unknown };

    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(422).json({ error: 'email and password are required' });
      return;
    }

    const normalizedEmail = email.toLowerCase();

    const { rows } = await pool.query<{
      id: string;
      email: string;
      password_hash: string;
    }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [normalizedEmail],
    );

    // Constant-time: always call verifyPassword to resist timing attacks.
    const dummyHash =
      '$2b$12$0000000000000000000000000000000000000000000000000000';
    const user = rows[0] ?? null;
    const hashToCheck = user ? user.password_hash : dummyHash;
    const passwordOk = await verifyPassword(password, hashToCheck);

    if (!user || !passwordOk) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const accessToken = signAccessToken({ id: user.id, email: user.email });
    const rawRefresh = await issueRefreshToken(pool, user.id);

    res.cookie(REFRESH_COOKIE, rawRefresh, refreshCookieOptions());
    res.json({
      accessToken,
      user: { id: user.id, email: user.email },
    });
  });

  // ── POST /auth/refresh ─────────────────────────────────────────────────────
  router.post('/refresh', async (req: Request, res: Response) => {
    const rawToken: string | undefined = (req.cookies as Record<string, string>)[REFRESH_COOKIE];

    if (!rawToken) {
      res.status(401).json({ error: 'No refresh token' });
      return;
    }

    const result = await verifyRefreshToken(pool, rawToken);

    if (!result.valid) {
      res.status(401).json({ error: `Refresh token ${result.reason}` });
      return;
    }

    // Rotate: revoke old token, issue new one.
    await revokeRefreshToken(pool, rawToken);

    const { rows } = await pool.query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE id = $1`,
      [result.userId],
    );

    if (rows.length === 0) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    const user = rows[0];
    const accessToken = signAccessToken({ id: user.id, email: user.email });
    const newRawRefresh = await issueRefreshToken(pool, user.id);

    res.cookie(REFRESH_COOKIE, newRawRefresh, refreshCookieOptions());
    res.json({ accessToken });
  });

  // ── POST /auth/logout ──────────────────────────────────────────────────────
  router.post('/logout', async (req: Request, res: Response) => {
    const rawToken: string | undefined = (req.cookies as Record<string, string>)[REFRESH_COOKIE];

    if (rawToken) {
      await revokeRefreshToken(pool, rawToken);
    }

    // Clear the cookie regardless of whether a token was found.
    res.clearCookie(REFRESH_COOKIE, { path: '/auth/refresh' });
    res.json({ ok: true });
  });

  // ── GET /auth/me ───────────────────────────────────────────────────────────
  router.get('/me', verifyJwt, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.sub;

    const { rows } = await pool.query<{ id: string; email: string; created_at: Date }>(
      `SELECT id, email, created_at FROM users WHERE id = $1`,
      [userId],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = rows[0];
    res.json({ user: { id: user.id, email: user.email, createdAt: user.created_at } });
  });

  return router;
}
