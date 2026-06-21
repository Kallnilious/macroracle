import { describe, it, expect } from 'vitest';
import { computeEntryMacros, sumMacros, computeRemaining } from './macros.js';

// Reference food: chicken breast
const CHICKEN = {
  calories_per_100g: 165,
  protein_g: 31,
  carbs_g: 0,
  fat_g: 3.6,
};

describe('computeEntryMacros', () => {
  it('computes correct macros for 150g of chicken breast', () => {
    const result = computeEntryMacros(CHICKEN, 150);
    expect(result.calories).toBe(247.5);
    expect(result.protein_g).toBe(46.5);
    expect(result.carbs_g).toBe(0);
    expect(result.fat_g).toBe(5.4);
  });

  it('computes correct macros for 100g (identity case)', () => {
    const result = computeEntryMacros(CHICKEN, 100);
    expect(result.calories).toBe(165);
    expect(result.protein_g).toBe(31);
    expect(result.carbs_g).toBe(0);
    expect(result.fat_g).toBe(3.6);
  });

  it('computes correct macros for 1g (edge: smallest valid DB value)', () => {
    const result = computeEntryMacros(CHICKEN, 1);
    expect(result.calories).toBe(1.65);
    expect(result.protein_g).toBe(0.31);
    expect(result.carbs_g).toBe(0);
    expect(result.fat_g).toBe(0.04);
  });

  it('rounds to 2 decimal places', () => {
    // 1g of a food with protein_g=31 → 31*1/100 = 0.31 (clean)
    // Use a food that triggers rounding: calories_per_100g=200, 33g → 66.00
    const food = { calories_per_100g: 200, protein_g: 10, carbs_g: 33.333, fat_g: 5 };
    const result = computeEntryMacros(food, 33);
    // carbs: 33.333 * 33 / 100 = 10.99989 → rounds to 11
    expect(result.carbs_g).toBe(11);
  });
});

describe('sumMacros', () => {
  it('returns zero totals for an empty array', () => {
    const result = sumMacros([]);
    expect(result).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  it('sums two macro entries correctly', () => {
    const a = { calories: 247.5, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 };
    const b = { calories: 100, protein_g: 10, carbs_g: 20, fat_g: 3 };
    const result = sumMacros([a, b]);
    expect(result.calories).toBe(347.5);
    expect(result.protein_g).toBe(56.5);
    expect(result.carbs_g).toBe(20);
    expect(result.fat_g).toBe(8.4);
  });

  it('sums a single entry (identity)', () => {
    const m = { calories: 200, protein_g: 25, carbs_g: 10, fat_g: 5 };
    expect(sumMacros([m])).toEqual(m);
  });

  it('sums three entries and rounds at each step', () => {
    const entries = [
      { calories: 100.33, protein_g: 10.33, carbs_g: 5.33, fat_g: 2.33 },
      { calories: 100.33, protein_g: 10.33, carbs_g: 5.33, fat_g: 2.33 },
      { calories: 100.33, protein_g: 10.33, carbs_g: 5.33, fat_g: 2.33 },
    ];
    const result = sumMacros(entries);
    // Each step rounds: 100.33+100.33=200.66, 200.66+100.33=300.99
    expect(result.calories).toBe(300.99);
    expect(result.protein_g).toBe(30.99);
  });
});

describe('computeRemaining', () => {
  it('returns positive remaining when consumed is below targets', () => {
    const targets = { calories: 2711, protein_g: 203, carbs_g: 305, fat_g: 75 };
    const consumed = { calories: 247.5, protein_g: 46.5, carbs_g: 0, fat_g: 5.4 };
    const result = computeRemaining(targets, consumed);
    expect(result.calories).toBe(2463.5);
    expect(result.protein_g).toBe(156.5);
    expect(result.carbs_g).toBe(305);
    expect(result.fat_g).toBe(69.6);
  });

  it('returns negative remaining when consumed exceeds targets (over target is OK)', () => {
    const targets = { calories: 200, protein_g: 20, carbs_g: 30, fat_g: 5 };
    const consumed = { calories: 300, protein_g: 35, carbs_g: 40, fat_g: 10 };
    const result = computeRemaining(targets, consumed);
    expect(result.calories).toBe(-100);
    expect(result.protein_g).toBe(-15);
    expect(result.carbs_g).toBe(-10);
    expect(result.fat_g).toBe(-5);
  });

  it('returns zero when consumed exactly equals targets', () => {
    const targets = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 55 };
    const result = computeRemaining(targets, targets);
    expect(result).toEqual({ calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});
