import { randomBytes } from "node:crypto";
import type { Queryable } from "@kuutti/db";
import { Hono } from "hono";
import type { Deps } from "../app.ts";
import type { Config } from "../lib/config.ts";
import type { AppEnv } from "../lib/env.ts";
import { AppError } from "../lib/errors.ts";
import * as repo from "./repo.ts";

// One-click unsubscribe from the announcement email (#196, RFC 8058; ADR-068
// §5): the email's List-Unsubscribe header names a link of this API, and the
// mail app's Unsubscribe posts to it. The link carries the account's secret,
// 256 random bits, and nothing else; the POST turns the Announcements switch
// off, as Settings would (the maintainer, 18/11/2026). A machine caller's
// plain route, no page (rule 8): a GET, which mail scanners and browsers
// make, changes nothing and is answered 405. The request line names the
// route, never the secret (lib/logger.ts).

export const UNSUBSCRIBE_PATH = "/mail/unsubscribe";

/** 32 random bytes as base64url, unpadded. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where the one click is posted: on the host of the registered callback, the
 * API's own public name, as the verified links are (identity/links.ts), and
 * https only, which RFC 8058 §3.1 requires. None where the callback is unset
 * or plain http (a developer's machine): the email then carries no header.
 */
export function unsubscribeBase(config: Pick<Config, "OIDC_REDIRECT_URI">): string | undefined {
  if (!config.OIDC_REDIRECT_URI) return undefined;
  const callback = new URL(config.OIDC_REDIRECT_URI);
  return callback.protocol === "https:" ? `${callback.origin}${UNSUBSCRIBE_PATH}/` : undefined;
}

/** The account's one-click link under `base`, its secret made the first time; null when the account is erased. */
export async function unsubscribeLinkOf(
  db: Queryable,
  base: string,
  accountId: string,
): Promise<string | null> {
  const token = await repo.unsubscribeTokenOf(db, accountId, randomBytes(32).toString("base64url"));
  return token ? `${base}${token}` : null;
}

export function unsubscribeRoutes(deps: Pick<Deps, "db" | "logger" | "now">) {
  const app = new Hono<AppEnv>();
  const path = `${UNSUBSCRIBE_PATH}/:token`;
  const now = deps.now ?? (() => new Date());

  // RFC 8058 §3.2: a POST whose body is "List-Unsubscribe=One-Click", as
  // multipart or a form. The body adds nothing the link does not say, so it
  // is not read; no redirect (§3.1), and a second click answers as the first.
  // shortcut: the route shares the address's request limit (ADR-026), and a
  // mail provider posts from a few servers, so very many clicks in a minute
  // from one would meet it; a window keyed by this route would lift it.
  app.post(path, async (c) => {
    c.header("cache-control", "no-store");
    const token = c.req.param("token");
    const accountId = TOKEN.test(token)
      ? await repo.unsubscribeByToken(deps.db, token, now())
      : null;
    if (!accountId) throw new AppError(404, "not_found", "No such unsubscribe link");
    deps.logger.info({ accountId }, "announcements unsubscribed");
    return c.body(null, 200);
  });

  app.get(path, (c) => {
    c.header("allow", "POST");
    c.header("cache-control", "no-store");
    return c.body(null, 405);
  });

  return app;
}
