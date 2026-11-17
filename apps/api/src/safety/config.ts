import { randomUUID } from "node:crypto";
import { type Queryable, transaction } from "@kuutti/db";
import { type ConfigChange, type ConfigKey, ConfigValue, InvitationReward } from "@kuutti/schema";
import { AppError } from "../lib/errors.ts";
import { MATCHING_OPEN_KEY } from "../lib/matching-config.ts";
import { KEPT_YEAR_KEYS, QUEUE_RETENTION_DAYS } from "../matching/index.ts";
import { recordAudit } from "./audit.ts";

// The tunables in the panel (#304, #305): every key of matching_config with
// its versions, read by admins, and a new version with a reason, which every
// reader uses from the next request on (lib/matching-config.ts reads the
// latest row each time, with no cache). Keys are born in migrations, never
// here, and a change keeps the value's shape, so no reader gets a type it
// does not expect. Raw parameterised SQL through Queryable, as the slices'
// repositories, so the test harness's rolled-back transaction passes through.
// One key of the table is no tunable: the switch that opens matching has a
// screen and a confirm step of its own and nothing else turns it (ADR-060 §2,
// #607), so it is neither listed nor written here.

type Row = {
  id: string;
  key: string;
  version: number;
  value: unknown;
  valid_from: Date;
  created_by: string;
  reason: string | null;
};

/** Every key, its latest value and its versions newest first, keys in order. */
export async function listConfig(db: Queryable): Promise<ConfigKey[]> {
  const { rows } = await db.query<Row>(
    `SELECT id, key, version, value, valid_from, created_by, reason
     FROM matching_config WHERE key <> $1 ORDER BY key, version DESC`,
    [MATCHING_OPEN_KEY],
  );
  const keys = new Map<string, ConfigKey>();
  for (const row of rows) {
    const version = {
      version: row.version,
      value: ConfigValue.parse(row.value),
      validFrom: row.valid_from.toISOString(),
      createdBy: row.created_by,
      reason: row.reason,
    };
    const known = keys.get(row.key);
    // The contract's thousand newest versions; a key changed more often than that keeps them in the table.
    if (known) {
      if (known.versions.length < 1000) known.versions.push(version);
    } else
      keys.set(row.key, {
        key: row.key,
        value: version.value,
        version: row.version,
        versions: [version],
      });
  }
  return [...keys.values()];
}

/** The JSON type of a value: what a reader of the key is written against. */
function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** The largest whole number a count may hold: readers compare it with SQL int4 counts. */
const INT4_MAX = 2_147_483_647;

/** A number keeps what its key declared: a whole number from 0 stays one within int4, a number from 0 stays from 0. */
function fitsNumber(declared: number, next: number): boolean {
  if (Number.isInteger(declared) && declared >= 0) {
    return Number.isSafeInteger(next) && next >= 0 && next <= INT4_MAX;
  }
  return declared < 0 || next >= 0;
}

/**
 * Whether a new value keeps the shape its key declared: the same JSON type;
 * for an object the same keys with values of the same type (the photo fetch
 * budgets); for a number its wholeness and sign, since a count is compared
 * with SQL integers and parsed as one (a fraction there answers 500 for
 * everyone). What a key declares is its newest version no admin wrote and not
 * the current one, so a fraction key set to 1 can still go back to 0.6. A
 * reader parses the value it expects; a change of shape is a migration's, with
 * the code that reads it, so the panel follows the migration from then on
 * (#503).
 */
export function sameShape(declared: unknown, next: unknown): boolean {
  if (kindOf(declared) !== kindOf(next)) return false;
  if (typeof declared === "number") return fitsNumber(declared, next as number);
  if (kindOf(declared) !== "object") return true;
  const a = declared as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(a).sort();
  const other = Object.keys(b).sort();
  if (keys.length !== other.length || keys.some((k, i) => k !== other[i])) return false;
  return keys.every((k) => sameShape(a[k], b[k]));
}

/**
 * The one key whose reader holds its value to a contract of its own, whose
 * ceilings no shape can say: past one, every read would answer 500 from the
 * next request on (ADR-044 §4).
 */
const INVITATION_REWARD_KEY = "invitation_reward";

/**
 * A new version of a key (#305): the audit row first, then the row with the
 * next version number, the admin's identity as its author and the reason. Of
 * two admins changing one key at once the unique (key, version) index lets
 * one write; the other's audit row rolls back with its 409. The answer is the
 * row this call wrote, whatever another admin wrote just after it.
 */
export async function changeConfig(
  db: Queryable,
  input: { key: string; value: ConfigValue; reason: string; actor: string; at: Date },
): Promise<ConfigChange> {
  const { rows: latest } = await db.query<Row>(
    `SELECT id, key, version, value, valid_from, created_by, reason
     FROM matching_config WHERE key = $1 AND key <> $2 ORDER BY version DESC LIMIT 1`,
    [input.key, MATCHING_OPEN_KEY],
  );
  const current = latest[0];
  if (!current) throw new AppError(404, "not_found", "No such key; keys are born in migrations");
  // Only a tunable's row by an admin has a reason (the column's comment), so this is a migration's or the seed's.
  const { rows: unchanged } = await db.query<{ value: unknown }>(
    "SELECT value FROM matching_config WHERE key = $1 AND reason IS NULL ORDER BY version DESC LIMIT 1",
    [input.key],
  );
  const declared = unchanged[0]?.value ?? current.value;
  const readable =
    input.key !== INVITATION_REWARD_KEY || InvitationReward.safeParse(input.value).success;
  if (!readable || !sameShape(declared, input.value)) {
    throw new AppError(
      400,
      "config_shape",
      "The value must keep the type, keys and kind of number its key declared",
      {
        key: input.key,
        expected: kindOf(declared),
      },
    );
  }
  // The shape holds, so a number here is the key's own: a clock read back over the
  // queue's log stops at the kept year, and a longer one would end there unsaid (#687).
  if (
    KEPT_YEAR_KEYS.has(input.key) &&
    typeof input.value === "number" &&
    input.value > QUEUE_RETENTION_DAYS
  ) {
    throw new AppError(
      400,
      "config_past_kept_year",
      "The queue's log is kept a year, so this key holds at most that many days",
      { key: input.key, max: QUEUE_RETENTION_DAYS },
    );
  }
  const id = randomUUID();
  const version = current.version + 1;
  await transaction(db, async (tx) => {
    await recordAudit(tx, {
      actorIdentityId: input.actor,
      action: "config.change",
      subjectType: "config",
      subjectId: id,
      detail: { key: input.key, version },
    });
    const { rowCount } = await tx.query(
      `INSERT INTO matching_config (id, version, key, value, valid_from, created_by, reason)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)
       ON CONFLICT (key, version) DO NOTHING`,
      [id, version, input.key, JSON.stringify(input.value), input.at, input.actor, input.reason],
    );
    if (rowCount !== 1) {
      throw new AppError(409, "config_conflict", "Somebody changed this key meanwhile");
    }
  });
  return {
    key: input.key,
    version,
    value: input.value,
    validFrom: input.at.toISOString(),
    createdBy: input.actor,
    reason: input.reason,
  };
}
