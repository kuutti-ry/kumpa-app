import { ConfigList, MatchingSwitchState } from "@kuutti/schema";
import { createApp } from "../app.ts";
import { matchingOpen } from "../lib/matching-config.ts";
import { signedInAccount, staffSession } from "../test/account.ts";
import { errorCode } from "../test/answers.ts";
import {
  captureLogger,
  describe,
  expect,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import { pidOf, waitsFor, watched, withTwoConnections } from "../test/races.ts";
import { turnMatching } from "./repo.ts";

// The switch in the panel (#500, #607, ADR-060 §1, §2,
// features/pond/opening.feature): who may read and turn it, what the audit log
// and matching_config hold of it, and every refusal. What the switch does to a
// person's matching is jobs/pool.test.ts.

type Headers = Record<string, string>;

const read = (ctx: TestContext, headers: Headers) =>
  ctx.app.request("/admin/matching", { headers });

const press = (ctx: TestContext, headers: Headers, body: unknown) =>
  ctx.app.request("/admin/matching", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** The switch's turns, oldest first: the audit row of each with the version it is about. */
const auditRows = async (ctx: TestContext) =>
  (
    await ctx.client.query(
      `SELECT l.actor_identity_id, l.action, l.subject_type, l.detail,
              c.version, c.value, c.created_by, c.reason
         FROM audit_log l JOIN matching_config c ON c.id = l.subject_id
        WHERE l.action = 'pond.matching' ORDER BY c.version`,
    )
  ).rows;

/** Every row the audit log holds about the switch, whatever it points at. */
const auditCount = async (ctx: TestContext) =>
  (
    await ctx.client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM audit_log WHERE action = 'pond.matching'",
    )
  ).rows[0]?.n;

describe("two presses at once", () => {
  test("the second waits for the first, finds the switch as it asks and writes nothing", async () => {
    await withTwoConnections("kuutti-607-press", async (pool, first, second) => {
      const firstPid = await pidOf(first);
      const secondPid = await pidOf(second);
      await first.query("BEGIN");
      await second.query("BEGIN");
      expect(await turnMatching(first, true, "test-first")).toEqual(expect.any(String));
      const racing = watched(turnMatching(second, true, "test-second"));
      expect(await waitsFor(pool, secondPid, firstPid, racing.settled)).toBe(true);
      await first.query("COMMIT");
      expect(await racing.outcome).toBeNull();
      await second.query("COMMIT");
      const { rows } = await pool.query(
        `SELECT version, value, created_by FROM matching_config
          WHERE key = 'matching_open' AND version > 1`,
      );
      expect(rows).toEqual([{ version: 2, value: true, created_by: "test-first" }]);
    });
  });
});

describe("the switch in the panel", () => {
  test("an admin reads the switch, closed until it is turned", async ({ ctx }) => {
    const admin = await staffSession(ctx.client, "admin");
    const before = await read(ctx, admin.headers);
    expect(before.status).toBe(200);
    expect(MatchingSwitchState.parse(await before.json())).toEqual({ open: false });

    expect((await press(ctx, admin.headers, { open: true })).status).toBe(200);
    const after = await read(ctx, admin.headers);
    expect(MatchingSwitchState.parse(await after.json())).toEqual({ open: true });
  });

  test("The switch is written to the audit log once, with no words", async ({ ctx }) => {
    const admin = await staffSession(ctx.client, "admin");

    const opened = await press(ctx, admin.headers, { open: true });
    expect(opened.status).toBe(200);
    expect(MatchingSwitchState.parse(await opened.json())).toEqual({ open: true });
    expect(await matchingOpen(ctx.client)).toBe(true);

    // A second press finds the switch as it asks: nothing changes, nothing is written.
    const again = await press(ctx, admin.headers, { open: true });
    expect(again.status).toBe(200);
    expect(MatchingSwitchState.parse(await again.json())).toEqual({ open: true });
    // Each row is about the version it wrote, by the admin and with no reason.
    const row = {
      actor_identity_id: admin.identityId,
      action: "pond.matching",
      subject_type: "config",
      created_by: admin.identityId,
      reason: null,
    };
    const turnedOn = { ...row, detail: { open: true }, version: 2, value: true };
    expect(await auditRows(ctx)).toEqual([turnedOn]);

    const closed = await press(ctx, admin.headers, { open: false });
    expect(closed.status).toBe(200);
    expect(MatchingSwitchState.parse(await closed.json())).toEqual({ open: false });
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await auditRows(ctx)).toEqual([
      turnedOn,
      { ...row, detail: { open: false }, version: 3, value: false },
    ]);
    expect(await auditCount(ctx)).toBe(2);
  });

  test("the log line says which way and who, and only for a press that changed it", async ({
    ctx,
  }) => {
    const admin = await staffSession(ctx.client, "admin");
    const { logger, lines } = await captureLogger();
    const app = createApp({ config: testConfig(), logger, db: ctx.client });
    const send = (open: boolean) =>
      app.request("/admin/matching", {
        method: "POST",
        headers: { ...admin.headers, "content-type": "application/json" },
        body: JSON.stringify({ open }),
      });
    expect((await send(true)).status).toBe(200);
    expect((await send(true)).status).toBe(200);
    const said = lines().filter((line) => line.msg === "pond matching");
    expect(said).toHaveLength(1);
    expect(said[0]).toMatchObject({ open: true, staffIdentityId: admin.identityId });
  });

  test("Only an admin turns the switch", async ({ ctx }) => {
    const moderator = await staffSession(ctx.client, "moderator");
    const person = await signedInAccount(ctx.client);

    const seen = await read(ctx, moderator.headers);
    expect(seen.status).toBe(403);
    expect(await errorCode(seen)).toBe("admin_forbidden");
    const turned = await press(ctx, moderator.headers, { open: true });
    expect(turned.status).toBe(403);
    expect(await errorCode(turned)).toBe("admin_forbidden");

    for (const headers of [{}, person.headers]) {
      expect((await read(ctx, headers)).status).toBe(401);
      expect((await press(ctx, headers, { open: true })).status).toBe(401);
    }
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await auditCount(ctx)).toBe(0);
  });

  test("The switch is not one of the tunables", async ({ ctx }) => {
    const admin = await staffSession(ctx.client, "admin");
    const versions = async () =>
      (
        await ctx.client.query<{ n: number }>(
          "SELECT count(*)::int AS n FROM matching_config WHERE key = 'matching_open'",
        )
      ).rows[0]?.n;
    expect(await versions()).toBe(1);

    const listed = await ctx.app.request("/admin/config", { headers: admin.headers });
    expect(listed.status).toBe(200);
    const keys = ConfigList.parse(await listed.json()).items.map((item) => item.key);
    expect(keys).not.toContain("matching_open");
    // The list is not empty for another reason: a tunable beside it is there.
    expect(keys).toContain("pond_counter_k");

    const written = await ctx.app.request("/admin/config/matching_open", {
      method: "POST",
      headers: { ...admin.headers, "content-type": "application/json" },
      body: JSON.stringify({ value: true, reason: "Opening by the other door" }),
    });
    expect(written.status).toBe(404);
    expect(await errorCode(written)).toBe("not_found");
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await versions()).toBe(1);
    expect(await auditCount(ctx)).toBe(0);

    // And once it has been turned, its versions stay off that screen.
    expect((await press(ctx, admin.headers, { open: true })).status).toBe(200);
    const after = await ctx.app.request("/admin/config", { headers: admin.headers });
    expect(ConfigList.parse(await after.json()).items.map((item) => item.key)).toEqual(keys);
  });

  test.for([
    ["no body", undefined, "http_error"],
    ["no switch", {}, "validation_failed"],
    ["a switch that is no boolean", { open: "true" }, "validation_failed"],
    [
      "a reason, which the switch asks for none of",
      { open: true, reason: "ready" },
      "validation_failed",
    ],
    ["a pond, which there is none of", { open: true, pond: "suomi" }, "validation_failed"],
  ] as const)("refuses %s", async ([_, body, code], { ctx }) => {
    const admin = await staffSession(ctx.client, "admin");
    const refused = await press(ctx, admin.headers, body);
    expect(refused.status).toBe(400);
    expect(await errorCode(refused)).toBe(code);
    expect(await matchingOpen(ctx.client)).toBe(false);
    expect(await auditCount(ctx)).toBe(0);
  });
});
