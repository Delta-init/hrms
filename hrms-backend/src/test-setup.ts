/**
 * Environment for the test run, established before any module loads.
 *
 * `config/env.ts` validates on import and calls process.exit on failure, so a
 * test file that pulls in anything reaching it dies at import time unless these
 * are already set. Doing it in a `beforeAll` only ever worked by accident: it
 * depends on which test file bun happens to load first, and adding an unrelated
 * test moves that around.
 *
 * MONGODB_URI deliberately points at a local, obviously-fake database. Nothing
 * here connects, but the real .env points at production, and a test suite that
 * could reach it by loading dotenv is one bad import away from writing to it.
 */
const defaults: Record<string, string> = {
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017/hrms-test-never-connected",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-to-pass",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-long-enough-ok",
  SUPER_ADMIN_EMAIL: "test-admin@example.com",
  SUPER_ADMIN_PASSWORD: "test-password",
  INTEGRATION_CLIENT_ID: "delta-finance",
  INTEGRATION_SECRET: "integration-secret-long-enough-to-pass-validation",
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
