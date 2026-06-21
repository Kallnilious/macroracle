import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import pg from 'pg';
import { createAuthRouter } from './auth/router.js';
import { createProfileRouter } from './profile/router.js';
import { createFoodsRouter } from './foods/router.js';
import { createSearchRouter, createUsdaRouter } from './usda/router.js';
import { createLogRouter } from './log/router.js';

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
  app.use('/profile', createProfileRouter(pool));
  // Search router first so GET /foods/search is matched before GET /foods/:id
  app.use('/foods', createSearchRouter(pool));
  app.use('/foods', createFoodsRouter(pool));
  app.use('/usda', createUsdaRouter(pool));
  app.use('/log', createLogRouter(pool));

  return app;
}
