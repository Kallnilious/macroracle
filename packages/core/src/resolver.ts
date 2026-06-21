export interface FoodResult {
  id: string;
  source: 'personal' | 'usda';
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fdcId?: string;    // only for usda
  user_id?: string;  // only for personal
  data_type?: string; // only for usda
}

/**
 * Merge personal results (ranked first) with USDA results.
 * Personal foods shadow USDA foods with the same name+brand (case-insensitive).
 * When brand is null on both sides, null == null and they are considered matching.
 */
export function mergeResults(personal: FoodResult[], usda: FoodResult[]): FoodResult[] {
  // Build a set of "name|brand" keys from personal results for fast dedup lookup.
  const personalKeys = new Set<string>(
    personal.map((f) => shadowKey(f.name, f.brand)),
  );

  // Keep only USDA results whose name+brand combo is NOT already covered by personal.
  const filteredUsda = usda.filter(
    (f) => !personalKeys.has(shadowKey(f.name, f.brand)),
  );

  return [...personal, ...filteredUsda];
}

/**
 * Produces a lowercase, trimmed "name|brand" key used for shadowing comparisons.
 * Null brand normalises to empty string so null == null.
 */
function shadowKey(name: string, brand: string | null): string {
  return `${name.trim().toLowerCase()}|${(brand ?? '').trim().toLowerCase()}`;
}

/**
 * Extract macro values from a USDA nutrients JSONB row.
 *
 * Nutrient numbers:
 *   208 = Energy (kcal)
 *   203 = Protein
 *   205 = Carbohydrate, by difference
 *   204 = Total lipid (fat)
 *
 * Missing nutrients default to 0.
 */
export function extractMacros(row: {
  fdc_id: string;
  description: string;
  brand_owner: string | null;
  data_type: string;
  nutrients: Array<{ nutrientNumber: string; value: number }>;
  cached_at: string;
}): FoodResult {
  const get = (num: string): number => {
    const entry = row.nutrients.find((n) => n.nutrientNumber === num);
    return entry?.value ?? 0;
  };

  return {
    id: row.fdc_id,
    source: 'usda',
    name: row.description,
    brand: row.brand_owner ?? null,
    calories_per_100g: get('208'),
    protein_g: get('203'),
    carbs_g: get('205'),
    fat_g: get('204'),
    fdcId: row.fdc_id,
    data_type: row.data_type,
  };
}
