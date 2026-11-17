import { resolve } from "node:path";
import { createPool, migrate, TEST_DATABASE_URL } from "@kuutti/db";

/** The committed migrations, from which every test database is built. */
export const MIGRATIONS = resolve(import.meta.dirname, "../../../../packages/db/drizzle");

/** Where the tests that stop the clock stop it, whatever day the run falls on. */
export const STOPPED_CLOCK = new Date("2026-10-16T09:00:00.000Z");

/** Runs once per test run: the test database carries every committed migration. */
export default async function setup(): Promise<void> {
  const pool = createPool({
    connectionString: TEST_DATABASE_URL,
    max: 1,
    applicationName: "kuutti-api-test-setup",
  });
  try {
    await migrate(pool, MIGRATIONS);
  } finally {
    await pool.end();
  }
}
