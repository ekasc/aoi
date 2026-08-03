import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'packages/api/src/__tests__/**/*.test.ts'],
    environment: 'happy-dom',
    globals: true,
    env: {
      EXPO_PUBLIC_AUTH_STUB_MODE: 'true',
      EXPO_PUBLIC_AUTH_API_BASE_URL: 'https://api.test.local',
    },
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@': '/',
    },
  },
});
