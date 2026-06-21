import { FormEvent, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiCall } from '../api/client.js';

export function RegisterPage() {
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);

    try {
      const { status, data } = await apiCall('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });

      if (status === 201) {
        navigate('/login', { replace: true });
        return;
      }

      const d = data as { error?: string } | null;
      setError(d?.error ?? 'Registration failed');
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <h2 style={styles.subheading}>Create an account</h2>

      <form onSubmit={handleSubmit} style={styles.form}>
        {error && <p style={styles.error}>{error}</p>}

        <label style={styles.label}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={styles.input}
          />
        </label>

        <label style={styles.label}>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
            style={styles.input}
          />
        </label>

        <button type="submit" disabled={submitting} style={styles.button}>
          {submitting ? 'Creating account…' : 'Register'}
        </button>
      </form>

      <p style={styles.footer}>
        Already have an account?{' '}
        <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'sans-serif',
    maxWidth: 360,
    margin: '4rem auto',
    padding: '0 1rem',
  },
  heading: { textAlign: 'center', marginBottom: 0 },
  subheading: { textAlign: 'center', fontWeight: 'normal', marginTop: '0.25rem' },
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
  footer: { textAlign: 'center', marginTop: '1rem' },
};
