import {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
} from 'react';
import { apiCall } from '../api/client.js';

interface User {
  id: string;
  email: string;
}

interface AuthCtx {
  user: User | null;
  accessToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  loading: boolean;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // On mount: attempt silent session restore via the httpOnly refresh-token cookie.
  useEffect(() => {
    async function restoreSession() {
      try {
        const { status, data } = await apiCall('/auth/refresh', { method: 'POST' });
        if (status === 200 && data) {
          const d = data as { accessToken: string };
          setAccessToken(d.accessToken);

          // Fetch the user profile with the fresh access token.
          const meRes = await apiCall('/auth/me', { method: 'GET' }, d.accessToken);
          if (meRes.status === 200 && meRes.data) {
            const md = meRes.data as { user: User };
            setUser(md.user);
          }
        }
      } catch {
        // No valid session — stay logged out.
      } finally {
        setLoading(false);
      }
    }

    void restoreSession();
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const { status, data } = await apiCall('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (status !== 200) {
      const d = data as { error?: string } | null;
      throw new Error(d?.error ?? 'Login failed');
    }

    const d = data as { accessToken: string; user: User };
    setAccessToken(d.accessToken);
    setUser(d.user);
  }

  async function logout(): Promise<void> {
    await apiCall('/auth/logout', { method: 'POST' }, accessToken);
    setAccessToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, accessToken, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
