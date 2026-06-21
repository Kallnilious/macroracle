import { Router, Response } from 'express';
import pg from 'pg';
import { verifyJwt, AuthRequest } from '../auth/middleware.js';

interface Food {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_size_g: number | null;
  serving_name: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

// pg returns NUMERIC columns as strings — parse them to numbers here.
function rowToFood(row: Record<string, unknown>): Food {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    calories_per_100g: parseFloat(row.calories_per_100g as string),
    protein_g: parseFloat(row.protein_g as string),
    carbs_g: parseFloat(row.carbs_g as string),
    fat_g: parseFloat(row.fat_g as string),
    serving_size_g:
      row.serving_size_g != null ? parseFloat(row.serving_size_g as string) : null,
    serving_name: (row.serving_name as string | null) ?? null,
    tags: row.tags as string[],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

interface FoodBody {
  name?: unknown;
  brand?: unknown;
  calories_per_100g?: unknown;
  protein_g?: unknown;
  carbs_g?: unknown;
  fat_g?: unknown;
  serving_size_g?: unknown;
  serving_name?: unknown;
  tags?: unknown;
}

function validateFoodBody(
  body: FoodBody,
  res: Response,
): {
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_size_g: number | null;
  serving_name: string | null;
  tags: string[];
} | null {
  // name: required, non-empty string, max 200 chars
  if (
    body.name === undefined ||
    body.name === null ||
    typeof body.name !== 'string' ||
    body.name.trim() === ''
  ) {
    res.status(422).json({ error: 'name is required and must be a non-empty string', field: 'name' });
    return null;
  }
  if (body.name.length > 200) {
    res.status(422).json({ error: 'name must be 200 characters or fewer', field: 'name' });
    return null;
  }
  const name = body.name.trim();

  // calories_per_100g: required, non-negative, max 9000
  if (body.calories_per_100g === undefined || body.calories_per_100g === null) {
    res.status(422).json({ error: 'calories_per_100g is required', field: 'calories_per_100g' });
    return null;
  }
  const calories = Number(body.calories_per_100g);
  if (isNaN(calories) || calories < 0 || calories > 9000) {
    res
      .status(422)
      .json({ error: 'calories_per_100g must be a number between 0 and 9000', field: 'calories_per_100g' });
    return null;
  }

  // protein_g: required, non-negative, max 100
  if (body.protein_g === undefined || body.protein_g === null) {
    res.status(422).json({ error: 'protein_g is required', field: 'protein_g' });
    return null;
  }
  const protein = Number(body.protein_g);
  if (isNaN(protein) || protein < 0 || protein > 100) {
    res
      .status(422)
      .json({ error: 'protein_g must be a number between 0 and 100', field: 'protein_g' });
    return null;
  }

  // carbs_g: required, non-negative, max 100
  if (body.carbs_g === undefined || body.carbs_g === null) {
    res.status(422).json({ error: 'carbs_g is required', field: 'carbs_g' });
    return null;
  }
  const carbs = Number(body.carbs_g);
  if (isNaN(carbs) || carbs < 0 || carbs > 100) {
    res
      .status(422)
      .json({ error: 'carbs_g must be a number between 0 and 100', field: 'carbs_g' });
    return null;
  }

  // fat_g: required, non-negative, max 100
  if (body.fat_g === undefined || body.fat_g === null) {
    res.status(422).json({ error: 'fat_g is required', field: 'fat_g' });
    return null;
  }
  const fat = Number(body.fat_g);
  if (isNaN(fat) || fat < 0 || fat > 100) {
    res
      .status(422)
      .json({ error: 'fat_g must be a number between 0 and 100', field: 'fat_g' });
    return null;
  }

  // serving_size_g: optional, must be > 0 if provided
  let serving_size_g: number | null = null;
  if (body.serving_size_g !== undefined && body.serving_size_g !== null && body.serving_size_g !== '') {
    serving_size_g = Number(body.serving_size_g);
    if (isNaN(serving_size_g) || serving_size_g <= 0) {
      res
        .status(422)
        .json({ error: 'serving_size_g must be a positive number', field: 'serving_size_g' });
      return null;
    }
  }

  // brand: optional string
  const brand =
    body.brand !== undefined && body.brand !== null && body.brand !== ''
      ? String(body.brand)
      : null;

  // serving_name: optional string
  const serving_name =
    body.serving_name !== undefined && body.serving_name !== null && body.serving_name !== ''
      ? String(body.serving_name)
      : null;

  // tags: optional array of strings, default []
  let tags: string[] = [];
  if (body.tags !== undefined && body.tags !== null) {
    if (!Array.isArray(body.tags)) {
      res.status(422).json({ error: 'tags must be an array of strings', field: 'tags' });
      return null;
    }
    if (!body.tags.every((t) => typeof t === 'string')) {
      res.status(422).json({ error: 'tags must be an array of strings', field: 'tags' });
      return null;
    }
    tags = body.tags as string[];
  }

  return { name, brand, calories_per_100g: calories, protein_g: protein, carbs_g: carbs, fat_g: fat, serving_size_g, serving_name, tags };
}

export function createFoodsRouter(pool: pg.Pool): Router {
  const router = Router();

  // All routes require authentication
  router.use(verifyJwt);

  // GET /foods — list all foods for the authenticated user
  router.get('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { rows } = await pool.query(
        'SELECT * FROM foods WHERE user_id = $1 AND deleted_at IS NULL ORDER BY name ASC',
        [userId],
      );
      res.json({ foods: rows.map(rowToFood) });
    } catch (err) {
      console.error('GET /foods error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /foods/:id — get one food (scoped to authenticated user)
  router.get('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { id } = req.params;
      const { rows } = await pool.query(
        'SELECT * FROM foods WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL',
        [id, userId],
      );
      if (rows.length === 0) {
        res.status(404).json({ error: 'Food not found' });
        return;
      }
      res.json({ food: rowToFood(rows[0]) });
    } catch (err) {
      console.error('GET /foods/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /foods — create a new food for the authenticated user
  router.post('/', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const validated = validateFoodBody(req.body as FoodBody, res);
      if (!validated) return;

      const { name, brand, calories_per_100g, protein_g, carbs_g, fat_g, serving_size_g, serving_name, tags } = validated;

      const { rows } = await pool.query(
        `INSERT INTO foods
           (user_id, name, brand, calories_per_100g, protein_g, carbs_g, fat_g,
            serving_size_g, serving_name, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [userId, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, serving_size_g, serving_name, tags],
      );

      res.status(201).json({ food: rowToFood(rows[0]) });
    } catch (err) {
      console.error('POST /foods error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /foods/:id — update a food (scoped to authenticated user)
  router.put('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { id } = req.params;
      const validated = validateFoodBody(req.body as FoodBody, res);
      if (!validated) return;

      const { name, brand, calories_per_100g, protein_g, carbs_g, fat_g, serving_size_g, serving_name, tags } = validated;

      const { rows } = await pool.query(
        `UPDATE foods
         SET name = $3,
             brand = $4,
             calories_per_100g = $5,
             protein_g = $6,
             carbs_g = $7,
             fat_g = $8,
             serving_size_g = $9,
             serving_name = $10,
             tags = $11,
             updated_at = NOW()
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [id, userId, name, brand, calories_per_100g, protein_g, carbs_g, fat_g, serving_size_g, serving_name, tags],
      );

      if (rows.length === 0) {
        res.status(404).json({ error: 'Food not found' });
        return;
      }

      res.json({ food: rowToFood(rows[0]) });
    } catch (err) {
      console.error('PUT /foods/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /foods/:id — delete a food (scoped to authenticated user)
  router.delete('/:id', async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.user!.sub;
      const { id } = req.params;

      const { rowCount } = await pool.query(
        'UPDATE foods SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL RETURNING id',
        [id, userId],
      );

      if (rowCount === 0) {
        res.status(404).json({ error: 'Food not found' });
        return;
      }

      res.status(204).send();
    } catch (err) {
      console.error('DELETE /foods/:id error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
