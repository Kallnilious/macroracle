import { FormEvent, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { apiCall } from '../api/client.js';

type Source = 'all' | 'personal' | 'usda';

interface FoodResult {
  id: string;
  source: 'personal' | 'usda';
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fdcId?: string;
  user_id?: string;
  data_type?: string;
}

interface SearchResponse {
  results: FoodResult[];
  warnings?: string[];
}

export function SearchPage() {
  const { accessToken } = useAuth();

  const [query, setQuery] = useState('');
  const [source, setSource] = useState<Source>('all');
  const [results, setResults] = useState<FoodResult[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setWarnings([]);
    setResults([]);

    try {
      const params = new URLSearchParams({ q: query.trim(), source });
      const res = await apiCall(
        `/foods/search?${params.toString()}`,
        { method: 'GET' },
        accessToken,
      );

      if (res.status === 400) {
        const d = res.data as { error?: string } | null;
        setError(d?.error ?? 'Invalid search query');
        return;
      }

      if (res.status === 401) {
        setError('Sign in to search personal foods');
        return;
      }

      if (res.status !== 200) {
        const d = res.data as { error?: string } | null;
        setError(d?.error ?? 'Search failed');
        return;
      }

      const data = res.data as SearchResponse;
      setResults(data.results);
      setWarnings(data.warnings ?? []);
      setSearched(true);
    } catch {
      setError('Search request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <h2 style={styles.subheading}>Food Search</h2>

      {/* ── Search form ── */}
      <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
        <div style={styles.inputRow}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search foods (e.g. oats, chicken breast)"
            style={styles.input}
            disabled={loading}
          />
          <button type="submit" disabled={loading || !query.trim()} style={styles.searchBtn}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </div>

        {/* ── Source toggle ── */}
        <div style={styles.toggleRow}>
          {(['all', 'personal', 'usda'] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              style={{
                ...styles.toggleBtn,
                ...(source === s ? styles.toggleBtnActive : {}),
              }}
              disabled={loading}
            >
              {s === 'all' ? 'All' : s === 'personal' ? 'My Foods' : 'USDA'}
            </button>
          ))}
        </div>
      </form>

      {/* ── Warning banner ── */}
      {warnings.length > 0 && (
        <div style={styles.warningBanner}>
          {warnings.map((w, i) => (
            <p key={i} style={styles.warningText}>
              {w}
            </p>
          ))}
        </div>
      )}

      {/* ── Error ── */}
      {error && <p style={styles.error}>{error}</p>}

      {/* ── Results ── */}
      {searched && !loading && results.length === 0 && !error && (
        <p style={styles.emptyNote}>The oracle found nothing. Try different words.</p>
      )}

      {results.length > 0 && (
        <ul style={styles.resultList}>
          {results.map((food) => (
            <li key={`${food.source}-${food.id}`} style={styles.resultItem}>
              <div style={styles.resultHeader}>
                <span style={styles.resultName}>{food.name}</span>
                <span
                  style={{
                    ...styles.badge,
                    ...(food.source === 'personal' ? styles.badgePersonal : styles.badgeUsda),
                  }}
                >
                  {food.source === 'personal' ? 'My Foods' : 'USDA'}
                </span>
              </div>
              {food.brand && (
                <p style={styles.resultBrand}>{food.brand}</p>
              )}
              <div style={styles.macroRow}>
                <span style={styles.macroItem}>
                  <strong>{food.calories_per_100g}</strong> kcal
                </span>
                <span style={styles.macroItem}>
                  <strong>{food.protein_g}g</strong> protein
                </span>
                <span style={styles.macroItem}>
                  <strong>{food.carbs_g}g</strong> carbs
                </span>
                <span style={styles.macroItem}>
                  <strong>{food.fat_g}g</strong> fat
                </span>
                <span style={styles.macroPer}>per 100g</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'sans-serif',
    maxWidth: 760,
    margin: '4rem auto',
    padding: '0 1rem',
  },
  heading: { textAlign: 'center', marginBottom: 0 },
  subheading: { textAlign: 'center', fontWeight: 'normal', marginTop: '0.25rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: '1.5rem' },
  inputRow: { display: 'flex', gap: '0.5rem' },
  input: {
    flex: 1,
    padding: '0.55rem 0.75rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: '1px solid #ccc',
  },
  searchBtn: {
    padding: '0.55rem 1.2rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  toggleRow: { display: 'flex', gap: '0.5rem' },
  toggleBtn: {
    padding: '0.35rem 0.9rem',
    fontSize: '0.9rem',
    borderRadius: 4,
    border: '1px solid #d1d5db',
    background: '#fff',
    color: '#374151',
    cursor: 'pointer',
  },
  toggleBtnActive: {
    background: '#2563eb',
    color: '#fff',
    border: '1px solid #2563eb',
  },
  warningBanner: {
    background: '#fffbeb',
    border: '1px solid #fbbf24',
    borderRadius: 4,
    padding: '0.6rem 1rem',
    marginBottom: '1rem',
  },
  warningText: { margin: 0, color: '#92400e', fontSize: '0.9rem' },
  error: { color: '#dc2626', marginBottom: '0.75rem' },
  emptyNote: { color: '#6b7280', fontStyle: 'italic' },
  resultList: { listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.75rem' },
  resultItem: {
    border: '1px solid #e5e7eb',
    borderRadius: 6,
    padding: '0.75rem 1rem',
  },
  resultHeader: { display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.25rem' },
  resultName: { fontWeight: 600, fontSize: '1rem' },
  badge: {
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.15rem 0.45rem',
    borderRadius: 3,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  badgePersonal: { background: '#dbeafe', color: '#1e40af' },
  badgeUsda: { background: '#dcfce7', color: '#166534' },
  resultBrand: { margin: '0 0 0.4rem', color: '#6b7280', fontSize: '0.85rem' },
  macroRow: { display: 'flex', gap: '1rem', alignItems: 'baseline', flexWrap: 'wrap' },
  macroItem: { fontSize: '0.9rem', color: '#374151' },
  macroPer: { fontSize: '0.8rem', color: '#9ca3af', marginLeft: 'auto' },
};
