import { matchingOpen, readMatchingConfig } from "../lib/matching-config.ts";
import { openMatchingHere, withMatchingConfig } from "./account.ts";
import { describe, expect, test } from "./harness.ts";
import { pidOf, waitsFor, watched, withTwoConnections } from "./races.ts";

/**
 * Both tests create the same table and insert the same primary key. They can
 * only both pass if the first test's transaction was rolled back.
 */
describe("test harness transaction isolation", () => {
  test("first insert of a unique row", async ({ ctx }) => {
    await ctx.client.query("CREATE TABLE harness_probe (id int PRIMARY KEY)");
    await ctx.client.query("INSERT INTO harness_probe (id) VALUES (1)");
    const rows = await ctx.client.query<{ n: string }>("SELECT count(*) AS n FROM harness_probe");
    expect(rows.rows[0]?.n).toBe("1");
  });

  test("second insert of the same unique row", async ({ ctx }) => {
    await ctx.client.query("CREATE TABLE harness_probe (id int PRIMARY KEY)");
    await ctx.client.query("INSERT INTO harness_probe (id) VALUES (1)");
    const rows = await ctx.client.query<{ n: string }>("SELECT count(*) AS n FROM harness_probe");
    expect(rows.rows[0]?.n).toBe("1");
  });
});

/**
 * Tests in different workers share one database, each inside a transaction
 * of its own. The switch is one key (#607): were each test to write its next
 * version, a test would wait for every other that has opened matching and
 * not yet rolled back.
 */
describe("opening matching in a test", () => {
  test("two tests that open matching at once do not wait for each other", async () => {
    await withTwoConnections("kuutti-open-here", async (pool, first, second) => {
      const firstPid = await pidOf(first);
      const secondPid = await pidOf(second);
      await first.query("BEGIN");
      await second.query("BEGIN");
      await openMatchingHere(first);
      const racing = watched(openMatchingHere(second));
      expect(await waitsFor(pool, secondPid, firstPid, racing.settled)).toBe(false);
      expect(await matchingOpen(first)).toBe(true);
      expect(await matchingOpen(second)).toBe(true);
      await first.query("ROLLBACK");
      await second.query("ROLLBACK");
      expect(await matchingOpen(pool)).toBe(false);
    });
  });

  // Every key, not only the switch: on 26/11/2026 (#766) earned.test.ts's
  // like budget and velocity.test.ts's queue-read rule waited behind other
  // workers' tests that had written the same key's next version, and timed out.
  test("two tests that set the same value at once do not wait for each other", async () => {
    await withTwoConnections("kuutti-config-here", async (pool, first, second) => {
      const firstPid = await pidOf(first);
      const secondPid = await pidOf(second);
      await first.query("BEGIN");
      await second.query("BEGIN");
      await withMatchingConfig(first, { like_budget_balanced: 1 });
      const racing = watched(withMatchingConfig(second, { like_budget_balanced: 2 }));
      expect(await waitsFor(pool, secondPid, firstPid, racing.settled)).toBe(false);
      await withMatchingConfig(second, { like_budget_balanced: 3 });
      expect(await readMatchingConfig(first, "like_budget_balanced")).toBe(1);
      expect(await readMatchingConfig(second, "like_budget_balanced")).toBe(3);
      await first.query("ROLLBACK");
      await second.query("ROLLBACK");
    });
  });

  test("matching opens again after the test's own close", async ({ ctx }) => {
    await openMatchingHere(ctx.client);
    expect(await matchingOpen(ctx.client)).toBe(true);
    await withMatchingConfig(ctx.client, { matching_open: false });
    expect(await matchingOpen(ctx.client)).toBe(false);
    await openMatchingHere(ctx.client);
    expect(await matchingOpen(ctx.client)).toBe(true);
  });
});
