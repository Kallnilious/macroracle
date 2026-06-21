import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { apiCall } from '../api/client.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MacroValues {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface Summary {
  targets: MacroValues & { tdee: number };
  consumed: MacroValues;
  remaining: MacroValues;
}

interface Food {
  id: string;
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

interface LogEntry {
  id: string;
  food_id: string;
  food_name: string;
  grams: number;
  logged_at: string;
  notes: string | null;
  macros: MacroValues;
}

// ── MacroBar component ────────────────────────────────────────────────────────

function MacroBar({
  label,
  consumed,
  target,
  unit = 'g',
}: {
  label: string;
  consumed: number;
  target: number;
  unit?: string;
}) {
  const pct = target > 0 ? Math.min((consumed / target) * 100, 100) : 0;
  const over = consumed > target;

  return (
    <div style={barStyles.wrapper}>
      <div style={barStyles.labelRow}>
        <span style={barStyles.label}>{label}</span>
        <span style={barStyles.numbers}>
          {consumed.toFixed(1)}{unit} / {target.toFixed(0)}{unit}
          {over && <span style={barStyles.overTag}> over</span>}
        </span>
      </div>
      <div style={barStyles.track}>
        <div
          style={{
            ...barStyles.fill,
            width: `${pct}%`,
            background: over ? '#dc2626' : '#2563eb',
          }}
        />
      </div>
    </div>
  );
}

const barStyles: Record<string, React.CSSProperties> = {
  wrapper: { marginBottom: '0.75rem' },
  labelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.9rem',
    marginBottom: '0.25rem',
  },
  label: { fontWeight: 600, color: '#374151' },
  numbers: { color: '#6b7280' },
  overTag: { color: '#dc2626', fontWeight: 700 },
  track: {
    height: 10,
    background: '#e5e7eb',
    borderRadius: 5,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 5,
    transition: 'width 0.3s ease',
  },
};

// ── TodaySummary component ────────────────────────────────────────────────────

function TodaySummary({
  summary,
  loading,
  error,
}: {
  summary: Summary | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <div style={styles.card}><p>Loading summary…</p></div>;
  if (error) return <div style={styles.card}><p style={styles.error}>{error}</p></div>;
  if (!summary) return null;

  const { targets, consumed, remaining } = summary;

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Today's Oracle Prophecy</h2>
      <p style={styles.tdee}>
        TDEE: <strong>{targets.tdee} kcal</strong>
        &nbsp;·&nbsp;Target: <strong>{targets.calories} kcal</strong>
      </p>

      <MacroBar
        label="Calories"
        consumed={consumed.calories}
        target={targets.calories}
        unit=" kcal"
      />
      <MacroBar label="Protein" consumed={consumed.protein_g} target={targets.protein_g} />
      <MacroBar label="Carbs" consumed={consumed.carbs_g} target={targets.carbs_g} />
      <MacroBar label="Fat" consumed={consumed.fat_g} target={targets.fat_g} />

      <div style={summaryStyles.remaining}>
        <strong>Remaining: </strong>
        <span>{remaining.calories.toFixed(1)} kcal&nbsp;·&nbsp;</span>
        <span>{remaining.protein_g.toFixed(1)}g P&nbsp;·&nbsp;</span>
        <span>{remaining.carbs_g.toFixed(1)}g C&nbsp;·&nbsp;</span>
        <span>{remaining.fat_g.toFixed(1)}g F</span>
      </div>
    </div>
  );
}

const summaryStyles: Record<string, React.CSSProperties> = {
  remaining: {
    marginTop: '0.75rem',
    padding: '0.5rem 0.75rem',
    background: '#f9fafb',
    borderRadius: 6,
    fontSize: '0.9rem',
    color: '#374151',
  },
};

// ── LogEntryForm component ────────────────────────────────────────────────────

function LogEntryForm({
  foods,
  accessToken,
  onLogged,
}: {
  foods: Food[];
  accessToken: string | null | undefined;
  onLogged: () => void;
}) {
  const [foodId, setFoodId] = useState('');
  const [grams, setGrams] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!foodId) {
      setError('Select a food.');
      return;
    }
    const gramsNum = Number(grams);
    if (!grams || isNaN(gramsNum) || gramsNum <= 0) {
      setError('Enter a positive amount in grams.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiCall(
        '/log',
        {
          method: 'POST',
          body: JSON.stringify({ food_id: foodId, grams: gramsNum, notes: notes || undefined }),
        },
        accessToken,
      );
      if (res.status === 201) {
        setSuccess('Logged. The oracle has recorded your intake.');
        setFoodId('');
        setGrams('');
        setNotes('');
        onLogged();
      } else {
        const d = res.data as { error?: string } | null;
        setError(d?.error ?? 'Failed to log entry');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Log Food</h2>
      {success && <p style={styles.success}>{success}</p>}
      {error && <p style={styles.error}>{error}</p>}

      <form onSubmit={(e) => void handleSubmit(e)} style={formStyles.form}>
        <label style={formStyles.label}>
          Food
          <select
            value={foodId}
            onChange={(e) => setFoodId(e.target.value)}
            style={formStyles.select}
            required
          >
            <option value="">— select a food —</option>
            {foods.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}{f.brand ? ` (${f.brand})` : ''} — {f.calories_per_100g} kcal/100g
              </option>
            ))}
          </select>
        </label>

        <label style={formStyles.label}>
          Amount (grams)
          <input
            type="number"
            value={grams}
            onChange={(e) => setGrams(e.target.value)}
            min={0.01}
            step="0.01"
            required
            style={formStyles.input}
            placeholder="e.g. 150"
          />
        </label>

        <label style={formStyles.label}>
          Notes (optional)
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={formStyles.input}
            placeholder="e.g. post-workout"
          />
        </label>

        <button type="submit" disabled={submitting} style={formStyles.submitBtn}>
          {submitting ? 'Logging…' : 'Log It'}
        </button>
      </form>
    </div>
  );
}

const formStyles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 420 },
  label: { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.95rem' },
  select: { padding: '0.5rem', fontSize: '1rem', borderRadius: 4, border: '1px solid #ccc' },
  input: { padding: '0.5rem', fontSize: '1rem', borderRadius: 4, border: '1px solid #ccc' },
  submitBtn: {
    padding: '0.6rem 1.2rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
};

// ── EntryList component ───────────────────────────────────────────────────────

function EntryList({
  entries,
  loading,
  onDelete,
}: {
  entries: LogEntry[];
  loading: boolean;
  onDelete: (id: string) => void;
}) {
  if (loading) return <div style={styles.card}><p>Loading entries…</p></div>;

  return (
    <div style={styles.card}>
      <h2 style={styles.cardTitle}>Today's Entries</h2>
      {entries.length === 0 ? (
        <p style={{ color: '#6b7280', fontStyle: 'italic' }}>Nothing logged yet today.</p>
      ) : (
        <table style={entryStyles.table}>
          <thead>
            <tr>
              <th style={entryStyles.th}>Food</th>
              <th style={entryStyles.th}>Grams</th>
              <th style={entryStyles.th}>kcal</th>
              <th style={entryStyles.th}>P</th>
              <th style={entryStyles.th}>C</th>
              <th style={entryStyles.th}>F</th>
              <th style={entryStyles.th}></th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td style={entryStyles.td}>
                  {e.food_name}
                  {e.notes && (
                    <span style={entryStyles.notes}> · {e.notes}</span>
                  )}
                </td>
                <td style={entryStyles.td}>{e.grams}g</td>
                <td style={entryStyles.td}>{e.macros.calories.toFixed(1)}</td>
                <td style={entryStyles.td}>{e.macros.protein_g.toFixed(1)}g</td>
                <td style={entryStyles.td}>{e.macros.carbs_g.toFixed(1)}g</td>
                <td style={entryStyles.td}>{e.macros.fat_g.toFixed(1)}g</td>
                <td style={entryStyles.td}>
                  <button
                    onClick={() => onDelete(e.id)}
                    style={entryStyles.deleteBtn}
                    title="Remove entry"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const entryStyles: Record<string, React.CSSProperties> = {
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    borderBottom: '2px solid #e5e7eb',
    padding: '0.4rem 0.6rem',
    fontSize: '0.8rem',
    color: '#6b7280',
  },
  td: { padding: '0.4rem 0.6rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.9rem' },
  notes: { color: '#9ca3af', fontSize: '0.8rem' },
  deleteBtn: {
    background: 'none',
    border: '1px solid #dc2626',
    color: '#dc2626',
    borderRadius: 4,
    padding: '0.1rem 0.4rem',
    cursor: 'pointer',
    fontSize: '1rem',
    lineHeight: 1,
  },
};

// ── LogPage ───────────────────────────────────────────────────────────────────

export function LogPage() {
  const { accessToken } = useAuth();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(true);

  const [foods, setFoods] = useState<Food[]>([]);

  // Load summary
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await apiCall('/log/summary', { method: 'GET' }, accessToken);
      if (res.status === 200) {
        setSummary(res.data as Summary);
      } else if (res.status === 422) {
        setSummaryError('Set up your profile first to see macro targets.');
      } else {
        setSummaryError('Failed to load summary');
      }
    } catch {
      setSummaryError('Failed to load summary');
    } finally {
      setSummaryLoading(false);
    }
  }, [accessToken]);

  // Load today's entries
  const loadEntries = useCallback(async () => {
    setEntriesLoading(true);
    try {
      const res = await apiCall('/log/today', { method: 'GET' }, accessToken);
      if (res.status === 200) {
        setEntries((res.data as { entries: LogEntry[] }).entries);
      }
    } catch {
      // silently ignore — entries stay empty
    } finally {
      setEntriesLoading(false);
    }
  }, [accessToken]);

  // Load user's foods for the form
  const loadFoods = useCallback(async () => {
    try {
      const res = await apiCall('/foods', { method: 'GET' }, accessToken);
      if (res.status === 200) {
        setFoods((res.data as { foods: Food[] }).foods);
      }
    } catch {
      // silently ignore
    }
  }, [accessToken]);

  useEffect(() => {
    void loadSummary();
    void loadEntries();
    void loadFoods();
  }, [loadSummary, loadEntries, loadFoods]);

  // Called after a successful log POST — refresh both
  function handleLogged() {
    void loadSummary();
    void loadEntries();
  }

  // Delete entry
  async function handleDelete(id: string) {
    if (!confirm('Remove this entry?')) return;
    try {
      const res = await apiCall(`/log/${id}`, { method: 'DELETE' }, accessToken);
      if (res.status === 204) {
        setEntries((prev) => prev.filter((e) => e.id !== id));
        void loadSummary();
      }
    } catch {
      // silently ignore
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <h2 style={styles.subheading}>Daily Food Log</h2>

      <TodaySummary
        summary={summary}
        loading={summaryLoading}
        error={summaryError}
      />

      <LogEntryForm
        foods={foods}
        accessToken={accessToken}
        onLogged={handleLogged}
      />

      <EntryList
        entries={entries}
        loading={entriesLoading}
        onDelete={(id) => void handleDelete(id)}
      />
    </main>
  );
}

// ── Global page styles ────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'sans-serif',
    maxWidth: 760,
    margin: '4rem auto',
    padding: '0 1rem',
  },
  heading: { textAlign: 'center', marginBottom: 0 },
  subheading: { textAlign: 'center', fontWeight: 'normal', marginTop: '0.25rem', marginBottom: '1.5rem' },
  card: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '1.25rem 1.5rem',
    marginBottom: '1.5rem',
  },
  cardTitle: { marginTop: 0, marginBottom: '1rem', fontSize: '1.1rem', color: '#111827' },
  tdee: { fontSize: '0.9rem', color: '#6b7280', marginTop: 0, marginBottom: '1rem' },
  error: { color: '#dc2626', margin: '0 0 0.5rem' },
  success: { color: '#16a34a', margin: '0 0 0.5rem' },
};
