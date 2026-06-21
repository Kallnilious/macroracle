import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { apiCall } from '../api/client.js';

interface Food {
  id: string;
  name: string;
  brand: string | null;
  calories_per_100g: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  serving_size_g: number | null;
  serving_name: string | null;
  tags: string[];
}

const EMPTY_FORM = {
  name: '',
  brand: '',
  calories_per_100g: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
};

export function FoodsPage() {
  const { accessToken } = useAuth();

  const [foods, setFoods] = useState<Food[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  // ── Load foods on mount ─────────────────────────────────────────────────────
  useEffect(() => {
    async function loadFoods() {
      try {
        const res = await apiCall('/foods', { method: 'GET' }, accessToken);
        if (res.status === 200) {
          setFoods((res.data as { foods: Food[] }).foods);
        } else {
          setError('Failed to load foods');
        }
      } catch {
        setError('Failed to load foods');
      } finally {
        setLoading(false);
      }
    }
    void loadFoods();
  }, [accessToken]);

  // ── Form helpers ────────────────────────────────────────────────────────────
  function startEditing(food: Food) {
    setEditingId(food.id);
    setForm({
      name: food.name,
      brand: food.brand ?? '',
      calories_per_100g: String(food.calories_per_100g),
      protein_g: String(food.protein_g),
      carbs_g: String(food.carbs_g),
      fat_g: String(food.fat_g),
    });
    setFormError(null);
    setSuccessMessage(null);
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  }

  function updateField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // ── Submit: create or update ────────────────────────────────────────────────
  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    const body = {
      name: form.name,
      brand: form.brand || undefined,
      calories_per_100g: Number(form.calories_per_100g),
      protein_g: Number(form.protein_g),
      carbs_g: Number(form.carbs_g),
      fat_g: Number(form.fat_g),
    };

    try {
      if (editingId) {
        // Update existing food
        const res = await apiCall(
          `/foods/${editingId}`,
          { method: 'PUT', body: JSON.stringify(body) },
          accessToken,
        );
        if (res.status === 200) {
          const updated = (res.data as { food: Food }).food;
          setFoods((prev) => prev.map((f) => (f.id === editingId ? updated : f)));
          setSuccessMessage('The oracle has updated your food.');
          cancelEditing();
        } else {
          const d = res.data as { error?: string } | null;
          setFormError(d?.error ?? 'Failed to update food');
        }
      } else {
        // Create new food
        const res = await apiCall(
          '/foods',
          { method: 'POST', body: JSON.stringify(body) },
          accessToken,
        );
        if (res.status === 201) {
          const created = (res.data as { food: Food }).food;
          setFoods((prev) =>
            [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
          );
          setSuccessMessage('Food added to the oracle\'s knowledge.');
          setForm(EMPTY_FORM);
        } else {
          const d = res.data as { error?: string } | null;
          setFormError(d?.error ?? 'Failed to create food');
        }
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────
  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      const res = await apiCall(`/foods/${id}`, { method: 'DELETE' }, accessToken);
      if (res.status === 204) {
        setFoods((prev) => prev.filter((f) => f.id !== id));
        if (editingId === id) cancelEditing();
      } else {
        setError('Failed to delete food');
      }
    } catch {
      setError('Failed to delete food');
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return <main style={styles.main}><p>Loading your foods…</p></main>;
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <h2 style={styles.subheading}>Personal Foods</h2>

      {error && <p style={styles.error}>{error}</p>}

      {/* ── Food list ── */}
      {foods.length === 0 ? (
        <p style={styles.emptyNote}>No foods yet. Add one below.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Brand</th>
              <th style={styles.th}>kcal/100g</th>
              <th style={styles.th}>Protein</th>
              <th style={styles.th}>Carbs</th>
              <th style={styles.th}>Fat</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {foods.map((food) => (
              <tr
                key={food.id}
                style={editingId === food.id ? styles.rowEditing : styles.row}
              >
                <td style={styles.td}>{food.name}</td>
                <td style={styles.td}>{food.brand ?? '—'}</td>
                <td style={styles.td}>{food.calories_per_100g}</td>
                <td style={styles.td}>{food.protein_g}g</td>
                <td style={styles.td}>{food.carbs_g}g</td>
                <td style={styles.td}>{food.fat_g}g</td>
                <td style={styles.td}>
                  <button
                    onClick={() => startEditing(food)}
                    style={styles.editBtn}
                    disabled={submitting}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => void handleDelete(food.id, food.name)}
                    style={styles.deleteBtn}
                    disabled={submitting}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* ── Add / edit form ── */}
      <div style={styles.formSection}>
        <h3 style={styles.formHeading}>
          {editingId ? 'Edit Food' : 'Add Food'}
        </h3>

        {successMessage && <p style={styles.success}>{successMessage}</p>}
        {formError && <p style={styles.error}>{formError}</p>}

        <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
          <label style={styles.label}>
            Name *
            <input
              type="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              maxLength={200}
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Brand
            <input
              type="text"
              value={form.brand}
              onChange={(e) => updateField('brand', e.target.value)}
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Calories per 100g *
            <input
              type="number"
              value={form.calories_per_100g}
              onChange={(e) => updateField('calories_per_100g', e.target.value)}
              min={0}
              max={9000}
              step="0.01"
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Protein (g per 100g) *
            <input
              type="number"
              value={form.protein_g}
              onChange={(e) => updateField('protein_g', e.target.value)}
              min={0}
              max={100}
              step="0.01"
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Carbs (g per 100g) *
            <input
              type="number"
              value={form.carbs_g}
              onChange={(e) => updateField('carbs_g', e.target.value)}
              min={0}
              max={100}
              step="0.01"
              required
              style={styles.input}
            />
          </label>

          <label style={styles.label}>
            Fat (g per 100g) *
            <input
              type="number"
              value={form.fat_g}
              onChange={(e) => updateField('fat_g', e.target.value)}
              min={0}
              max={100}
              step="0.01"
              required
              style={styles.input}
            />
          </label>

          <div style={styles.formActions}>
            <button type="submit" disabled={submitting} style={styles.submitBtn}>
              {submitting
                ? editingId
                  ? 'Updating…'
                  : 'Adding…'
                : editingId
                  ? 'Update Food'
                  : 'Add Food'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={cancelEditing}
                disabled={submitting}
                style={styles.cancelBtn}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
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
  emptyNote: { color: '#6b7280', fontStyle: 'italic' },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: '2rem' },
  th: {
    textAlign: 'left',
    borderBottom: '2px solid #e5e7eb',
    padding: '0.5rem 0.75rem',
    fontSize: '0.85rem',
    color: '#374151',
  },
  td: { padding: '0.5rem 0.75rem', borderBottom: '1px solid #e5e7eb', fontSize: '0.9rem' },
  row: {},
  rowEditing: { background: '#eff6ff' },
  editBtn: {
    marginRight: '0.4rem',
    padding: '0.25rem 0.6rem',
    fontSize: '0.8rem',
    borderRadius: 4,
    border: '1px solid #2563eb',
    background: '#fff',
    color: '#2563eb',
    cursor: 'pointer',
  },
  deleteBtn: {
    padding: '0.25rem 0.6rem',
    fontSize: '0.8rem',
    borderRadius: 4,
    border: '1px solid #dc2626',
    background: '#fff',
    color: '#dc2626',
    cursor: 'pointer',
  },
  formSection: {
    borderTop: '2px solid #e5e7eb',
    paddingTop: '1.5rem',
  },
  formHeading: { marginTop: 0, marginBottom: '1rem' },
  form: { display: 'flex', flexDirection: 'column', gap: '0.9rem', maxWidth: 480 },
  label: { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.95rem' },
  input: { padding: '0.5rem', fontSize: '1rem', borderRadius: 4, border: '1px solid #ccc' },
  formActions: { display: 'flex', gap: '0.75rem', marginTop: '0.25rem' },
  submitBtn: {
    padding: '0.6rem 1.2rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '0.6rem 1.2rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: '1px solid #6b7280',
    background: '#fff',
    color: '#374151',
    cursor: 'pointer',
  },
  error: { color: '#dc2626', margin: '0 0 0.5rem' },
  success: { color: '#16a34a', margin: '0 0 0.5rem' },
};
