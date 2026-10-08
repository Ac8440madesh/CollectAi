import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Provide dummy env so tests run with NO real secrets and NO database.
    // (The db module is mocked in the auth tests.)
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/collectai_test',
      JWT_SECRET: 'test-secret-at-least-16-characters-long',
      JWT_EXPIRES_IN: '1h',
      FRONTEND_ORIGIN: 'http://localhost:5173',
    },
  },
});
