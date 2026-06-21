import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App.js';

describe('App', () => {
  it('renders the oracle greeting', () => {
    render(<App />);
    expect(screen.getByText(/Macroracle/i)).toBeDefined();
    expect(screen.getByText(/oracle is awakening/i)).toBeDefined();
  });
});
