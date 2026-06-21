import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run test files sequentially — integration tests share a DB and would
    // step on each other if run in parallel (one suite's afterEach deletes rows
    // another suite's beforeAll just created).
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    // Collect tests from the whole src tree
    include: ['src/**/*.test.ts'],
  },
});
