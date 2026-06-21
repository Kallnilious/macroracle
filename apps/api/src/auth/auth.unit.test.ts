import { describe, it, expect, beforeAll } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';
import { signAccessToken, verifyAccessToken } from './tokens.js';
import jwt from 'jsonwebtoken';

// All unit tests for auth utilities (no DB needed).

const TEST_SECRET = 'test-secret-for-unit-tests';

beforeAll(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

// ── password ──────────────────────────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns a bcrypt string with cost factor 12', async () => {
    const hash = await hashPassword('hunter2');
    // bcryptjs uses $2a$ prefix (functionally identical to $2b$); both are cost-12 bcrypt
    expect(hash).toMatch(/^\$2[ab]\$12\$/);
  });

  it('produces a different hash each call (salt randomness)', async () => {
    const h1 = await hashPassword('samepassword');
    const h2 = await hashPassword('samepassword');
    expect(h1).not.toBe(h2);
  });
});

describe('verifyPassword', () => {
  it('returns true for the correct plaintext password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const ok = await verifyPassword('correct-horse-battery-staple', hash);
    expect(ok).toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const ok = await verifyPassword('wrong-password', hash);
    expect(ok).toBe(false);
  });
});

// ── access token ──────────────────────────────────────────────────────────────

describe('signAccessToken', () => {
  it('produces a JWT with the correct sub and email claims', () => {
    const token = signAccessToken({ id: 'user-uuid-123', email: 'foo@example.com' });
    const decoded = jwt.decode(token) as { sub: string; email: string; exp: number };
    expect(decoded.sub).toBe('user-uuid-123');
    expect(decoded.email).toBe('foo@example.com');
    expect(typeof decoded.exp).toBe('number');
  });
});

describe('verifyAccessToken', () => {
  it('returns valid:true with correct payload for a fresh token', () => {
    const token = signAccessToken({ id: 'user-uuid-456', email: 'bar@example.com' });
    const result = verifyAccessToken(token);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.payload.sub).toBe('user-uuid-456');
      expect(result.payload.email).toBe('bar@example.com');
    }
  });

  it('returns valid:false with reason "expired" for an already-expired token', () => {
    // expiresIn: -1 creates a token that expired one second in the past.
    const token = jwt.sign(
      { sub: 'user-expired', email: 'expired@example.com' },
      TEST_SECRET,
      { expiresIn: -1, algorithm: 'HS256' },
    );
    const result = verifyAccessToken(token);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('expired');
    }
  });

  it('returns valid:false with reason "invalid" for a tampered token', () => {
    const token = signAccessToken({ id: 'user-tampered', email: 'tampered@example.com' });
    // Flip the last character to corrupt the signature.
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    const result = verifyAccessToken(tampered);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('invalid');
    }
  });

  it('returns valid:false with reason "invalid" for a completely bogus string', () => {
    const result = verifyAccessToken('not.a.jwt');
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('invalid');
    }
  });
});
