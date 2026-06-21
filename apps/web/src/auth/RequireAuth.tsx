import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext.js';

interface Props {
  children: ReactNode;
}

/**
 * Wraps a route so it redirects to /login when no access token is present.
 * While the session is being restored from the cookie it renders nothing.
 */
export function RequireAuth({ children }: Props) {
  const { accessToken, loading } = useAuth();

  if (loading) {
    // Avoid a flash-redirect while the refresh call is in-flight.
    return null;
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
