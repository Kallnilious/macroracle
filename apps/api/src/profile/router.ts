import { Router, Response } from 'express';
import pg from 'pg';
import { verifyJwt, AuthRequest } from '../auth/middleware.js';
import { computeTargets } from '@macroracle/core';
import type { ProfileInput, ActivityLevel, Goal, Sex } from '@macroracle/core';

// ── Validation helpers ───────────────────────────────────────────────────────

const VALID_ACTIVITY_LEVELS: ActivityLevel[] = [
  'sedentary',
  'lightly_active',
  'moderately_active',
  'very_active',
  'extra_active',
];
const VALID_GOALS: Goal[] = ['cut', 'maintain', 'bulk'];
const VALID_SEXES: Sex[] = ['male', 'female'];

interface ValidationError {
  error: string;
  field: string;
}

function validateProfileBody(body: unknown): ValidationError | null {
  if (typeof body !== 'object' || body === null) {
    return { error: 'Request body must be a JSON object', field: 'body' };
  }

  const b = body as Record<string, unknown>;

  // age
  if (b.age === undefined || b.age === null) {
    return { error: 'age is required', field: 'age' };
  }
  const age = Number(b.age);
  if (!Number.isFinite(age) || age < 13 || age > 120) {
    return { error: 'age must be an integer between 13 and 120', field: 'age' };
  }

  // sex
  if (b.sex === undefined || b.sex === null) {
    return { error: 'sex is required', field: 'sex' };
  }
  if (!VALID_SEXES.includes(b.sex as Sex)) {
    return { error: 'sex must be "male" or "female"', field: 'sex' };
  }

  // height_cm
  if (b.height_cm === undefined || b.height_cm === null) {
    return { error: 'height_cm is required', field: 'height_cm' };
  }
  const height_cm = Number(b.height_cm);
  if (!Number.isFinite(height_cm) || height_cm < 50 || height_cm > 300) {
    return { error: 'height_cm must be a number between 50 and 300', field: 'height_cm' };
  }

  // weight_kg
  if (b.weight_kg === undefined || b.weight_kg === null) {
    return { error: 'weight_kg is required', field: 'weight_kg' };
  }
  const weight_kg = Number(b.weight_kg);
  if (!Number.isFinite(weight_kg) || weight_kg < 20 || weight_kg > 500) {
    return { error: 'weight_kg must be a number between 20 and 500', field: 'weight_kg' };
  }

  // activity_level
  if (b.activity_level === undefined || b.activity_level === null) {
    return { error: 'activity_level is required', field: 'activity_level' };
  }
  if (!VALID_ACTIVITY_LEVELS.includes(b.activity_level as ActivityLevel)) {
    return {
      error: `activity_level must be one of: ${VALID_ACTIVITY_LEVELS.join(', ')}`,
      field: 'activity_level',
    };
  }

  // goal
  if (b.goal === undefined || b.goal === null) {
    return { error: 'goal is required', field: 'goal' };
  }
  if (!VALID_GOALS.includes(b.goal as Goal)) {
    return {
      error: `goal must be one of: ${VALID_GOALS.join(', ')}`,
      field: 'goal',
    };
  }

  return null;
}

// ── Row type returned from DB ────────────────────────────────────────────────

interface ProfileRow {
  user_id: string;
  age: number;
  sex: Sex;
  height_cm: string; // pg returns NUMERIC as string
  weight_kg: string;
  activity_level: ActivityLevel;
  goal: Goal;
  created_at: Date;
  updated_at: Date;
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

function buildResponse(row: ProfileRow) {
  const profileInput = rowToProfileInput(row);
  const targets = computeTargets(profileInput);
  return {
    profile: {
      age: row.age,
      sex: row.sex,
      height_cm: parseFloat(row.height_cm),
      weight_kg: parseFloat(row.weight_kg),
      activity_level: row.activity_level,
      goal: row.goal,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    targets,
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

export function createProfileRouter(pool: pg.Pool): Router {
  const router = Router();

  // ── GET /profile ───────────────────────────────────────────────────────────
  router.get('/', verifyJwt, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.sub;

    const { rows } = await pool.query<ProfileRow>(
      `SELECT user_id, age, sex, height_cm, weight_kg, activity_level, goal, created_at, updated_at
       FROM profiles
       WHERE user_id = $1`,
      [userId],
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }

    res.json(buildResponse(rows[0]));
  });

  // ── PUT /profile ───────────────────────────────────────────────────────────
  router.put('/', verifyJwt, async (req: AuthRequest, res: Response) => {
    const userId = req.user!.sub;

    const validationError = validateProfileBody(req.body);
    if (validationError) {
      res.status(422).json(validationError);
      return;
    }

    const b = req.body as Record<string, unknown>;
    const age = Number(b.age);
    const sex = b.sex as Sex;
    const height_cm = Number(b.height_cm);
    const weight_kg = Number(b.weight_kg);
    const activity_level = b.activity_level as ActivityLevel;
    const goal = b.goal as Goal;

    const { rows } = await pool.query<ProfileRow>(
      `INSERT INTO profiles (user_id, age, sex, height_cm, weight_kg, activity_level, goal)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET
         age            = EXCLUDED.age,
         sex            = EXCLUDED.sex,
         height_cm      = EXCLUDED.height_cm,
         weight_kg      = EXCLUDED.weight_kg,
         activity_level = EXCLUDED.activity_level,
         goal           = EXCLUDED.goal,
         updated_at     = NOW()
       RETURNING user_id, age, sex, height_cm, weight_kg, activity_level, goal, created_at, updated_at`,
      [userId, age, sex, height_cm, weight_kg, activity_level, goal],
    );

    res.json(buildResponse(rows[0]));
  });

  return router;
}
