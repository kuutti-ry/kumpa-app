import { AuthExchangeRequest } from "@kuutti/schema";
import { Hono } from "hono";
import type { Deps } from "../app.ts";
import type { Config } from "../lib/config.ts";
import type { AppEnv } from "../lib/env.ts";
import { localisedEnvelope } from "../lib/errors.ts";
import { appErrorUrl, appReturnUrl } from "./codes.ts";

/**
 * The verified links (#36, #184, ADR-074): the two files that make the bank
 * login's return and an invitation's link land in the app instead of a
 * browser tab, and the return's own address. Android App Links verify the
 * package against the release certificate's fingerprint, iOS Universal Links
 * the bundle against the team. Served by the API from configuration
 * (rules/mobile.md), so a new keystore or team is a parameter change, not a
 * native build. Machine callers (Google's and Apple's verifiers), so plain
 * routes with the exact media type each expects and a day of caching.
 */
export const ANDROID_PACKAGE = "fi.kuutti.app";
export const IOS_BUNDLE_ID = "fi.kuutti.app";
/** The https path of the bank login's return, which the app claims on its API's hosts (app.json). */
export const RETURN_PATH = "/auth/return";
/** The one link with a code (rewards/link.ts): the app claims it too, and takes the code itself (ADR-044 §13). */
export const INVITATION_PATHS = "/i/*";

type LinkConfig = Pick<Config, "OIDC_REDIRECT_URI" | "ANDROID_CERT_FINGERPRINTS" | "IOS_TEAM_ID">;

const fingerprintsOf = (config: LinkConfig): string[] =>
  (config.ANDROID_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((f) => f.trim().toUpperCase())
    .filter((f) => f.length > 0);

/**
 * The return's https address for each platform whose file this API serves
 * (ADR-074 §2): on the host of the registered callback, never the request's
 * own. A platform without its parameter has none, and its return uses the
 * scheme, so the parameter is the switch, per platform and per environment.
 * A callback that is not https has none either: no phone verifies such a
 * link, and the code would cross this computer's network in the clear.
 */
export function verifiedReturns(config: LinkConfig): Partial<Record<string, string>> {
  if (!config.OIDC_REDIRECT_URI) return {};
  const callback = new URL(config.OIDC_REDIRECT_URI);
  if (callback.protocol !== "https:") return {};
  const address = new URL(RETURN_PATH, callback).toString();
  return {
    ...(fingerprintsOf(config).length > 0 ? { android: address } : {}),
    ...(config.IOS_TEAM_ID ? { ios: address } : {}),
  };
}

const CACHE = "public, max-age=86400";

export function appLinkRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();
  const fingerprints = fingerprintsOf(deps.config);
  const team = deps.config.IOS_TEAM_ID;

  app.get("/.well-known/assetlinks.json", (c) => {
    if (fingerprints.length === 0) return c.json(localisedEnvelope(c, "not_found"), 404);
    c.header("cache-control", CACHE);
    return c.json(
      [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: ANDROID_PACKAGE,
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ],
      200,
    );
  });

  app.get("/.well-known/apple-app-site-association", (c) => {
    if (!team) return c.json(localisedEnvelope(c, "not_found"), 404);
    c.header("cache-control", CACHE);
    // Apple wants application/json without a charset and no redirect.
    c.header("content-type", "application/json");
    return c.body(
      JSON.stringify({
        applinks: {
          apps: [],
          details: [
            {
              appIDs: [`${team}.${IOS_BUNDLE_ID}`],
              components: [
                { "/": RETURN_PATH, comment: "the bank login's return" },
                { "/": INVITATION_PATHS, comment: "an invitation's link" },
              ],
            },
          ],
        },
      }),
      200,
    );
  });

  // The return the phone did not hand to the app (ADR-074 §3): a build from
  // before the links, a link the system has not verified, a browser that
  // keeps it. The browser goes on to the app's scheme, where the callback
  // sent it before. A machine's door for a browser: no page, nothing looked
  // up or kept, and no JSON left in a tab. Anything but a code of the right
  // shape goes on as the refusal every bad code gets, in the app's words. The
  // request's line names the route, never the code (lib/logger.ts).
  app.get(RETURN_PATH, (c) => {
    c.header("cache-control", "no-store");
    const code = AuthExchangeRequest.shape.code.safeParse(c.req.query("code"));
    return c.redirect(code.success ? appReturnUrl(code.data) : appErrorUrl("auth_code_used"), 302);
  });

  return app;
}
