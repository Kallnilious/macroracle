import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import pg from 'pg';

const ACCESS_TTL = 15 * 60;         // 900 s
const REFRESH_TTL = 7 * 24 * 3600; // 604 800 s

export interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
  exp?: number;
}

export type TokenResult =
  | { valid: true; payload: JwtPayload }
  | { valid: false; reason: string };

// ── helpers ──────────────────────────────────────────────────────────────────

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET is not set');
  return s;
}

// ── access token ─────────────────────────────────────────────────────────────

export function signAccessToken(user: { id: string; email: string }): string {
  return jwt.sign(
    { sub: user.id, email: user.email },
    getJwtSecret(),
    { expiresIn: ACCESS_TTL, algorithm: 'HS256' },
  );
}

export function verifyAccessToken(token: string): TokenResult {
  try {
    const payload = jwt.verify(token, getJwtSecret(), {
      algorithms: ['HS256'],
    }) as JwtPayload;
    return { valid: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return { valid: false, reason: 'expired' };
    }
    return { valid: false, reason: 'invalid' };
  }
}

// ── refresh token ─────────────────────────────────────────────────────────────

/**
 * Generate a random opaque token, store its SHA-256 hash in the DB, and
 * return the raw token to the caller (who will set it as an httpOnly cookie).
 */
export async function issueRefreshToken(
  pool: pg.Pool,
  userId: string,
): Promise<string> {
  const raw = crypto.randomBytes(64).toString('hex');
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt],
  );

  return raw;
}

/**
 * Validate a raw refresh token.
 * A token is invalid when: not found, already revoked, or past its expiry.
 */
export async function verifyRefreshToken(
  pool: pg.Pool,
  rawToken: string,
): Promise<{ valid: true; userId: string } | { valid: false; reason: string }> {
  const tokenHash = sha256(rawToken);

  const { rows } = await pool.query<{
    user_id: string;
    revoked_at: Date | null;
    expires_at: Date;
  }>(
    `SELECT user_id, revoked_at, expires_at
     FROM refresh_tokens
     WHERE token_hash = $1`,
    [tokenHash],
  );

  if (rows.length === 0) {
    return { valid: false, reason: 'not found' };
  }

  const row = rows[0];

  if (row.revoked_at !== null) {
    return { valid: false, reason: 'revoked' };
  }

  if (new Date() > row.expires_at) {
    return { valid: false, reason: 'expired' };
  }

  return { valid: true, userId: row.user_id };
}

/**
 * Mark a refresh token as revoked (soft delete).
 */
export async function revokeRefreshToken(
  pool: pg.Pool,
  rawToken: string,
): Promise<void> {
  const tokenHash = sha256(rawToken);
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash],
  );
}
