import type { Queryable } from "@kuutti/db";
import { expect } from "vitest";
import { staffSession } from "../test/account.ts";
import { attack } from "../test/attack.ts";
import { rolledBack } from "../test/rolled-back.ts";
import { pruneAuditLog } from "./audit.ts";

// prune-audit-log (#714, ADR-076, #380): "a row is kept five years, then the
// night deletes it; nothing deletes one sooner" (features/safety/audit.feature).
// Each attack tries to make a night take a row before its five years, leave one
// past them, or let the connection the night runs on delete or age a row itself.
// The roles that hold this on a deployed database are
// packages/db/src/audit-owner.test.ts's.

type Row = { age: string; actor: "staff" | "machine" };

/**
 * Rows written `age` before now(), the transaction's start and the instant the
 * prune measures from; in UTC, the line's own zone.
 */
async function write(db: Queryable, rows: Row[]): Promise<string[]> {
  await db.query("SET LOCAL timezone = 'UTC'");
  const staff = await staffSession(db);
  const ids: string[] = [];
  for (const row of rows) {
    // The machine's row is a shadow ban's, the one action with no actor.
    const { rows: written } = await db.query<{ id: string }>(
      `INSERT INTO audit_log (actor_identity_id, action, subject_type, subject_id, at)
       VALUES ($1, $2, 'account', gen_random_uuid(), now() - $3::interval) RETURNING id`,
      row.actor === "staff"
        ? [staff.identityId, "photo.view", row.age]
        : [null, "sanction.apply", row.age],
    );
    ids.push(written[0]?.id ?? "");
  }
  return ids;
}

async function left(db: Queryable, ids: string[]): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM audit_log WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return rows[0]?.n ?? 0;
}

/** Rows of these ages, then the night's prune: how many of them are left. */
function leftOf(rows: Row[]) {
  return rolledBack(async (db) => {
    const ids = await write(db, rows);
    await pruneAuditLog(db);
    return { left: await left(db, ids) };
  });
}

/** The connection's own statement on one row of `age`, then the night: how many are left. */
function afterOwn(age: string, statement: string) {
  return rolledBack(async (db) => {
    const ids = await write(db, [{ age, actor: "staff" }]);
    await db.query("SAVEPOINT own");
    try {
      await db.query(statement, [ids[0]]);
      await db.query("RELEASE SAVEPOINT own");
    } catch {
      // The trigger's refusal; what was there before it stays.
      await db.query("ROLLBACK TO SAVEPOINT own");
    }
    await pruneAuditLog(db);
    return { left: await left(db, ids) };
  });
}

attack("prune-audit-log: a row of exactly five years is pruned", {
  attempt: () => leftOf([{ age: "5 years", actor: "staff" }]),
  control: () => leftOf([{ age: "5 years 1 second", actor: "staff" }]),
  succeeds: (seen) => expect(seen.left).toBe(0),
});

attack(
  "prune-audit-log: a row past five years is left behind, a member of staff's or the machine's",
  {
    attempt: () =>
      leftOf([
        { age: "9 years", actor: "staff" },
        { age: "5 years 1 second", actor: "machine" },
      ]),
    // A row of exactly five years is left by right.
    control: () => leftOf([{ age: "5 years", actor: "machine" }]),
    succeeds: (seen) => expect(seen.left).toBeGreaterThan(0),
  },
);

attack("prune-audit-log: the connection deletes a row before its five years", {
  attempt: () => afterOwn("4 years 364 days", "DELETE FROM audit_log WHERE id = $1"),
  // Past five years the trigger lets the same statement through.
  control: () => afterOwn("5 years 1 second", "DELETE FROM audit_log WHERE id = $1"),
  succeeds: (seen) => expect(seen.left).toBe(0),
});

attack("prune-audit-log: the connection ages a row so that the night takes it", {
  attempt: () =>
    afterOwn("1 year", "UPDATE audit_log SET at = at - interval '10 years' WHERE id = $1"),
  // A row written ten years ago is what that UPDATE would make of it.
  control: () => leftOf([{ age: "11 years", actor: "staff" }]),
  succeeds: (seen) => expect(seen.left).toBe(0),
});
