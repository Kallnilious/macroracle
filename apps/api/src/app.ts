import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import pg from 'pg';
import { createAuthRouter } from './auth/router.js';

export function createApp(pool: pg.Pool): express.Application {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000', credentials: true }));
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down', time: new Date().toISOString() });
    }
  });

  app.use('/auth', createAuthRouter(pool));

  return app;
}
