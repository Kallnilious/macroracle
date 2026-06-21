import { Router, Request, Response } from 'express';
import pg from 'pg';
import { mergeResults, extractMacros, FoodResult } from '@macroracle/core';
import { verifyAccessToken } from '../auth/tokens.js';
import { searchUsda, fetchUsdaFood } from './client.js';

// ── DB row helpers ────────────────────────────────────────────────────────────

/**
 * Convert a row from the `foods` table (personal foods) to a FoodResult.
 * pg returns NUMERIC columns as strings, so we parseFloat them.
 */
function rowToFoodResult(row: Record<string, unknown>): FoodResult {
  return {
    id: row.id as string,
    source: 'personal',
    name: row.name as string,
    brand: (row.brand as string | null) ?? null,
    calories_per_100g: parseFloat(row.calories_per_100g as string),
    protein_g: parseFloat(row.protein_g as string),
    carbs_g: parseFloat(row.carbs_g as string),
    fat_g: parseFloat(row.fat_g as string),
    user_id: row.user_id as string,
  };
}

/**
 * Convert a row from the `usda_foods` cache table to a FoodResult.
 * The `nutrients` column is JSONB — pg parses it to an object automatically.
 */
function usdaRowToFoodResult(row: Record<string, unknown>): FoodResult {
  const nutrients = row.nutrients as Array<{ nutrientNumber: string; value: number }>;
  return extractMacros({
    fdc_id: row.fdc_id as string,
    description: row.description as string,
    brand_owner: (row.brand_owner as string | null) ?? null,
    data_type: row.data_type as string,
    nutrients,
    cached_at: (row.cached_at as Date).toISOString(),
  });
}

/**
 * Convert a raw USDA API response object to a FoodResult.
 */
function usdaApiToFoodResult(food: {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType: string;
  foodNutrients: Array<{ nutrientNumber: string; value: number }>;
}): FoodResult {
  return extractMacros({
    fdc_id: String(food.fdcId),
    description: food.description,
    brand_owner: food.brandOwner ?? null,
    data_type: food.dataType,
    nutrients: food.foodNutrients,
    cached_at: new Date().toISOString(),
  });
}

// ── Search router (mounted at /foods) ────────────────────────────────────────

/**
 * Creates a router that adds GET /search under whatever prefix it is mounted at.
 * In app.ts this is mounted at /foods, so the full path is GET /foods/search.
 */
export function createSearchRouter(pool: pg.Pool): Router {
  const router = Router();

  // GET /foods/search
  router.get('/search', async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const source = typeof req.query.source === 'string' ? req.query.source : 'all';

    if (!q || q.length < 2) {
      res.status(400).json({ error: 'q must be at least 2 characters' });
      return;
    }

    // Optional auth — extract userId if token is present and valid.
    let userId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const result = verifyAccessToken(token);
      if (result.valid) userId = result.payload.sub;
    }

    // Require auth when source=personal
    if (source === 'personal' && !userId) {
      res.status(401).json({ error: 'Authentication required for personal food search' });
      return;
    }

    let personalResults: FoodResult[] = [];
    let usdaResults: FoodResult[] = [];
    const warnings: string[] = [];

    // ── Personal layer ────────────────────────────────────────────────────────
    if (source !== 'usda' && userId) {
      try {
        const { rows } = await pool.query(
          `SELECT * FROM foods
           WHERE user_id = $1 AND (name ILIKE $2 OR brand ILIKE $2)
           ORDER BY name
           LIMIT 20`,
          [userId, `%${q}%`],
        );
        personalResults = rows.map(rowToFoodResult);
      } catch (err) {
        console.error('Personal foods query error:', err);
        // Non-fatal — degrade gracefully
        warnings.push('Could not load personal foods.');
      }
    }

    // ── USDA layer ────────────────────────────────────────────────────────────
    if (source !== 'personal') {
      // Try fresh cache first (< 30 days old).
      try {
        const cacheRows = await pool.query(
          `SELECT * FROM usda_foods
           WHERE to_tsvector('english', description) @@ plainto_tsquery('english', $1)
             AND cached_at > NOW() - INTERVAL '30 days'
           LIMIT 20`,
          [q],
        );

        if (cacheRows.rows.length > 0) {
          usdaResults = cacheRows.rows.map(usdaRowToFoodResult);
        } else {
          // Cache miss — hit the USDA API.
          try {
            const usdaFoods = await searchUsda(q);

            // Upsert results into cache.
            for (const food of usdaFoods) {
              await pool.query(
                `INSERT INTO usda_foods (fdc_id, description, brand_owner, data_type, nutrients, cached_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (fdc_id) DO UPDATE
                   SET description = EXCLUDED.description,
                       nutrients   = EXCLUDED.nutrients,
                       cached_at   = NOW()`,
                [
                  String(food.fdcId),
                  food.description,
                  food.brandOwner ?? null,
                  food.dataType,
                  JSON.stringify(food.foodNutrients),
                ],
              );
            }

            usdaResults = usdaFoods.map(usdaApiToFoodResult);
          } catch (apiErr) {
            console.error('USDA API error, falling back to stale cache:', apiErr);

            // Degraded mode: try stale cache with no freshness restriction.
            const staleRows = await pool.query(
              `SELECT * FROM usda_foods
               WHERE to_tsvector('english', description) @@ plainto_tsquery('english', $1)
               LIMIT 20`,
              [q],
            );

            if (staleRows.rows.length > 0) {
              usdaResults = staleRows.rows.map(usdaRowToFoodResult);
              warnings.push('USDA is temporarily unavailable — showing cached results.');
            } else {
              warnings.push('USDA is temporarily unavailable.');
            }
          }
        }
      } catch (dbErr) {
        console.error('Cache query error:', dbErr);
        warnings.push('USDA results are temporarily unavailable.');
      }
    }

    const results = mergeResults(personalResults, usdaResults);
    res.json({ results, ...(warnings.length > 0 ? { warnings } : {}) });
  });

  return router;
}

// ── USDA detail router (mounted at /usda) ────────────────────────────────────

/**
 * Creates a router that handles GET /food/:fdcId under the /usda prefix.
 */
export function createUsdaRouter(pool: pg.Pool): Router {
  const router = Router();

  // GET /usda/food/:fdcId
  router.get('/food/:fdcId', async (req: Request, res: Response) => {
    const { fdcId } = req.params;

    // Validate: must be purely numeric.
    if (!/^\d+$/.test(fdcId)) {
      res.status(400).json({ error: 'fdcId must be a numeric string' });
      return;
    }

    try {
      // Check cache first.
      const { rows } = await pool.query(
        'SELECT * FROM usda_foods WHERE fdc_id = $1',
        [fdcId],
      );

      if (rows.length > 0) {
        const row = rows[0] as Record<string, unknown>;
        const cachedAt = row.cached_at as Date;
        const ageMs = Date.now() - cachedAt.getTime();
        const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

        if (ageMs < thirtyDaysMs) {
          // Fresh cache hit.
          res.json({ food: usdaRowToFoodResult(row) });
          return;
        }
        // Stale — fall through to fetch from USDA; we'll upsert and return fresh.
      }

      // Fetch from USDA API.
      let food;
      try {
        food = await fetchUsdaFood(fdcId);
      } catch (apiErr) {
        console.error('USDA fetch error:', apiErr);
        // If we have stale cache, return it with a warning rather than 503.
        if (rows.length > 0) {
          res.json({
            food: usdaRowToFoodResult(rows[0] as Record<string, unknown>),
            warnings: ['USDA is temporarily unavailable — showing cached result.'],
          });
          return;
        }
        res.status(503).json({ error: 'USDA service is temporarily unavailable' });
        return;
      }

      if (!food) {
        res.status(404).json({ error: 'Food not found' });
        return;
      }

      // Upsert into cache.
      await pool.query(
        `INSERT INTO usda_foods (fdc_id, description, brand_owner, data_type, nutrients, cached_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (fdc_id) DO UPDATE
           SET description = EXCLUDED.description,
               nutrients   = EXCLUDED.nutrients,
               cached_at   = NOW()`,
        [
          String(food.fdcId),
          food.description,
          food.brandOwner ?? null,
          food.dataType,
          JSON.stringify(food.foodNutrients),
        ],
      );

      res.json({ food: usdaApiToFoodResult(food) });
    } catch (err) {
      console.error('GET /usda/food/:fdcId error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
