export type Sex = 'male' | 'female';
export type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extra_active';
export type Goal = 'cut' | 'maintain' | 'bulk';

export interface ProfileInput {
  age: number;
  sex: Sex;
  height_cm: number;
  weight_kg: number;
  activity_level: ActivityLevel;
  goal: Goal;
}

export interface MacroTargets {
  /** kcal/day rounded to whole number */
  calories: number;
  /** grams/day */
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Raw TDEE before goal adjustment */
  tdee: number;
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

const GOAL_ADJUSTMENTS: Record<Goal, number> = {
  cut: -500,
  maintain: 0,
  bulk: 300,
};

/**
 * Mifflin-St Jeor BMR formula.
 * Male:   10*weight_kg + 6.25*height_cm - 5*age + 5
 * Female: 10*weight_kg + 6.25*height_cm - 5*age - 161
 */
export function computeBMR(
  age: number,
  sex: Sex,
  height_cm: number,
  weight_kg: number,
): number {
  const base = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Multiply BMR by the Harris activity factor. */
export function computeTDEE(bmr: number, activity_level: ActivityLevel): number {
  return bmr * ACTIVITY_MULTIPLIERS[activity_level];
}

/**
 * Compute daily macro targets from a user profile.
 *
 * Macro split (of adjusted calories):
 *   Protein 30% — 4 kcal/g
 *   Carbs   45% — 4 kcal/g
 *   Fat     25% — 9 kcal/g
 */
export function computeTargets(profile: ProfileInput): MacroTargets {
  const bmr = computeBMR(profile.age, profile.sex, profile.height_cm, profile.weight_kg);
  const tdee = computeTDEE(bmr, profile.activity_level);
  const adjusted = tdee + GOAL_ADJUSTMENTS[profile.goal];
  const calories = Math.round(adjusted);

  const protein_g = Math.round((calories * 0.3) / 4);
  const carbs_g = Math.round((calories * 0.45) / 4);
  const fat_g = Math.round((calories * 0.25) / 9);

  return {
    calories,
    protein_g,
    carbs_g,
    fat_g,
    tdee: Math.round(tdee),
  };
}
