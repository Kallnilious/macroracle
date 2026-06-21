import bcrypt from 'bcryptjs';

const COST = 12;

/**
 * Hash a plaintext password with bcrypt (cost 12).
 * Returns the full bcrypt string, e.g. "$2b$12$..."
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

/**
 * Compare a plaintext password against a stored bcrypt hash.
 * Returns true when they match, false otherwise.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
