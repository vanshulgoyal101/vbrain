import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: { include: ['src/**', 'public/lib.js'], reporter: ['text', 'html'] },
  },
});
