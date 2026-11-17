import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ConfigKeyName, ConfigVersion } from "@kuutti/schema";
import { describe, expect, it } from "vitest";
import { readJournal } from "./journal.ts";
import { migrate } from "./migrate.ts";
import { migrationsStatus } from "./migrations.ts";
import { createPool, type Queryable } from "./pool.ts";
import { MATCHING_CONFIG_V1 } from "./seed.ts";
import { withTemporaryDatabase } from "./test/temporary-database.ts";

const MIGRATIONS = resolve(import.meta.dirname, "..", "drizzle");

function runMigrateCli(
  databaseUrl: string,
): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/cli/migrate.ts"], {
      cwd: resolve(import.meta.dirname, ".."),
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      err += c.toString();
    });
    child.on("close", (code) => done({ code, out, err }));
  });
}

describe("migrate", () => {
  it("two processes started at once against an empty database both exit 0 and apply each migration once", async () => {
    await withTemporaryDatabase(async (url) => {
      const [a, b] = await Promise.all([runMigrateCli(url), runMigrateCli(url)]);
      expect(a.code, a.err).toBe(0);
      expect(b.code, b.err).toBe(0);
      const states = [a.out, b.out].map((o) => (JSON.parse(o) as { state: string }).state).sort();
      expect(states).toEqual(["applied", "nothing-to-do"]);

      const pool = createPool({ connectionString: url, max: 1 });
      try {
        const journal = readJournal(MIGRATIONS) ?? [];
        const rows = await pool.query<{ n: string }>(
          "SELECT count(*) AS n FROM drizzle.__drizzle_migrations",
        );
        expect(Number(rows.rows[0]?.n)).toBe(journal.length);
        expect((await migrationsStatus(pool, MIGRATIONS)).state).toBe("current");
      } finally {
        await pool.end();
      }
    });
  });

  it("carries matching_config's version 1, the same rows as the seed, and the later versions the migrations name", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const { rows } = await pool.query<{ key: string; value: unknown; version: number }>(
          "SELECT key, value, version FROM matching_config ORDER BY key, version",
        );
        const at = (version: number) =>
          Object.fromEntries(
            rows.filter((r) => r.version === version).map((r) => [r.key, r.value]),
          );
        expect(at(1)).toEqual(MATCHING_CONFIG_V1);
        // A new value is a new version (ADR-033 History, the maintainer's of 17/11/2026).
        expect(rows.filter((r) => r.version !== 1)).toEqual([
          { key: "auto_shadow_ban_review_hours", value: 168, version: 2 },
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  it("starts a database with matching closed, the tunables, and no other row (ADR-060, ADR-061 §8)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const { rows: matching } = await pool.query(
          "SELECT version, value, created_by FROM matching_config WHERE key = 'matching_open'",
        );
        expect(matching).toEqual([{ version: 1, value: false, created_by: "migration:0004" }]);
        const { rows: tables } = await pool.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1`,
        );
        const holding: Record<string, number> = {};
        for (const { table_name: table } of tables) {
          const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "${table}"`);
          if (Number(rows[0]?.n) > 0) holding[table] = Number(rows[0]?.n);
        }
        expect(holding).toEqual({
          // Version 1 of every key, and the review hours' second (migration 0011).
          matching_config: Object.keys(MATCHING_CONFIG_V1).length + 1,
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("writes every row so that it reads in the panel as a version without a reason, and a later version may carry one (#304, #305)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        const { rows } = await pool.query<{
          key: string;
          version: number;
          value: unknown;
          valid_from: Date;
          created_by: string;
          reason: string | null;
        }>("SELECT key, version, value, valid_from, created_by, reason FROM matching_config");
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.reason, row.key).toBeNull();
          expect(ConfigKeyName.safeParse(row.key).success, row.key).toBe(true);
          expect(
            ConfigVersion.safeParse({
              version: row.version,
              value: row.value,
              validFrom: row.valid_from.toISOString(),
              createdBy: row.created_by,
              reason: row.reason,
            }).error,
            row.key,
          ).toBeUndefined();
        }

        // A row without a reason is still written, as the seed writes one; the panel's carries its reason.
        await pool.query(
          `INSERT INTO matching_config (version, key, value, created_by)
           VALUES (2, 'stars_max', '12'::jsonb, 'seed')`,
        );
        await pool.query(
          `INSERT INTO matching_config (version, key, value, created_by, reason)
           VALUES (2, 'inbox_stop', '25'::jsonb, 'admin', 'Smaller piles first')`,
        );
        const written = await pool.query<{ key: string; reason: string | null }>(
          `SELECT key, reason FROM matching_config
            WHERE version = 2 AND key IN ('inbox_stop', 'stars_max') ORDER BY key`,
        );
        expect(written.rows).toEqual([
          { key: "inbox_stop", reason: "Smaller piles first" },
          { key: "stars_max", reason: null },
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  it("refuses a database whose journal still ends at the chain folded into the baseline, leaves it as it was, and has nothing to apply once its journal is stamped (ADR-065)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        await migrate(pool, MIGRATIONS);
        await accountOf(pool, "9");
        const journal = () =>
          pool.query<{ hash: string; created_at: string }>(
            "SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at",
          );
        const stamped = (await journal()).rows;
        // 0109_pond_counter_finished, the chain's last, as the journal of a database that ran it ends.
        await pool.query("DELETE FROM drizzle.__drizzle_migrations");
        await pool.query(
          "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('the chain', 1793827411048)",
        );
        const before = await pool.query("SELECT count(*) AS n FROM matching_config");

        await expect(migrate(pool, MIGRATIONS)).rejects.toMatchObject({
          cause: { code: "42710" },
        });

        expect((await journal()).rows).toEqual([
          { hash: "the chain", created_at: "1793827411048" },
        ]);
        expect((await pool.query("SELECT count(*) AS n FROM matching_config")).rows).toEqual(
          before.rows,
        );
        expect((await pool.query("SELECT count(*) AS n FROM account")).rows).toEqual([{ n: "1" }]);
        const journalNames = (readJournal(MIGRATIONS) ?? []).map((entry) => entry.tag);
        expect(await migrationsStatus(pool, MIGRATIONS)).toEqual({
          state: "pending",
          applied: 0,
          pending: journalNames,
        });

        // The way across where the schema is the one the chain left: the folder's own rows in the journal.
        await pool.query("DELETE FROM drizzle.__drizzle_migrations");
        for (const row of stamped) {
          await pool.query(
            "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)",
            [row.hash, row.created_at],
          );
        }
        expect(await migrate(pool, MIGRATIONS)).toEqual({ state: "nothing-to-do", applied: 0 });
        expect((await migrationsStatus(pool, MIGRATIONS)).state).toBe("current");
        expect((await pool.query("SELECT count(*) AS n FROM account")).rows).toEqual([{ n: "1" }]);
      } finally {
        await pool.end();
      }
    });
  });

  const accountOf = async (pool: Queryable, n: string) => {
    const { rows } = await pool.query<{ id: string }>(
      `WITH i AS (INSERT INTO identity (hetu_hmac) VALUES ($1) RETURNING id)
       INSERT INTO account (identity_id) SELECT id FROM i RETURNING id`,
      [n.repeat(64)],
    );
    return rows[0]?.id as string;
  };

  async function withSanctionTable(
    fn: (
      insert: (row: Record<string, unknown>) => Promise<unknown>,
      ids: { identityId: string; pool: ReturnType<typeof createPool> },
    ) => Promise<void>,
  ) {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 1 });
      try {
        await migrate(pool, MIGRATIONS);
        const identity = await pool.query<{ id: string }>(
          "INSERT INTO identity (hetu_hmac) VALUES ($1) RETURNING id",
          ["5".repeat(64)],
        );
        const identityId = identity.rows[0]?.id ?? "";
        const account = await pool.query<{ id: string }>(
          "INSERT INTO account (identity_id) VALUES ($1) RETURNING id",
          [identityId],
        );
        const accountId = account.rows[0]?.id;
        const insert = (row: Record<string, unknown>) => {
          const full = {
            identity_id: identityId,
            account_id: accountId,
            kind: "warn",
            reason: "other",
            note: "x",
            ...row,
          };
          const columns = Object.keys(full);
          return pool.query(
            `INSERT INTO sanction (${columns.join(", ")})
             VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})`,
            Object.values(full),
          );
        };
        await fn(insert, { identityId, pool });
      } finally {
        await pool.end();
      }
    });
  }
  const refused = (constraint: string) => ({ code: "23514", constraint });
  const END = "2026-10-21T21:00:00Z";
  const AT = "2026-10-20T09:00:00Z";

  it("holds a sanction's end, note, lift and review together in the database (#307)", async () => {
    await withSanctionTable(async (insert, { identityId, pool }) => {
      // Only a suspension has an end, and a suspension always has one.
      await expect(insert({ kind: "suspend" })).rejects.toMatchObject(
        refused("sanction_ends_at_check"),
      );
      for (const kind of ["warn", "shadow_ban", "ban"]) {
        await expect(insert({ kind, ends_at: END })).rejects.toMatchObject(
          refused("sanction_ends_at_check"),
        );
      }
      await insert({ kind: "suspend", ends_at: END });
      // The note: one to 500 characters.
      await expect(insert({ note: "" })).rejects.toMatchObject(refused("sanction_note_check"));
      await expect(insert({ note: "x".repeat(501) })).rejects.toMatchObject(
        refused("sanction_note_check"),
      );
      await insert({ note: "x".repeat(500) });
      // A lift by somebody has its time; a lift by nobody (the night) only the time.
      await expect(insert({ lifted_by: identityId })).rejects.toMatchObject(
        refused("sanction_lift_check"),
      );
      await insert({ lifted_at: AT });
      await insert({ lifted_at: AT, lifted_by: identityId });
      // A review is the time, who, and a note of one to 500 characters, all or none.
      for (const half of [
        { reviewed_at: AT },
        { reviewed_by: identityId },
        { review_note: "kept" },
        { reviewed_at: AT, reviewed_by: identityId, review_note: "" },
        { reviewed_at: AT, reviewed_by: identityId, review_note: "x".repeat(501) },
      ]) {
        await expect(insert(half)).rejects.toMatchObject(refused("sanction_review_check"));
      }
      await insert({ reviewed_at: AT, reviewed_by: identityId, review_note: "kept" });
      const kept = await pool.query<{ n: string }>("SELECT count(*) AS n FROM sanction");
      expect(Number(kept.rows[0]?.n)).toBe(5);
      // The kinds and the reasons are the database's own enums.
      await expect(insert({ kind: "mute" })).rejects.toMatchObject({ code: "22P02" });
      await expect(insert({ reason: "spam" })).rejects.toMatchObject({ code: "22P02" });
    });
  });

  it("refuses a review with its time and who but without a note (#307)", async () => {
    // A review's note is one to 500 characters (ADR-024 §1); a missing one is not a review.
    await withSanctionTable(async (insert, { identityId }) => {
      await expect(insert({ reviewed_at: AT, reviewed_by: identityId })).rejects.toMatchObject(
        refused("sanction_review_check"),
      );
    });
  });

  it("holds an invitation open, redeemed or counted, a unit to its spending, and a notice to what it is about (#107)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 1 });
      try {
        await migrate(pool, MIGRATIONS);
        const [inviter, friend, other] = [
          await accountOf(pool, "6"),
          await accountOf(pool, "7"),
          await accountOf(pool, "8"),
        ];
        let codes = 0;
        const invite = (row: Record<string, unknown> = {}) => {
          codes += 1;
          const full = {
            inviter_account_id: inviter,
            code_hash: String(codes).padStart(64, "0"),
            ...row,
          };
          const columns = Object.keys(full);
          return pool.query<{ id: string }>(
            `INSERT INTO invitation (${columns.join(", ")})
             VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
            Object.values(full),
          );
        };

        // Open is nothing set; redeemed is when and by whom; counted only once redeemed.
        await invite();
        for (const half of [
          { redeemed_by_account_id: friend },
          { redeemed_at: AT },
          { counted_at: AT },
          { redeemed_by_account_id: friend, counted_at: AT },
        ]) {
          await expect(invite(half)).rejects.toMatchObject(refused("invitation_redeemed_check"));
        }
        await expect(
          invite({ redeemed_by_account_id: inviter, redeemed_at: AT }),
        ).rejects.toMatchObject(refused("invitation_not_self_check"));
        const used = await invite({
          redeemed_by_account_id: friend,
          redeemed_at: AT,
          counted_at: AT,
        });
        const usedId = used.rows[0]?.id as string;
        // A person redeems one invitation, ever, and a code names one invitation.
        await expect(
          invite({ redeemed_by_account_id: friend, redeemed_at: AT }),
        ).rejects.toMatchObject({ code: "23505", constraint: "invitation_redeemed_by_idx" });
        await expect(
          pool.query("INSERT INTO invitation (inviter_account_id, code_hash) VALUES ($1, $2)", [
            other,
            "1".padStart(64, "0"),
          ]),
        ).rejects.toMatchObject({ code: "23505", constraint: "invitation_code_hash_idx" });
        // A counted one keeps its count when its redeemer is erased.
        await pool.query("UPDATE invitation SET redeemed_by_account_id = NULL WHERE id = $1", [
          usedId,
        ]);
        // A redeemed one stays for its redeemer when its inviter is erased, the
        // self check passing on the null; an open one, or one naming nobody, does not.
        const joined = await invite({ redeemed_by_account_id: other, redeemed_at: AT });
        await pool.query("UPDATE invitation SET inviter_account_id = NULL WHERE id = $1", [
          joined.rows[0]?.id,
        ]);
        await expect(invite({ inviter_account_id: null })).rejects.toMatchObject(
          refused("invitation_named_check"),
        );
        await expect(
          pool.query("UPDATE invitation SET inviter_account_id = NULL WHERE id = $1", [usedId]),
        ).rejects.toMatchObject(refused("invitation_named_check"));
        await pool.query("DELETE FROM invitation WHERE id = $1", [joined.rows[0]?.id]);

        // A unit spent on an entry has its time, and outlives the entry without the link.
        const { rows: rounds } = await pool.query<{ id: string }>(
          "INSERT INTO rounds (account_id, day) VALUES ($1, '2026-10-22') RETURNING id",
          [inviter],
        );
        const { rows: entries } = await pool.query<{ id: string }>(
          `INSERT INTO round_entries (round_id, position, candidate_id, reason, decision, decided_at)
           VALUES ($1, 1, $2, 'matches_filters', 'like', $3) RETURNING id`,
          [rounds[0]?.id, other, AT],
        );
        const entryId = entries[0]?.id;
        await expect(
          pool.query(
            "INSERT INTO reward (account_id, kind, invitation_id, spent_entry_id) VALUES ($1, 'fish', $2, $3)",
            [inviter, usedId, entryId],
          ),
        ).rejects.toMatchObject(refused("reward_spent_check"));
        await pool.query(
          `INSERT INTO reward (account_id, kind, invitation_id, spent_at, spent_entry_id)
           VALUES ($1, 'fish', $2, $3, $4), ($1, 'fish', $2, NULL, NULL)`,
          [inviter, usedId, AT, entryId],
        );
        // Earned likes went with #503.
        for (const kind of ["boost", "like"]) {
          await expect(
            pool.query("INSERT INTO reward (account_id, kind, invitation_id) VALUES ($1, $3, $2)", [
              inviter,
              usedId,
              kind,
            ]),
          ).rejects.toMatchObject({ code: "22P02" });
        }
        await pool.query("DELETE FROM round_entries WHERE id = $1", [entryId]);
        const spent = await pool.query<{ kind: string; spent: boolean; entry: string | null }>(
          `SELECT kind, spent_at IS NOT NULL AS spent, spent_entry_id AS entry FROM reward
           ORDER BY spent_at NULLS LAST`,
        );
        expect(spent.rows).toEqual([
          { kind: "fish", spent: true, entry: null },
          { kind: "fish", spent: false, entry: null },
        ]);

        // An invitation's notice, either side's, points at its invitation, and only it does.
        const notice = (kind: string, invitationId: string | null) =>
          pool.query("INSERT INTO notice (account_id, kind, invitation_id) VALUES ($1, $2, $3)", [
            inviter,
            kind,
            invitationId,
          ]);
        for (const kind of ["invitation_counted", "invitation_friend"]) {
          await expect(notice(kind, null)).rejects.toMatchObject(
            refused("notice_invitation_check"),
          );
          await notice(kind, usedId);
        }
        await expect(notice("warning", usedId)).rejects.toMatchObject({ code: "23514" });

        // The units and the notice go with their invitation.
        await pool.query("DELETE FROM invitation WHERE id = $1", [usedId]);
        const left = await pool.query<{ rewards: string; notices: string }>(
          `SELECT (SELECT count(*) FROM reward) AS rewards, (SELECT count(*) FROM notice) AS notices`,
        );
        expect(left.rows).toEqual([{ rewards: "0", notices: "0" }]);
      } finally {
        await pool.end();
      }
    });
  });

  it("holds a session to a family hash of its own (#490, ADR-059)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 1 });
      try {
        await migrate(pool, MIGRATIONS);
        const accountId = await accountOf(pool, "a");
        const insert = (family: string | null, refresh: string) =>
          pool.query(
            `INSERT INTO session (account_id, platform, access_hash, access_expires_at, refresh_hash, family_hash, expires_at)
             VALUES ($1, 'ios', $2, now() + interval '15 minutes', $2, $3, now() + interval '90 days')`,
            [accountId, refresh, family],
          );
        await insert("f1", "r1");
        await expect(insert(null, "r2")).rejects.toMatchObject({ code: "23502" });
        await expect(insert("f1", "r3")).rejects.toMatchObject({
          code: "23505",
          constraint: "session_family_hash_unique",
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("lets only a pass carry the second pass's mark (#502, ADR-062 §6)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 1 });
      try {
        await migrate(pool, MIGRATIONS);
        const [one, other] = [await accountOf(pool, "b"), await accountOf(pool, "c")];
        const { rows: rounds } = await pool.query<{ id: string }>(
          "INSERT INTO rounds (account_id, day) VALUES ($1, '2026-10-30') RETURNING id",
          [one],
        );
        await pool.query(
          `INSERT INTO round_entries (round_id, position, candidate_id, reason, decision, decided_at)
           VALUES ($1, 1, $2, 'matches_filters', 'pass', now())`,
          [rounds[0]?.id, other],
        );
        // A pass is a first pass until it says otherwise.
        const entries = await pool.query("SELECT second_pass FROM round_entries");
        expect(entries.rows).toEqual([{ second_pass: false }]);
        const mark = (value: boolean, decision: string) =>
          pool.query(
            "UPDATE round_entries SET decision = $2::round_decision, second_pass = $1 RETURNING second_pass",
            [value, decision],
          );
        expect((await mark(true, "pass")).rows).toEqual([{ second_pass: true }]);
        expect((await mark(false, "skip")).rows).toEqual([{ second_pass: false }]);
        for (const decision of ["like", "skip"]) {
          await expect(mark(true, decision), decision).rejects.toThrow(
            /round_entries_second_pass_check/,
          );
        }
      } finally {
        await pool.end();
      }
    });
  });

  /** The chain up to a migration, without it: a folder of its own, for a database as it stood before. */
  function migrationsBefore(tag: string): string {
    const journal = readJournal(MIGRATIONS) ?? [];
    const end = journal.findIndex((entry) => entry.tag === tag);
    expect(end, tag).toBeGreaterThan(0);
    const dir = mkdtempSync(join(tmpdir(), "kuutti-db-"));
    mkdirSync(join(dir, "meta"));
    const entries = journal.slice(0, end);
    for (const entry of entries) {
      copyFileSync(resolve(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
    }
    writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ version: "7", entries }));
    return dir;
  }

  it.each([
    { pond: "an open pond", before: "UPDATE ponds SET matching_open = true", open: true },
    { pond: "a closed pond", before: "SELECT 1", open: false },
    // Nothing writes such a database; the migration's aggregate answers one row all the same.
    {
      pond: "no pond at all",
      before: "UPDATE account SET pond_id = NULL; DELETE FROM pond_counter; DELETE FROM ponds",
      open: false,
    },
  ])(
    "takes the pond out of a database with $pond: the switch keeps its value as a tunable, the counter its row, an account its home (#607, ADR-061 §8)",
    async ({ before, open }) => {
      const withThePond = migrationsBefore("0004_matching_open_key");
      try {
        await withTemporaryDatabase(async (url) => {
          const pool = createPool({ connectionString: url, max: 2 });
          try {
            await migrate(pool, withThePond);
            const account = await accountOf(pool, "7");
            await pool.query(
              `UPDATE account SET home_place = '00530', pond_id = (SELECT id FROM ponds)
             WHERE id = $1`,
              [account],
            );
            await pool.query(
              `INSERT INTO pond_counter (pond_id, day, finished, seeks_men, seeks_everyone, seeks_women, taken_at)
             SELECT id, '2026-11-04', 40, 12, 10, 18, '2026-11-04T02:00:00Z' FROM ponds`,
            );
            await pool.query(before);

            await migrate(pool, MIGRATIONS);

            const { rows: matching } = await pool.query(
              "SELECT version, value, created_by, reason FROM matching_config WHERE key = 'matching_open'",
            );
            expect(matching).toEqual([
              { version: 1, value: open, created_by: "migration:0004", reason: null },
            ]);
            const { rows: counter } = await pool.query(
              "SELECT id, day::text, finished, seeks_men, seeks_everyone, seeks_women, taken_at FROM pond_counter",
            );
            expect(counter).toEqual(
              before.includes("DELETE FROM pond_counter")
                ? []
                : [
                    {
                      id: true,
                      day: "2026-11-04",
                      finished: 40,
                      seeks_men: 12,
                      seeks_everyone: 10,
                      seeks_women: 18,
                      taken_at: new Date("2026-11-04T02:00:00Z"),
                    },
                  ],
            );
            const { rows: accounts } = await pool.query("SELECT * FROM account");
            expect(accounts).toHaveLength(1);
            expect(accounts[0]).toMatchObject({ id: account, home_place: "00530" });
            expect(accounts[0]).not.toHaveProperty("pond_id");
            const { rows: tables } = await pool.query(
              "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ponds'",
            );
            expect(tables).toEqual([]);
          } finally {
            await pool.end();
          }
        });
      } finally {
        rmSync(withThePond, { recursive: true, force: true });
      }
    },
  );

  it("stands a counter's row that names no number at zero, and never at null, and holds the counter to one row (#581, #607)", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 1 });
      try {
        await migrate(pool, MIGRATIONS);
        const { rows } = await pool.query<{ finished: number }>(
          "INSERT INTO pond_counter (day) VALUES ('2026-11-04') RETURNING finished",
        );
        expect(rows).toEqual([{ finished: 0 }]);
        // One pond, the country, so one row: a second is the same key, and no other key is let in.
        await expect(
          pool.query("INSERT INTO pond_counter (day) VALUES ('2026-11-05')"),
        ).rejects.toMatchObject({ code: "23505" });
        await expect(
          pool.query("INSERT INTO pond_counter (id, day) VALUES (false, '2026-11-05')"),
        ).rejects.toMatchObject({ code: "23514", constraint: "pond_counter_one_row_check" });
        await expect(pool.query("UPDATE pond_counter SET finished = NULL")).rejects.toMatchObject({
          code: "23502",
        });
      } finally {
        await pool.end();
      }
    });
  });

  it("takes research out of a database that held it: the events with their partitions, the research consents, the researcher with their sessions and the mapping, and nothing else (#208, ADR-071)", async () => {
    const withResearch = migrationsBefore("0008_no_research");
    try {
      await withTemporaryDatabase(async (url) => {
        const pool = createPool({ connectionString: url, max: 2 });
        try {
          await migrate(pool, withResearch);
          const account = await accountOf(pool, "5");
          for (const kind of ["terms", "privacy", "research", "special_category"]) {
            await pool.query(
              "INSERT INTO consent (account_id, kind, version, locale_shown) VALUES ($1, $2, 'v-1', 'fi')",
              [account, kind],
            );
          }
          await pool.query(
            "INSERT INTO research_subject (account_id, consent_version) VALUES ($1, 'v-1')",
            [account],
          );
          await pool.query(
            "CREATE TABLE events_2026_11 PARTITION OF events FOR VALUES FROM ('2026-11-01') TO ('2026-12-01')",
          );
          await pool.query(
            `INSERT INTO events (at, name, research_id, consent_version, age_band, snapshot, props)
             VALUES ('2026-11-16T10:00:00Z', 'like', gen_random_uuid(), 'v-1', '25-29', '{}', '{}')`,
          );
          const staff = async (n: string, role: string) => {
            const { rows } = await pool.query<{ id: string }>(
              "INSERT INTO identity (hetu_hmac) VALUES ($1) RETURNING id",
              [n.repeat(64)],
            );
            const id = rows[0]?.id as string;
            await pool.query(
              "INSERT INTO moderator_roles (identity_id, role, granted_by) VALUES ($1, $2, 'M')",
              [id, role],
            );
            await pool.query(
              `INSERT INTO admin_session (identity_id, role, access_hash, expires_at)
               VALUES ($1, $2, $3, now() + interval '8 hours')`,
              [id, role, `hash-${n}`],
            );
            return id;
          };
          const admin = await staff("a", "admin");
          await staff("b", "researcher");
          // Signed in as an admin, then granted researcher in place: the session the
          // grant left alone goes too, so a later grant of another role revives none.
          const demoted = await staff("c", "admin");
          await pool.query(
            "UPDATE moderator_roles SET role = 'researcher' WHERE identity_id = $1",
            [demoted],
          );

          await migrate(pool, MIGRATIONS);

          const { rows: tables } = await pool.query(
            `SELECT table_name FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name IN ('events', 'events_2026_11', 'research_subject')`,
          );
          expect(tables).toEqual([]);
          const { rows: functions } = await pool.query(
            "SELECT 1 FROM pg_proc WHERE proname = 'events_immutable'",
          );
          expect(functions).toEqual([]);
          const { rows: consents } = await pool.query(
            "SELECT kind::text FROM consent WHERE account_id = $1 ORDER BY kind",
            [account],
          );
          expect(consents.map((row) => row.kind)).toEqual(["privacy", "special_category", "terms"]);
          const { rows: roles } = await pool.query(
            "SELECT identity_id, role::text FROM moderator_roles",
          );
          expect(roles).toEqual([{ identity_id: admin, role: "admin" }]);
          const { rows: sessions } = await pool.query(
            "SELECT identity_id, role::text FROM admin_session",
          );
          expect(sessions).toEqual([{ identity_id: admin, role: "admin" }]);
          const { rows: kinds } = await pool.query(
            "SELECT unnest(enum_range(NULL::consent_kind))::text AS kind",
          );
          expect(kinds.map((row) => row.kind)).toEqual(["terms", "privacy", "special_category"]);
          const { rows: staffRoles } = await pool.query(
            "SELECT unnest(enum_range(NULL::moderator_role))::text AS role",
          );
          expect(staffRoles.map((row) => row.role)).toEqual(["moderator", "admin"]);
        } finally {
          await pool.end();
        }
      });
    } finally {
      rmSync(withResearch, { recursive: true, force: true });
    }
  });

  it("is a no-op the second time", async () => {
    await withTemporaryDatabase(async (url) => {
      const pool = createPool({ connectionString: url, max: 2 });
      try {
        expect((await migrate(pool, MIGRATIONS)).state).toBe("applied");
        expect((await migrate(pool, MIGRATIONS)).state).toBe("nothing-to-do");
        const tables = await pool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1",
        );
        expect(tables.rows.map((r) => r.table_name)).toEqual([
          "account",
          "account_export",
          "admin_session",
          // What Kuutti told everybody, kept for good (#573, ADR-068).
          "announcement",
          "audit_log",
          "auth_request",
          "block",
          "card_shown",
          "consent",
          "contact",
          "contact_share",
          "conversation",
          "conversation_participant",
          "email_code",
          "email_send",
          "feedback",
          "found_them_count",
          "identity",
          "invitation",
          "matching_config",
          "message",
          "moderator_roles",
          "notice",
          "notification_preference",
          "photo",
          "photo_access",
          "photo_check_note",
          "photo_review",
          "pond_counter",
          "preferences",
          "profile",
          "push_token",
          "report",
          "report_message",
          "reward",
          "round_entries",
          "round_relaxation",
          "rounds",
          "sanction",
          "session",
          "star",
        ]);
      } finally {
        await pool.end();
      }
    });
  });
});
