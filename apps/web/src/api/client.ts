/**
 * Thin fetch wrapper for API calls.
 *
 * Path is relative to /api (e.g. "/auth/login").
 * When an accessToken is provided it is sent as a Bearer header.
 * Credentials are always included so httpOnly cookies flow through.
 */
export async function apiCall(
  path: string,
  options: RequestInit = {},
  accessToken?: string | null,
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) ?? {}),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}
