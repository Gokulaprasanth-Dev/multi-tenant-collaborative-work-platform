/**
 * Jest globalSetup for integration tests (TASK-098).
 * Runs once before all test suites.
 */

import 'dotenv/config';

export default async function globalSetup(): Promise<void> {
  // TEST_DATABASE_URL is optional in Zod config schema but REQUIRED for integration tests
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests. Set it in .env or environment.'
    );
  }

  // Point DATABASE_URL at the test database before any pool connections
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

  // Run migrations on test DB
  const { default: migrate } = await import('node-pg-migrate');
  const path = await import('path');

  await migrate({
    databaseUrl: process.env.TEST_DATABASE_URL,
    direction: 'up',
    dir: path.join(__dirname, '../migrations'),
    log: () => {},
  });
}
