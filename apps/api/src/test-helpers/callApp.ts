import http from 'node:http';
import type { Application } from 'express';

export interface CallResult {
  status: number;
  body: unknown;
  headers: Record<string, string[]>;
}

/**
 * Spin up the given Express app on a random port, make a single HTTP request,
 * then shut the server down. Returns the status code, parsed JSON body, and
 * all response headers (as arrays, since a header can appear multiple times).
 */
export function callApp(
  app: Application,
  method: string,
  path: string,
  options?: { body?: unknown; headers?: Record<string, string> },
): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        return reject(new Error('Could not determine server address'));
      }

      const url = `http://127.0.0.1:${addr.port}${path}`;
      const fetchOptions: RequestInit = { method };

      // Build request headers
      const reqHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      };
      fetchOptions.headers = reqHeaders;

      if (options?.body !== undefined) {
        fetchOptions.body = JSON.stringify(options.body);
      }

      fetch(url, fetchOptions)
        .then(async (res) => {
          // Collect all response headers, preserving duplicates (e.g. Set-Cookie)
          const headers: Record<string, string[]> = {};
          res.headers.forEach((value, key) => {
            const lk = key.toLowerCase();
            if (!headers[lk]) headers[lk] = [];
            headers[lk].push(value);
          });

          const body = await res.json().catch(() => null);
          server.close(() => resolve({ status: res.status, body, headers }));
        })
        .catch((err) => server.close(() => reject(err)));
    });

    server.on('error', reject);
  });
}
