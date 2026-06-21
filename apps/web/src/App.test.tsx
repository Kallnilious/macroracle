import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.js';

describe('App routing', () => {
  it('redirects unauthenticated users to the login page', async () => {
    render(<App />);
    // Auth restore happens async; the page settles on /login for unauthenticated users.
    // getByText waits synchronously — use queryByText for present-or-absent check.
    const loginHeading = await screen.findByRole('heading', { name: /sign in/i });
    expect(loginHeading).toBeDefined();
  });
});
