import { Router, Response } from 'express';
import pg from 'pg';
import { verifyJwt, AuthRequest } from '../auth/middleware.js';
import {
  computeEntryMacros,
  sumMacros,
  computeRemaining,
  computeTargets,
} from '@macroracle/core';
import type { MacroValues, ProfileInput, ActivityLevel, Goal, Sex } from '@macroracle/core';

// ── Row helpers ───────────────────────────────────────────────────────────────

interface FoodRow {
  id: string;
  user_id: string;
  name: string;
  calories_per_100g: string; // pg returns NUMERIC as string
  protein_g: string;
  carbs_g: string;
  fat_g: string;
}

function rowToFoodMacros(row: FoodRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    calories_per_100g: parseFloat(row.calories_per_100g),
    protein_g: parseFloat(row.protein_g),
    carbs_g: parseFloat(row.carbs_g),
    fat_g: parseFloat(row.fat_g),
  };
}

interface ProfileRow {
  user_id: string;
  age: number;
  sex: Sex;
  height_cm: string;
  weight_kg: string;
  activity_level: ActivityLevel;
  goal: Goal;
}

function rowToProfileInput(row: ProfileRow): ProfileInput {
  return {
    age: row.age,
    sex: row.sex,
    height_cm: parseFloat(row.height_cm),
    weight_kg: parseFloat(row.weight_kg),
    activity_level: row.activity_level,
    goal: row.goal,
  };
}

interface LogRow {
  id: string;
  user_id: string;
  food_id: string;
  grams: string; // NUMERIC
  logged_at: Date;
  notes: string | null;
  created_at: Date;
  food_name: string;
  food_calories_per_100g: string;
  food_protein_g: string;
  food_carbs_g: string;
  food_fat_g: string;
}

function rowToEntry(row: LogRow) {
  const grams = parseFloat(row.grams);
  const food = {
    calories_per_100g: parseFloat(row.food_calories_per_100g),
    protein_g: parseFloat(row.food_protein_g),
    carbs_g: parseFloat(row.food_carbs_g),
    fat_g: parseFloat(row.food_fat_g),
  };
  const macros = computeEntryMacros(food, grams);
  return {
    id: row.id,
    food_id: row.food_id,
    food_name: row.food_name,
    grams,
    logged_at: row.logged_at,
    notes: row.notes,
    macros,
  };
}

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidIso(str: string): boolean {
  const d = new Date(str);
  return !isNaN(d.getTime());
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createLogRouter(pool: pg.Pool): Router {
  const router = Router();

  // All routes require authentication
  router.use(verifyJwt);

  // ── POST /log — log a food entry ──────────────────────────────────────────
  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const body = req.body as {
        food_id?: unknown;
        grams?: unknown;
        logged_at?: unknown;
        notes?: unknown;
      };

      // Validate food_id
      if (
        !body.food_id ||
        typeof body.food_id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.food_id)
      ) {
        res.status(422).json({ error: 'food_id must be a valid UUID', field: 'food_id' });
        return;
      }

      // Validate grams
      const grams = Number(body.grams);
      if (body.grams === undefined || body.grams === null || isNaN(grams) || grams <= 0) {
        res.status(422).json({ error: 'grams must be a positive number', field: 'grams' });
        return;
      }

      // Check user has a profile
      const profileRes = await pool.query<ProfileRow>(
        'SELECT * FROM profiles WHERE user_id = $1',
        [userId],
      );
      if (profileRes.rows.length === 0) {
        res.status(422).json({ error: 'Set your profile first before logging food.' });
        return;
      }

      // Fetch food — only personal foods the user owns
      const foodRes = await pool.query<FoodRow>(
        'SELECT * FROM foods WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [body.food_id, userId],
      );
      if (foodRes.rows.length === 0) {
        res.status(404).json({ error: 'Food not found' });
        return;
      }

      const food = rowToFoodMacros(foodRes.rows[0]);

      // Resolve logged_at
      let loggedAt: string | null = null;
      if (body.logged_at && typeof body.logged_at === 'string' && isValidIso(body.logged_at)) {
        loggedAt = body.logged_at;
      }

      const notes =
        body.notes && typeof body.notes === 'string' ? body.notes : null;

      // Insert log entry
      const insertRes = await pool.query(
        `INSERT INTO log_entries (user_id, food_id, grams, logged_at, notes)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [userId, food.id, grams, loggedAt ?? new Date().toISOString(), notes],
      );

      const entry = insertRes.rows[0] as {
        id: string;
        food_id: string;
        grams: string;
        logged_at: Date;
        notes: string | null;
      };
      const macros = computeEntryMacros(food, parseFloat(entry.grams));

      res.status(201).json({
        id: entry.id,
        food_id: entry.food_id,
        food_name: food.name,
        grams: parseFloat(entry.grams),
        logged_at: entry.logged_at,
        macros,
      });
    } catch (err) {
      console.error('POST /log error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /log/today — entries for today (UTC) ──────────────────────────────
  router.get('/today', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;

      const { rows } = await pool.query<LogRow>(
        `SELECT
           le.id,
           le.user_id,
           le.food_id,
           le.grams,
           le.logged_at,
           le.notes,
           le.created_at,
           f.name            AS food_name,
           f.calories_per_100g AS food_calories_per_100g,
           f.protein_g       AS food_protein_g,
           f.carbs_g         AS food_carbs_g,
           f.fat_g           AS food_fat_g
         FROM log_entries le
         LEFT JOIN foods f ON f.id = le.food_id
         WHERE le.user_id = $1
           AND le.logged_at::date = CURRENT_DATE
         ORDER BY le.logged_at ASC`,
        [userId],
      );

      const entries = rows.map(rowToEntry);
      res.json({ entries });
    } catch (err) {
      console.error('GET /log/today error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /log/summary — targets vs consumed vs remaining ──────────────────
  router.get('/summary', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;

      // Fetch profile
      const profileRes = await pool.query<ProfileRow>(
        'SELECT * FROM profiles WHERE user_id = $1',
        [userId],
      );
      if (profileRes.rows.length === 0) {
        res.status(422).json({ error: 'Set your profile first before viewing summary.' });
        return;
      }

      const profileInput = rowToProfileInput(profileRes.rows[0]);
      const rawTargets = computeTargets(profileInput);

      // Cast targets to MacroValues shape (drop tdee for consumed/remaining math)
      const targets: MacroValues = {
        calories: rawTargets.calories,
        protein_g: rawTargets.protein_g,
        carbs_g: rawTargets.carbs_g,
        fat_g: rawTargets.fat_g,
      };

      // Fetch today's entries
      const { rows } = await pool.query<LogRow>(
        `SELECT
           le.id,
           le.user_id,
           le.food_id,
           le.grams,
           le.logged_at,
           le.notes,
           le.created_at,
           f.name            AS food_name,
           f.calories_per_100g AS food_calories_per_100g,
           f.protein_g       AS food_protein_g,
           f.carbs_g         AS food_carbs_g,
           f.fat_g           AS food_fat_g
         FROM log_entries le
         LEFT JOIN foods f ON f.id = le.food_id
         WHERE le.user_id = $1
           AND le.logged_at::date = CURRENT_DATE`,
        [userId],
      );

      const entryMacros = rows.map((row) => {
        const grams = parseFloat(row.grams);
        const food = {
          calories_per_100g: parseFloat(row.food_calories_per_100g),
          protein_g: parseFloat(row.food_protein_g),
          carbs_g: parseFloat(row.food_carbs_g),
          fat_g: parseFloat(row.food_fat_g),
        };
        return computeEntryMacros(food, grams);
      });

      const consumed = sumMacros(entryMacros);
      const remaining = computeRemaining(targets, consumed);

      res.json({
        targets: { ...targets, tdee: rawTargets.tdee },
        consumed,
        remaining,
      });
    } catch (err) {
      console.error('GET /log/summary error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── DELETE /log/:id — remove a log entry ─────────────────────────────────
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { id } = req.params;

      const { rowCount } = await pool.query(
        'DELETE FROM log_entries WHERE id = $1 AND user_id = $2 RETURNING id',
        [id, userId],
      );

      if (rowCount === 0) {
        res.status(404).json({ error: 'Log entry not found' });
        return;
      }

      res.status(204).send();
    } catch (err) {
      console.error('DELETE /log/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ── GET /log — entries for a given date (or today) ────────────────────────
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const dateParam = req.query['date'];

      let dateFilter: string;
      let params: unknown[];

      if (typeof dateParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        dateFilter = 'le.logged_at::date = $2::date';
        params = [userId, dateParam];
      } else {
        dateFilter = 'le.logged_at::date = CURRENT_DATE';
        params = [userId];
      }

      const { rows } = await pool.query<LogRow>(
        `SELECT
           le.id,
           le.user_id,
           le.food_id,
           le.grams,
           le.logged_at,
           le.notes,
           le.created_at,
           f.name            AS food_name,
           f.calories_per_100g AS food_calories_per_100g,
           f.protein_g       AS food_protein_g,
           f.carbs_g         AS food_carbs_g,
           f.fat_g           AS food_fat_g
         FROM log_entries le
         LEFT JOIN foods f ON f.id = le.food_id
         WHERE le.user_id = $1
           AND ${dateFilter}
         ORDER BY le.logged_at ASC`,
        params,
      );

      const entries = rows.map(rowToEntry);
      res.json({ entries });
    } catch (err) {
      console.error('GET /log error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
