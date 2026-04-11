import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/lib/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/test-post.ts'],
    globals: true,
    environment: 'node',
  },
});
