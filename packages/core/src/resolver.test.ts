import { describe, it, expect } from 'vitest';
import { mergeResults, extractMacros, FoodResult } from './resolver.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makePersonal(overrides: Partial<FoodResult> = {}): FoodResult {
  return {
    id: 'p-1',
    source: 'personal',
    name: 'Oats',
    brand: 'Quaker',
    calories_per_100g: 380,
    protein_g: 13,
    carbs_g: 68,
    fat_g: 7,
    user_id: 'user-abc',
    ...overrides,
  };
}

function makeUsda(overrides: Partial<FoodResult> = {}): FoodResult {
  return {
    id: '747448',
    source: 'usda',
    name: 'Oats',
    brand: 'Quaker',
    calories_per_100g: 389,
    protein_g: 16.9,
    carbs_g: 66.3,
    fat_g: 6.9,
    fdcId: '747448',
    data_type: 'Foundation',
    ...overrides,
  };
}

const USDA_ROW = {
  fdc_id: '747448',
  description: 'Oats, whole grain',
  brand_owner: null as string | null,
  data_type: 'Foundation',
  nutrients: [
    { nutrientNumber: '208', value: 389 },
    { nutrientNumber: '203', value: 16.9 },
    { nutrientNumber: '205', value: 66.3 },
    { nutrientNumber: '204', value: 6.9 },
  ],
  cached_at: '2026-06-21T00:00:00.000Z',
};

// ── mergeResults ───────────────────────────────────────────────────────────────

describe('mergeResults', () => {
  it('returns personal results only when usda is empty', () => {
    const p = [makePersonal()];
    const result = mergeResults(p, []);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('personal');
  });

  it('returns usda results only when personal is empty', () => {
    const u = [makeUsda()];
    const result = mergeResults([], u);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('usda');
  });

  it('places personal results before usda results in merged output', () => {
    const p = [makePersonal({ id: 'p-1', name: 'Banana', brand: null })];
    const u = [makeUsda({ id: 'u-1', name: 'Apple', brand: null })];
    const result = mergeResults(p, u);
    expect(result).toHaveLength(2);
    expect(result[0].source).toBe('personal');
    expect(result[1].source).toBe('usda');
  });

  it('suppresses usda food when personal has the same name+brand (dedup)', () => {
    const p = [makePersonal()]; // name='Oats', brand='Quaker'
    const u = [makeUsda()];     // name='Oats', brand='Quaker'
    const result = mergeResults(p, u);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('personal');
  });

  it('does NOT dedup when name matches but brands differ', () => {
    const p = [makePersonal({ brand: 'Quaker' })];
    const u = [makeUsda({ brand: 'Bob\'s Red Mill' })];
    const result = mergeResults(p, u);
    expect(result).toHaveLength(2);
  });

  it('deduplicates case-insensitively (name and brand)', () => {
    const p = [makePersonal({ name: 'oats', brand: 'quaker' })];
    const u = [makeUsda({ name: 'Oats', brand: 'QUAKER' })];
    const result = mergeResults(p, u);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('personal');
  });

  it('deduplicates when both have null brand', () => {
    const p = [makePersonal({ name: 'Oats', brand: null })];
    const u = [makeUsda({ name: 'Oats', brand: null })];
    const result = mergeResults(p, u);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe('personal');
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeResults([], [])).toEqual([]);
  });
});

// ── extractMacros ──────────────────────────────────────────────────────────────

describe('extractMacros', () => {
  it('extracts all four nutrients correctly', () => {
    const result = extractMacros(USDA_ROW);
    expect(result.calories_per_100g).toBe(389);
    expect(result.protein_g).toBe(16.9);
    expect(result.carbs_g).toBe(66.3);
    expect(result.fat_g).toBe(6.9);
  });

  it('defaults fat_g to 0 when nutrient 204 is absent', () => {
    const row = {
      ...USDA_ROW,
      nutrients: USDA_ROW.nutrients.filter((n) => n.nutrientNumber !== '204'),
    };
    const result = extractMacros(row);
    expect(result.fat_g).toBe(0);
  });

  it('defaults protein_g to 0 when nutrient 203 is absent', () => {
    const row = {
      ...USDA_ROW,
      nutrients: USDA_ROW.nutrients.filter((n) => n.nutrientNumber !== '203'),
    };
    const result = extractMacros(row);
    expect(result.protein_g).toBe(0);
  });

  it('sets source to "usda" and fdcId matches fdc_id', () => {
    const result = extractMacros(USDA_ROW);
    expect(result.source).toBe('usda');
    expect(result.fdcId).toBe('747448');
    expect(result.id).toBe('747448');
  });

  it('maps description to name and brand_owner to brand', () => {
    const result = extractMacros(USDA_ROW);
    expect(result.name).toBe('Oats, whole grain');
    expect(result.brand).toBeNull();
  });

  it('maps brand_owner string value to brand', () => {
    const row = { ...USDA_ROW, brand_owner: 'Quaker' };
    const result = extractMacros(row);
    expect(result.brand).toBe('Quaker');
  });
});
