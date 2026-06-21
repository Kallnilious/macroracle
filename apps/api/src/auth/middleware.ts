import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from './tokens.js';

export interface AuthRequest extends Request {
  user?: { sub: string; email: string };
}

/**
 * Express middleware that validates a Bearer JWT in the Authorization header.
 * On success it sets req.user = { sub, email } and calls next().
 * On failure it immediately responds 401.
 */
export function verifyJwt(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const result = verifyAccessToken(token);

  if (!result.valid) {
    res.status(401).json({ error: `Token ${result.reason}` });
    return;
  }

  req.user = { sub: result.payload.sub, email: result.payload.email };
  next();
}
