import type { Queryable } from "@kuutti/db";
import { Sanction } from "@kuutti/schema";
import { createApp } from "../app.ts";
import { eraseAccount } from "../identity/index.ts";
import { MailFailed, type MailMessage } from "../lib/mail.ts";
import { applySanction } from "../safety/index.ts";
import {
  confirmedAddress,
  type SignedIn,
  type Staff,
  signedInAccount,
  staffSession,
} from "../test/account.ts";
import {
  captureLogger,
  describe,
  expect,
  jsonHeaders as json,
  type TestContext,
  test,
  testConfig,
} from "../test/harness.ts";
import { mailingApp } from "../test/push.ts";
import { createPush } from "./push.ts";
import { mailSanction } from "./sanction-mail.ts";

// A sanction's statement by email (#715, ADR-073 §4; features/safety/
// sanctions.feature): once, after a sanction staff applied committed, to the
// account's confirmed address, in the language its terms were read in,
// whatever its switches say; nothing for an address unconfirmed or gone, a
// sanction lifted by then, a lift or a review. The app is the real one over a
// memory mailer; `settled` waits for the background.

/** 12:00 in Helsinki on 20.10.2026: a suspension until 22.10 is two days ahead. */
const T = new Date("2026-10-20T09:00:00.000Z");
const NOTE = "Wrote to her again after a no, ticket K7Q-3091";
const ADDRESS = "a.person@example.test";

type App = ReturnType<typeof createApp>;

const send = (app: App, staff: Staff, path: string, body?: unknown) =>
  app.request(path, {
    method: "POST",
    headers: body === undefined ? staff.headers : json(staff.headers),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function created(answer: Response): Promise<Sanction> {
  expect(answer.status).toBe(201);
  return Sanction.parse(await answer.json());
}

/** A member of staff applies `kind` to `who` for harassment, through the panel's route for it. */
async function applied(ctx: TestContext, app: App, who: SignedIn, kind: Kind): Promise<Sanction> {
  if (kind === "ban") {
    const admin = await staffSession(ctx.client, "admin");
    return created(
      await send(app, admin, `/admin/accounts/${who.accountId}/bans`, {
        reason: "harassment",
        note: NOTE,
      }),
    );
  }
  const moderator = await staffSession(ctx.client);
  return created(
    await send(app, moderator, `/admin/accounts/${who.accountId}/sanctions`, {
      kind,
      reason: "harassment",
      note: NOTE,
      ...(kind === "suspend" ? { endsOn: "2026-10-22" } : {}),
    }),
  );
}

type Kind = "warn" | "shadow_ban" | "suspend" | "ban";

/** A sanction written straight through the safety slice, with no mail: for mailSanction's own tests. */
const sanctionOf = (
  db: Queryable,
  who: SignedIn,
  input: Partial<Parameters<typeof applySanction>[1]>,
) =>
  applySanction(db, {
    accountId: who.accountId,
    kind: "warn",
    reason: "harassment",
    note: NOTE,
    actor: null,
    at: T,
    ...input,
  });

/** A memory mailer, and a log to read. */
async function mailDeps(db: Queryable) {
  const { logger, lines } = await captureLogger();
  const sent: MailMessage[] = [];
  return {
    deps: { db, logger, mailer: { send: async (m: MailMessage) => void sent.push(m) } },
    sent,
    logs: lines,
  };
}

/** The paragraphs of the one mail sent. */
function paragraphsOf(sent: MailMessage[]): string[] {
  expect(sent).toHaveLength(1);
  return sent[0]?.text.split("\n\n") ?? [];
}

const FI_CONTEST =
  "Jos olemme mielestäsi erehtyneet, kirjoita osoitteeseen hello@kuutti.app. Asian katsoo uudelleen joku muu kuin päätöksen tehnyt.";
const EN_CONTEST =
  "If you think we got this wrong, write to hello@kuutti.app. Someone other than the person who decided will look at it again.";
const EN_WHY =
  "You get this because you confirmed this address in the Kumpa app. A decision about your account is always sent to you, whatever your notification settings say.";

describe("Each sanction is mailed once to its person's confirmed address", () => {
  test.for([
    {
      kind: "warn",
      row: "warning",
      subject: "Kumpa: varoitus moderaattorilta",
      what: "Varoitus ei sellaisenaan muuta mitään siinä, miten käytät sovellusta.",
    },
    {
      kind: "shadow_ban",
      row: "shadow ban",
      subject: "Kumpa: muut eivät toistaiseksi näe profiiliasi",
      what: "Profiiliasi ei toistaiseksi näytetä muille, eivätkä tykkäyksesi ja viestisi tavoita heitä.",
    },
    {
      kind: "suspend",
      row: "suspension",
      subject: "Kumpa: tilisi on jäädytetty",
      // The start of 22.10 in Finland, said as Finland writes a date.
      what: "Tämä tili on jäädytetty. Voit kirjautua taas sisään alkaen: 22.10.2026",
    },
    {
      kind: "ban",
      row: "ban",
      subject: "Kumpa: tilisi on suljettu",
      what: "Tilisi on suljettu pysyvästi: et voi kirjautua sisään etkä avata uutta tiliä.",
    },
  ] as const)("$row", async ({ kind, subject, what }, { ctx }) => {
    const { app, sent, logs, settled } = await mailingApp(ctx.client, () => T);
    const a = await signedInAccount(ctx.client);
    await confirmedAddress(ctx.client, a, ADDRESS, "fi");
    // A switch off changes nothing: a decision about the account is told whatever they say.
    await ctx.client.query(
      `INSERT INTO notification_preference (account_id, kind, enabled)
       VALUES ($1, 'moderation', false), ($1, 'announcement', false)`,
      [a.accountId],
    );
    await applied(ctx, app, a, kind);
    await settled();
    expect(sent.map((m) => ({ to: m.to, subject: m.subject }))).toEqual([{ to: ADDRESS, subject }]);
    expect(paragraphsOf(sent)).toEqual([
      what,
      "Syy: Häirintä.",
      "Käyttöehdot, kohta 4: et saa uhkailla, häiritä tai painostaa ketään etkä pyytää keneltäkään rahaa.",
      "Tämän päätti moderaattori.",
      FI_CONTEST,
      expect.stringContaining("vahvistit tämän osoitteen"),
      "Kuutti ry",
    ]);
    const mail = JSON.stringify({ subject: sent[0]?.subject, text: sent[0]?.text });
    expect(mail).not.toContain("K7Q-3091");
    expect(mail).not.toContain(ADDRESS);
    const log = JSON.stringify(logs());
    expect(log).not.toContain("K7Q-3091");
    expect(log).not.toContain(ADDRESS);
    expect(logs().filter((line) => line.msg === "sanction mailed")).toEqual([
      expect.objectContaining({ accountId: a.accountId, kind }),
    ]);
  });
});

describe("Sanctions", () => {
  test("A sanction is not mailed to an unconfirmed address, nor once lifted", async ({ ctx }) => {
    const { push, sent, logs, settled } = await mailingApp(ctx.client, () => T);
    // The same app, its sanctions' mail held until the test lets it go.
    const held: Array<{ accountId: string; sanctionId: string }> = [];
    const app = createApp({
      config: testConfig(),
      logger: (await captureLogger()).logger,
      db: ctx.client,
      now: () => T,
      push: { ...push, sanction: (input) => void held.push(input) },
    });
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    await ctx.client.query("UPDATE account SET email = $2 WHERE id = $1", [
      a.accountId,
      "unconfirmed@example.test",
    ]);
    await confirmedAddress(ctx.client, b, "b@example.test", "en");
    await applied(ctx, app, a, "warn");
    const warning = await applied(ctx, app, b, "warn");
    const admin = await staffSession(ctx.client, "admin");
    expect((await send(app, admin, `/admin/sanctions/${warning.id}/lift`)).status).toBe(200);
    // Each was handed to the mail, which goes only now.
    expect(held.map((input) => input.accountId)).toEqual([a.accountId, b.accountId]);
    for (const input of held) push.sanction(input);
    await settled();
    expect(sent).toEqual([]);
    expect(logs().filter((line) => String(line.msg).startsWith("sanction mail"))).toEqual([]);
  });

  test("Lifting or reviewing a sanction sends nothing", async ({ ctx }) => {
    const { app, sent, settled } = await mailingApp(ctx.client, () => T);
    const a = await signedInAccount(ctx.client);
    await confirmedAddress(ctx.client, a, ADDRESS, "en");
    const suspension = await applied(ctx, app, a, "suspend");
    await settled();
    const other = await staffSession(ctx.client);
    const kept = await send(app, other, `/admin/sanctions/${suspension.id}/review`, {
      note: "Read the report again; it stands.",
      outcome: "keep",
    });
    expect(kept.status).toBe(200);
    const admin = await staffSession(ctx.client, "admin");
    expect((await send(app, admin, `/admin/sanctions/${suspension.id}/lift`)).status).toBe(200);
    await settled();
    expect(sent.map((m) => m.subject)).toEqual(["Kumpa: your account is suspended"]);
  });
});

describe("mailSanction", () => {
  test("says a warning in full, in English where no terms were read", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    await ctx.client.query(
      "UPDATE account SET email = $2, email_confirmed_at = now() WHERE id = $1",
      [a.accountId, ADDRESS],
    );
    const warning = await sanctionOf(ctx.client, a, {});
    const { deps, sent } = await mailDeps(ctx.client);
    expect(await mailSanction(deps, { accountId: a.accountId, sanctionId: warning.id })).toBe(true);
    expect(sent).toEqual([
      {
        to: ADDRESS,
        subject: "Kumpa: a warning from a moderator",
        text: [
          "A warning by itself changes nothing in how you use the app.",
          "Why: Harassment.",
          "The terms of use, section 4: you must not threaten, harass or pressure anyone, or ask anyone for money.",
          "A moderator decided this.",
          EN_CONTEST,
          EN_WHY,
          "Kuutti ry",
        ].join("\n\n"),
      },
    ]);
  });

  test("goes in the language the terms were read in last", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    await confirmedAddress(ctx.client, a, ADDRESS, "fi");
    await ctx.client.query(
      `INSERT INTO consent (account_id, kind, version, locale_shown, given_at)
       VALUES ($1, 'terms', 'test-2', 'sv', now() + interval '1 minute')`,
      [a.accountId],
    );
    const warning = await sanctionOf(ctx.client, a, {});
    const { deps, sent } = await mailDeps(ctx.client);
    await mailSanction(deps, { accountId: a.accountId, sanctionId: warning.id });
    expect(paragraphsOf(sent)[1]).toBe("Skäl: Trakasserier.");
  });

  test("says a suspension's end as the day it is in Finland", async ({ ctx }) => {
    const a = await signedInAccount(ctx.client);
    await confirmedAddress(ctx.client, a, ADDRESS, "en");
    // Its end is the start of 22.10 in Finland, still 21.10 in UTC.
    const suspension = await sanctionOf(ctx.client, a, { kind: "suspend", endsOn: "2026-10-22" });
    expect(suspension.endsAt).toBe("2026-10-21T21:00:00.000Z");
    const { deps, sent } = await mailDeps(ctx.client);
    await mailSanction(deps, { accountId: a.accountId, sanctionId: suspension.id });
    expect(paragraphsOf(sent)[0]).toBe(
      "This account is suspended. You can sign in again from: 22.10.2026",
    );
  });

  test.for([
    { what: "the address is not confirmed", email: ADDRESS, confirmed: false },
    { what: "there is no address", email: null, confirmed: false },
  ] as const)("sends nothing when $what", async ({ email, confirmed }, { ctx }) => {
    const a = await signedInAccount(ctx.client);
    await ctx.client.query("UPDATE account SET email = $2, email_confirmed_at = $3 WHERE id = $1", [
      a.accountId,
      email,
      confirmed ? T : null,
    ]);
    const warning = await sanctionOf(ctx.client, a, {});
    const { deps, sent, logs } = await mailDeps(ctx.client);
    expect(await mailSanction(deps, { accountId: a.accountId, sanctionId: warning.id })).toBe(
      false,
    );
    expect(sent).toEqual([]);
    expect(logs()).toEqual([]);
  });

  test("sends nothing for a sanction lifted, of an account erased, or asked under another account", async ({
    ctx,
  }) => {
    const a = await signedInAccount(ctx.client);
    const b = await signedInAccount(ctx.client);
    await confirmedAddress(ctx.client, a, ADDRESS, "en");
    await confirmedAddress(ctx.client, b, "b@example.test", "en");
    const { deps, sent } = await mailDeps(ctx.client);
    const warning = await sanctionOf(ctx.client, a, {});
    // A's sanction asked as B's: B's address is never reached through it.
    expect(await mailSanction(deps, { accountId: b.accountId, sanctionId: warning.id })).toBe(
      false,
    );
    await ctx.client.query("UPDATE sanction SET lifted_at = $2 WHERE id = $1", [warning.id, T]);
    expect(await mailSanction(deps, { accountId: a.accountId, sanctionId: warning.id })).toBe(
      false,
    );
    const second = await sanctionOf(ctx.client, a, {});
    const { logger } = await captureLogger();
    await eraseAccount({ db: ctx.client, logger, now: () => T }, a.accountId);
    expect(await mailSanction(deps, { accountId: a.accountId, sanctionId: second.id })).toBe(false);
    expect(sent).toEqual([]);
  });

  test.for([
    {
      what: "SES's refusal by its reason and status",
      error: new MailFailed("MessageRejected", 400),
      logged: { reason: "MessageRejected", status: 400 },
    },
    {
      what: "any other failure by its name",
      error: new TypeError(ADDRESS),
      logged: { reason: "TypeError" },
    },
  ])(
    "logs $what, never the address, and says the mail did not go",
    async ({ error, logged }, { ctx }) => {
      const a = await signedInAccount(ctx.client);
      await confirmedAddress(ctx.client, a, ADDRESS, "en");
      const warning = await sanctionOf(ctx.client, a, {});
      const { logger, lines } = await captureLogger();
      const mailer = {
        send: async () => {
          throw error;
        },
      };
      expect(
        await mailSanction(
          { db: ctx.client, logger, mailer },
          { accountId: a.accountId, sanctionId: warning.id },
        ),
      ).toBe(false);
      expect(lines()).toEqual([
        expect.objectContaining({
          level: 40,
          msg: "sanction mail not sent",
          accountId: a.accountId,
          kind: "warn",
          ...logged,
        }),
      ]);
      expect(JSON.stringify(lines())).not.toContain(ADDRESS);
    },
  );
});

describe("the push's sanction", () => {
  test("reads and sends nothing where mail is off", async () => {
    const { logger, lines } = await captureLogger();
    const db = {
      query: async () => {
        throw new Error("nothing is read where mail is off");
      },
    } as unknown as Queryable;
    const push = createPush({ db, logger, now: () => T, online: () => false });
    push.sanction({ accountId: "a", sanctionId: "s" });
    await push.settled();
    expect(lines()).toEqual([]);
  });
});
