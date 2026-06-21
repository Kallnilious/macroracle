import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { apiCall } from '../api/client.js';

type Sex = 'male' | 'female';
type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extra_active';
type Goal = 'cut' | 'maintain' | 'bulk';

interface Profile {
  age: number;
  sex: Sex;
  height_cm: number;
  weight_kg: number;
  activity_level: ActivityLevel;
  goal: Goal;
}

interface MacroTargets {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  tdee: number;
}

const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary (little or no exercise)',
  lightly_active: 'Lightly Active (1-3 days/week)',
  moderately_active: 'Moderately Active (3-5 days/week)',
  very_active: 'Very Active (6-7 days/week)',
  extra_active: 'Extra Active (physical job or 2x training)',
};

const GOAL_LABELS: Record<Goal, string> = {
  cut: 'Cut (lose fat, -500 kcal/day)',
  maintain: 'Maintain (stay at current weight)',
  bulk: 'Bulk (gain muscle, +300 kcal/day)',
};

export function ProfilePage() {
  const { accessToken } = useAuth();

  // Form state
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('male');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('moderately_active');
  const [goal, setGoal] = useState<Goal>('maintain');

  // UI state
  const [targets, setTargets] = useState<MacroTargets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Load existing profile on mount
  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await apiCall('/profile', { method: 'GET' }, accessToken);
        if (res.status === 200 && res.data) {
          const d = res.data as { profile: Profile; targets: MacroTargets };
          const p = d.profile;
          setAge(String(p.age));
          setSex(p.sex);
          setHeightCm(String(p.height_cm));
          setWeightKg(String(p.weight_kg));
          setActivityLevel(p.activity_level);
          setGoal(p.goal);
          setTargets(d.targets);
        }
        // 404 = no profile yet, leave form empty
      } catch {
        // non-fatal, user just hasn't set up a profile
      } finally {
        setLoadingProfile(false);
      }
    }

    void loadProfile();
  }, [accessToken]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);
    setSubmitting(true);

    try {
      const res = await apiCall(
        '/profile',
        {
          method: 'PUT',
          body: JSON.stringify({
            age: Number(age),
            sex,
            height_cm: Number(heightCm),
            weight_kg: Number(weightKg),
            activity_level: activityLevel,
            goal,
          }),
        },
        accessToken,
      );

      if (res.status === 200 && res.data) {
        const d = res.data as { profile: Profile; targets: MacroTargets };
        setTargets(d.targets);
        setSuccessMessage('Profile saved! The oracle has updated your prophecy.');
      } else {
        const d = res.data as { error?: string } | null;
        setError(d?.error ?? 'Failed to save profile');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingProfile) {
    return <main style={styles.main}><p>Loading your profile…</p></main>;
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <h2 style={styles.subheading}>Your Profile</h2>

      {targets && (
        <div style={styles.targetsBox}>
          <strong>Daily prophecy:</strong>{' '}
          {targets.calories} kcal | {targets.protein_g}g protein | {targets.carbs_g}g carbs | {targets.fat_g}g fat
        </div>
      )}

      {successMessage && <p style={styles.success}>{successMessage}</p>}
      {error && <p style={styles.error}>{error}</p>}

      <form onSubmit={handleSubmit} style={styles.form}>
        <label style={styles.label}>
          Age
          <input
            type="number"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            min={13}
            max={120}
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Sex
          <select
            value={sex}
            onChange={(e) => setSex(e.target.value as Sex)}
            required
            style={styles.input}
          >
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>

        <label style={styles.label}>
          Height (cm)
          <input
            type="number"
            value={heightCm}
            onChange={(e) => setHeightCm(e.target.value)}
            min={50}
            max={300}
            step="0.1"
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Weight (kg)
          <input
            type="number"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            min={20}
            max={500}
            step="0.01"
            required
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Activity Level
          <select
            value={activityLevel}
            onChange={(e) => setActivityLevel(e.target.value as ActivityLevel)}
            required
            style={styles.input}
          >
            {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((level) => (
              <option key={level} value={level}>
                {ACTIVITY_LABELS[level]}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.label}>
          Goal
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            required
            style={styles.input}
          >
            {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
              <option key={g} value={g}>
                {GOAL_LABELS[g]}
              </option>
            ))}
          </select>
        </label>

        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Consulting the oracle…' : 'Save Profile'}
        </button>
      </form>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'sans-serif',
    maxWidth: 480,
    margin: '4rem auto',
    padding: '0 1rem',
  },
  heading: { textAlign: 'center', marginBottom: 0 },
  subheading: { textAlign: 'center', fontWeight: 'normal', marginTop: '0.25rem' },
  targetsBox: {
    background: '#f0fdf4',
    border: '1px solid #86efac',
    borderRadius: 6,
    padding: '0.75rem 1rem',
    marginBottom: '1rem',
    fontSize: '0.95rem',
    lineHeight: 1.6,
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.95rem' },
  input: { padding: '0.5rem', fontSize: '1rem', borderRadius: 4, border: '1px solid #ccc' },
  button: {
    padding: '0.6rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  },
  error: { color: '#dc2626', margin: 0 },
  success: { color: '#16a34a', margin: 0 },
};
