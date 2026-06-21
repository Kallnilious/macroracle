const BASE = 'https://api.nal.usda.gov/fdc/v1';

function getApiKey(): string {
  const key = process.env.USDA_API_KEY;
  if (!key) throw new Error('USDA_API_KEY is not set');
  return key;
}

export interface UsdaSearchFood {
  fdcId: number;
  description: string;
  brandOwner?: string;
  dataType: string;
  foodNutrients: Array<{ nutrientNumber: string; value: number }>;
}

export async function searchUsda(query: string): Promise<UsdaSearchFood[]> {
  const key = getApiKey();
  const url = `${BASE}/foods/search?query=${encodeURIComponent(query)}&api_key=${key}&pageSize=20`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`USDA API error: ${res.status}`);
  }
  const data = (await res.json()) as { foods?: UsdaSearchFood[] };
  return data.foods ?? [];
}

export async function fetchUsdaFood(fdcId: string): Promise<UsdaSearchFood | null> {
  const key = getApiKey();
  const url = `${BASE}/food/${fdcId}?api_key=${key}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`USDA API error: ${res.status}`);
  const data = (await res.json()) as UsdaSearchFood;
  return data;
}
