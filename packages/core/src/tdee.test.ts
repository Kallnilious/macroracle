import { describe, it, expect } from 'vitest';
import { computeBMR, computeTDEE, computeTargets } from './tdee.js';
import type { ProfileInput } from './tdee.js';

// ── computeBMR ──────────────────────────────────────────────────────────────

describe('computeBMR', () => {
  it('calculates correctly for a 30yr male, 175cm, 80kg', () => {
    // 10*80 + 6.25*175 - 5*30 + 5 = 800 + 1093.75 - 150 + 5 = 1748.75
    expect(computeBMR(30, 'male', 175, 80)).toBeCloseTo(1748.75, 2);
  });

  it('calculates correctly for a 25yr female, 165cm, 65kg', () => {
    // 10*65 + 6.25*165 - 5*25 - 161 = 650 + 1031.25 - 125 - 161 = 1395.25
    expect(computeBMR(25, 'female', 165, 65)).toBeCloseTo(1395.25, 2);
  });

  it('female BMR is 166 kcal lower than male with same inputs', () => {
    const male = computeBMR(40, 'male', 170, 75);
    const female = computeBMR(40, 'female', 170, 75);
    // male offset +5, female offset -161  → difference = 166
    expect(male - female).toBeCloseTo(166, 5);
  });
});

// ── computeTDEE ─────────────────────────────────────────────────────────────

describe('computeTDEE', () => {
  it('multiplies BMR by the moderately_active factor (1.55)', () => {
    // BMR 1748.75 * 1.55 = 2710.5625
    expect(computeTDEE(1748.75, 'moderately_active')).toBeCloseTo(2710.5625, 2);
  });

  it('multiplies BMR by the sedentary factor (1.2)', () => {
    expect(computeTDEE(2000, 'sedentary')).toBeCloseTo(2400, 5);
  });

  it('multiplies BMR by the extra_active factor (1.9)', () => {
    expect(computeTDEE(1000, 'extra_active')).toBeCloseTo(1900, 5);
  });
});

// ── computeTargets — pinned reference case ───────────────────────────────────

describe('computeTargets — male 30yr 175cm 80kg moderately_active maintain', () => {
  const profile: ProfileInput = {
    age: 30,
    sex: 'male',
    height_cm: 175,
    weight_kg: 80,
    activity_level: 'moderately_active',
    goal: 'maintain',
  };

  it('returns the correct calories (2711)', () => {
    expect(computeTargets(profile).calories).toBe(2711);
  });

  it('returns tdee equal to calories when goal is maintain (2711)', () => {
    const result = computeTargets(profile);
    expect(result.tdee).toBe(2711);
    expect(result.calories).toBe(result.tdee);
  });

  it('returns protein_g = 203', () => {
    // Math.round(2711 * 0.30 / 4) = Math.round(203.325) = 203
    expect(computeTargets(profile).protein_g).toBe(203);
  });

  it('returns carbs_g = 305', () => {
    // Math.round(2711 * 0.45 / 4) = Math.round(304.9875) = 305
    expect(computeTargets(profile).carbs_g).toBe(305);
  });

  it('returns fat_g = 75', () => {
    // Math.round(2711 * 0.25 / 9) = Math.round(75.305...) = 75
    expect(computeTargets(profile).fat_g).toBe(75);
  });
});

// ── computeTargets — goal adjustments ───────────────────────────────────────

describe('computeTargets — goal adjustments', () => {
  const baseProfile: ProfileInput = {
    age: 30,
    sex: 'male',
    height_cm: 175,
    weight_kg: 80,
    activity_level: 'moderately_active',
    goal: 'maintain',
  };

  it('cut reduces calories by 500 vs maintain', () => {
    const maintain = computeTargets(baseProfile);
    const cut = computeTargets({ ...baseProfile, goal: 'cut' });
    expect(maintain.calories - cut.calories).toBe(500);
  });

  it('bulk increases calories by 300 vs maintain', () => {
    const maintain = computeTargets(baseProfile);
    const bulk = computeTargets({ ...baseProfile, goal: 'bulk' });
    expect(bulk.calories - maintain.calories).toBe(300);
  });

  it('tdee is unchanged regardless of goal', () => {
    const maintain = computeTargets(baseProfile);
    const cut = computeTargets({ ...baseProfile, goal: 'cut' });
    const bulk = computeTargets({ ...baseProfile, goal: 'bulk' });
    expect(cut.tdee).toBe(maintain.tdee);
    expect(bulk.tdee).toBe(maintain.tdee);
  });
});

// ── computeTargets — female bulking ─────────────────────────────────────────

describe('computeTargets — female 25yr 165cm 65kg lightly_active bulk', () => {
  const profile: ProfileInput = {
    age: 25,
    sex: 'female',
    height_cm: 165,
    weight_kg: 65,
    activity_level: 'lightly_active',
    goal: 'bulk',
  };

  it('calories = round(tdee + 300)', () => {
    const result = computeTargets(profile);
    // BMR = 1395.25, TDEE = 1395.25 * 1.375 = 1918.46875
    // adjusted = 1918.46875 + 300 = 2218.46875 → 2218
    expect(result.calories).toBe(2218);
  });

  it('tdee field reflects raw TDEE without bulk adjustment', () => {
    const result = computeTargets(profile);
    // round(1918.46875) = 1918
    expect(result.tdee).toBe(1918);
    // calories should be tdee + 300
    expect(result.calories).toBe(result.tdee + 300);
  });
});
