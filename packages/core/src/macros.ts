export interface MacroValues {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

/** Compute macros for a given amount of food (grams consumed). */
export function computeEntryMacros(
  food: { calories_per_100g: number; protein_g: number; carbs_g: number; fat_g: number },
  grams: number,
): MacroValues {
  return {
    calories:  round2(food.calories_per_100g * grams / 100),
    protein_g: round2(food.protein_g         * grams / 100),
    carbs_g:   round2(food.carbs_g           * grams / 100),
    fat_g:     round2(food.fat_g             * grams / 100),
  };
}

/** Sum an array of MacroValues. */
export function sumMacros(entries: MacroValues[]): MacroValues {
  return entries.reduce(
    (acc, m) => ({
      calories:  round2(acc.calories  + m.calories),
      protein_g: round2(acc.protein_g + m.protein_g),
      carbs_g:   round2(acc.carbs_g   + m.carbs_g),
      fat_g:     round2(acc.fat_g     + m.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

/** Compute remaining macros = targets - consumed. Values can be negative (over target). */
export function computeRemaining(
  targets: MacroValues,
  consumed: MacroValues,
): MacroValues {
  return {
    calories:  round2(targets.calories  - consumed.calories),
    protein_g: round2(targets.protein_g - consumed.protein_g),
    carbs_g:   round2(targets.carbs_g   - consumed.carbs_g),
    fat_g:     round2(targets.fat_g     - consumed.fat_g),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
