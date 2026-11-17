import { LEGAL_PAGES, legalSitePage } from "@kuutti/i18n";
import { Hono } from "hono";
import type { AppEnv } from "../lib/env.ts";

/**
 * The app's links to the legal texts (#208, ADR-010 §4 and
 * §21): `/legal/terms` and `/legal/privacy` send the browser to the
 * text's page on the website, and the browser keeps the link's fragment, the
 * anchor of the version the app carries (RFC 9110 §10.2.2). Where the texts
 * are published is the API's to know, so it moves with a deploy of the API
 * and never needs a build of the app (the maintainer's word of 08/11/2026).
 * No page, nothing looked up, nothing kept: a redirect to the public site, as
 * `/i` is (rewards/link.ts), not a web surface of the product (rule 8).
 */
export function legalTextRoutes() {
  const app = new Hono<AppEnv>();
  for (const page of LEGAL_PAGES) {
    app.get(`/legal/${page}`, (c) => {
      c.header("cache-control", "no-store");
      return c.redirect(legalSitePage(page), 302);
    });
  }
  return app;
}
