import {
  CHANNEL_NAME_PATTERN,
  INVITATION_CODE_PATTERN,
  normaliseInvitationCode,
} from "@kuutti/schema";
import { Hono } from "hono";
import type { Deps } from "../app.ts";
import type { AppEnv } from "../lib/env.ts";

/** Where everybody goes whose phone has no store of Kuutti's yet. */
export const SITE_URL = "https://kumpa.fi/";

/**
 * One link for Kuutti (#574, ADR-044 §13): `/i` and `/i/{code}` send an
 * iPhone or iPad to the App Store, an Android phone to Play and anything else
 * to the website, by the User-Agent alone. The code is never looked up, so no
 * database is asked and every code gets the same answer; on Android it rides
 * to Play as the install referrer, which the app reads at its first start
 * (#184). A phone that has Kumpa never comes here with a code: the system
 * hands `/i/{code}` to the app, which takes the code itself (identity's
 * links.ts, ADR-074 §4). A store's address is configuration, unset until its
 * listing is out (#193), and the website until then. No page, nothing kept:
 * the request line names the route, never the code (lib/logger.ts).
 *
 * `/i?from=<channel>` names the place the link was handed out (#653), so the
 * stores count installs per link on their side: Apple's campaign token, once
 * the provider token is configured, and Play's UTM source inside the referrer.
 * A channel is told from a code by where it sits, and the two never ride
 * together: a code is a person's, a channel a partner's, so `/i/{code}` reads
 * no `from`. A name of the wrong shape is dropped and the phone goes to its
 * store untagged. The referrer `utm_source=<channel>` can never read as a code
 * (the `=` survives the code's normaliser), so the app's reader of it leaves
 * the code's field alone.
 */
export function invitationLinkRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const { APP_STORE_URL, APP_STORE_PROVIDER_TOKEN, PLAY_STORE_URL } = deps.config;

  const appStore = (channel: string | undefined): string => {
    if (!APP_STORE_URL) return SITE_URL;
    if (channel === undefined || !APP_STORE_PROVIDER_TOKEN) return APP_STORE_URL;
    const store = new URL(APP_STORE_URL);
    store.searchParams.set("pt", APP_STORE_PROVIDER_TOKEN);
    store.searchParams.set("ct", channel);
    store.searchParams.set("mt", "8");
    return store.toString();
  };

  const play = (referrer: string | undefined): string => {
    if (!PLAY_STORE_URL) return SITE_URL;
    const store = new URL(PLAY_STORE_URL);
    if (referrer !== undefined) store.searchParams.set("referrer", referrer);
    return store.toString();
  };

  const codeReferrer = (code: string): string | undefined => {
    const normalised = normaliseInvitationCode(code);
    return INVITATION_CODE_PATTERN.test(normalised) ? normalised : undefined;
  };

  const where = (userAgent: string, code: string | undefined, channel: string | undefined) => {
    // An iPod's User-Agent says iPhone OS.
    if (/iPhone|iPad/.test(userAgent)) return appStore(code === undefined ? channel : undefined);
    if (!/Android/.test(userAgent)) return SITE_URL;
    if (code !== undefined) return play(codeReferrer(code));
    return play(channel === undefined ? undefined : `utm_source=${channel}`);
  };

  const channelOf = (from: string | undefined): string | undefined =>
    from !== undefined && CHANNEL_NAME_PATTERN.test(from) ? from : undefined;

  for (const path of ["/i", "/i/:code"]) {
    app.get(path, (c) => {
      c.header("cache-control", "no-store");
      const place = where(
        c.req.header("user-agent") ?? "",
        c.req.param("code"),
        channelOf(c.req.query("from")),
      );
      return c.redirect(place, 302);
    });
  }

  return app;
}
