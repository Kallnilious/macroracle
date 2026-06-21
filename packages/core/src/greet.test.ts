import { describe, it, expect } from 'vitest';
import { greet } from './greet.js';

describe('greet', () => {
  it('includes the given name in the greeting', () => {
    expect(greet('Kallory')).toBe('The oracle sees you, Kallory.');
  });

  it('works with any string', () => {
    expect(greet('world')).toContain('world');
  });
});
