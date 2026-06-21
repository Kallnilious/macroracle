import { useAuth } from '../auth/AuthContext.js';

export function HomePage() {
  const { user, logout } = useAuth();

  async function handleLogout() {
    await logout();
    // AuthContext clears the token; RequireAuth will redirect to /login.
  }

  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Macroracle</h1>
      <p style={styles.prophecy}>The oracle is ready.</p>

      {user && (
        <p style={styles.welcome}>
          Welcome, <strong>{user.email}</strong>!
        </p>
      )}

      <button onClick={handleLogout} style={styles.button}>
        Sign out
      </button>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    fontFamily: 'sans-serif',
    textAlign: 'center',
    marginTop: '4rem',
    padding: '0 1rem',
  },
  heading: { fontSize: '2rem' },
  prophecy: { color: '#6b7280', fontStyle: 'italic' },
  welcome: { fontSize: '1.1rem', margin: '1.5rem 0' },
  button: {
    padding: '0.6rem 1.2rem',
    fontSize: '1rem',
    borderRadius: 4,
    border: '1px solid #d1d5db',
    background: '#fff',
    cursor: 'pointer',
  },
};
