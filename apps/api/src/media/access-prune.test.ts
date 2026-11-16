import type { PhotoVariant } from "@kuutti/schema";
import { signedInAccount } from "../test/account.ts";
import { describe, expect, type TestContext, test } from "../test/harness.ts";
import { prunePhotoAccess } from "./repo.ts";

// prune-photo-access (#688, the maintainer's of 16/11/2026, ADR-008 History):
// the fetch log of signed photo URLs is kept a year, then the night deletes
// its rows, every account's, whatever the photo or its purpose.

/** 04:00 in Helsinki on 16.11.2026; a year back is 16.11.2025 at the same instant. */
const NIGHT = new Date("2026-11-16T02:00:00.000Z");
const YEAR_AGO = new Date("2025-11-16T02:00:00.000Z");

async function logged(
  ctx: TestContext,
  accountId: string,
  at: Date,
  { variant = "card", purpose = "profile" }: { variant?: PhotoVariant; purpose?: string } = {},
): Promise<void> {
  // No photo row: the log outlives the photo it names, so a row may name none.
  await ctx.client.query(
    `INSERT INTO photo_access (account_id, photo_id, variant, at, purpose)
     VALUES ($1, gen_random_uuid(), $2, $3, $4)`,
    [accountId, variant, at, purpose],
  );
}

async function left(ctx: TestContext): Promise<Date[]> {
  const { rows } = await ctx.client.query<{ at: Date }>("SELECT at FROM photo_access ORDER BY at");
  return rows.map((r) => r.at);
}

describe("the night's prune of the fetch log", () => {
  test("deletes a row older than a year, keeps one of exactly a year, and touches nothing younger", async ({
    ctx,
  }) => {
    const me = await signedInAccount(ctx.client);
    await logged(ctx, me.accountId, new Date(YEAR_AGO.getTime() - 1));
    await logged(ctx, me.accountId, YEAR_AGO);
    await logged(ctx, me.accountId, new Date("2026-11-16T01:59:00.000Z"));
    expect(await prunePhotoAccess(ctx.client, NIGHT)).toBe(1);
    expect(await left(ctx)).toEqual([YEAR_AGO, new Date("2026-11-16T01:59:00.000Z")]);
  });

  test("deletes every account's old rows, of each variant and purpose", async ({ ctx }) => {
    const me = await signedInAccount(ctx.client);
    const other = await signedInAccount(ctx.client);
    const old = new Date("2025-01-01T12:00:00.000Z");
    await logged(ctx, me.accountId, old, { variant: "thumb" });
    await logged(ctx, me.accountId, old, { variant: "full", purpose: "message" });
    await logged(ctx, other.accountId, old, { variant: "card" });
    await logged(ctx, other.accountId, NIGHT);
    expect(await prunePhotoAccess(ctx.client, NIGHT)).toBe(3);
    expect(await left(ctx)).toEqual([NIGHT]);
  });

  test("answers 0 when nothing is past the year", async ({ ctx }) => {
    const me = await signedInAccount(ctx.client);
    await logged(ctx, me.accountId, YEAR_AGO);
    expect(await prunePhotoAccess(ctx.client, NIGHT)).toBe(0);
    expect(await left(ctx)).toEqual([YEAR_AGO]);
  });

  test("finds the old rows by their time alone, through photo_access_at_idx", async ({ ctx }) => {
    // The table is a few rows here, so the planner would scan it; with the scan
    // made dear, the plan shows which index serves a delete by time alone.
    await ctx.client.query("SET LOCAL enable_seqscan = off");
    const { rows } = await ctx.client.query<{ "QUERY PLAN": string }>(
      "EXPLAIN DELETE FROM photo_access WHERE at < $1",
      [YEAR_AGO],
    );
    expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(/photo_access_at_idx/);
  });
});
