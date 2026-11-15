import { describe, expect } from "vitest";
import { matchingOpen } from "../lib/matching-config.ts";
import { signedInAccount } from "../test/account.ts";
import { type TestContext, test } from "../test/harness.ts";
import { findHomeOfAccount, lockHomeOfAccount, turnMatching, writeHomeOfAccount } from "./repo.ts";

// The pond slice's rows (#46, #500, #514, #607): the home of an account, the
// write that sets it, and the switch. Each statement about a person carries
// that person's account id (rule 6).

describe("the home of an account", () => {
  test("an account's home is its own, and there is none before the write", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client, "a");
    const b = await signedInAccount(ctx.client, "b");
    expect(await findHomeOfAccount(ctx.client, a.accountId)).toEqual({
      place: null,
      showsArea: false,
    });
    await writeHomeOfAccount(ctx.client, a.accountId, { place: "00530", showsArea: false });
    expect(await findHomeOfAccount(ctx.client, a.accountId)).toEqual({
      place: "00530",
      showsArea: false,
    });
    expect(await findHomeOfAccount(ctx.client, b.accountId)).toEqual({
      place: null,
      showsArea: false,
    });
  });

  test("a write with no place leaves the kept place, and sets what the card shows", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    await writeHomeOfAccount(ctx.client, a.accountId, { place: "00530", showsArea: false });
    await writeHomeOfAccount(ctx.client, a.accountId, { place: null, showsArea: true });
    expect(await findHomeOfAccount(ctx.client, a.accountId)).toEqual({
      place: "00530",
      showsArea: true,
    });
  });

  test("the lock finds a live account's home, and nothing on a tombstone", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    await ctx.client.query("UPDATE account SET home_place = '091' WHERE id = $1", [a.accountId]);
    expect(await lockHomeOfAccount(ctx.client, a.accountId)).toEqual({
      place: "091",
      showsArea: false,
    });
    await ctx.client.query(
      "UPDATE account SET state = 'deleted', deleted_at = now() WHERE id = $1",
      [a.accountId],
    );
    expect(await lockHomeOfAccount(ctx.client, a.accountId)).toBeNull();
    expect(await findHomeOfAccount(ctx.client, "00000000-0000-4000-8000-000000000009")).toBeNull();
  });
});

describe("the switch, as a row of matching_config (#500, #607, ADR-060 §2)", () => {
  /** Every version of the switch after the one the migrations wrote. */
  const turns = async (ctx: TestContext) =>
    (
      await ctx.client.query(
        `SELECT id, version, value, created_by, reason FROM matching_config
          WHERE key = 'matching_open' AND version > 1 ORDER BY version`,
      )
    ).rows;

  test("a press that meets the switch as it asks writes nothing", async ({ ctx }) => {
    expect(await turnMatching(ctx.client, false, "test-a")).toBeNull();
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await turns(ctx)).toEqual([]);
  });

  test("a press writes the next version, by whoever pressed and with no reason, and names its row", async ({
    ctx,
  }) => {
    const opened = await turnMatching(ctx.client, true, "test-a");
    expect(await matchingOpen(ctx.client)).toBe(true);
    expect(await turnMatching(ctx.client, true, "test-b")).toBeNull();
    const closed = await turnMatching(ctx.client, false, "test-b");
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await turns(ctx)).toEqual([
      { id: opened, version: 2, value: true, created_by: "test-a", reason: null },
      { id: closed, version: 3, value: false, created_by: "test-b", reason: null },
    ]);
    expect(opened).not.toBe(closed);
  });

  test("a press changes no tunable but the switch", async ({ ctx }) => {
    const others = async () =>
      (
        await ctx.client.query(
          "SELECT key, version FROM matching_config WHERE key <> 'matching_open' ORDER BY key, version",
        )
      ).rows;
    const before = await others();
    await turnMatching(ctx.client, true, "test-a");
    expect(await others()).toEqual(before);
  });
});
