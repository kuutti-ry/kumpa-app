import { readMigrationFiles } from "drizzle-orm/migrator";
import { readJournal } from "./journal.ts";
import type { Pool } from "./pool.ts";

/** One advisory lock for every process that may migrate the same database. */
export const MIGRATE_LOCK_KEY = 725_121_113;

/** A database error's kind and where it struck: what a refusal's cause keeps. */
const KIND = ["code", "severity", "schema", "table", "column", "constraint", "routine"] as const;

export type MigrateResult = {
  state: "no-journal" | "nothing-to-do" | "applied";
  applied: number;
};

/**
 * Applies committed migrations under a session-level advisory lock, so two
 * containers starting at once (a redeploy overlapping the old one) apply each
 * migration exactly once. Rule 10: migrations are generated, never hand-written,
 * and applied by the entrypoint before the server listens.
 *
 * Each migration commits on its own (ADR-075, #722). drizzle's migrator puts
 * the whole pending span in one transaction, and Postgres refuses an enum
 * value used in the transaction that added it, so a database several
 * migrations behind failed where a fresh one and staging passed. Its
 * bookkeeping is kept as drizzle writes it: the same files, read by drizzle,
 * and the same rows, which `migrationsStatus` and ADR-065's stamp read.
 */
export async function migrate(pool: Pool, migrationsFolder: string): Promise<MigrateResult> {
  const journal = readJournal(migrationsFolder);
  if (journal === null) return { state: "no-journal", applied: 0 };
  // drizzle-kit stamps an entry with the clock of the machine that generated it.
  // An entry not after the one before would never apply on a database that has
  // committed that one: after a refusal midway, or on staging after a merge.
  for (const [index, entry] of journal.entries()) {
    const before = journal[index - 1];
    if (before && entry.when <= before.when) {
      throw new Error(`the journal's ${entry.tag} is not dated after ${before.tag}`);
    }
  }
  const files = readMigrationFiles({ migrationsFolder });

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATE_LOCK_KEY]);
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    // As drizzle decides: pending is newer than the last applied, by the journal's `when`.
    const last = await client.query<{ created_at: string | null }>(
      "SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1",
    );
    const lastApplied = Number(last.rows[0]?.created_at ?? 0);

    let applied = 0;
    for (const [index, file] of files.entries()) {
      if (file.folderMillis <= lastApplied) continue;
      await client.query("BEGIN");
      try {
        for (const statement of file.sql) await client.query(statement);
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
          [file.hash, file.folderMillis],
        );
        await client.query("COMMIT");
      } catch (error) {
        // The client goes back to the pool, so it leaves no transaction open: the
        // unlock below would fail in an aborted one and the lock would stay held.
        await client.query("ROLLBACK");
        // What the boot log says of a refused release: which one, how far it got,
        // and the database error by its kind alone. Its message, detail, hint and
        // where can quote a row (a duplicate key, a failing row), and the boot
        // prints this to the log as it is (lib/logger.ts's rule, #636).
        const fields = Object(error) as Partial<Record<(typeof KIND)[number], unknown>>;
        throw new Error(
          `migration ${journal[index]?.tag} failed and was rolled back; this run applied ${applied} before it`,
          {
            cause: Object.fromEntries(
              KIND.flatMap((key) => (fields[key] === undefined ? [] : [[key, fields[key]]])),
            ),
          },
        );
      }
      applied++;
    }
    return { state: applied > 0 ? "applied" : "nothing-to-do", applied };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATE_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
