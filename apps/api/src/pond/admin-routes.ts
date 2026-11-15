import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { transaction } from "@kuutti/db";
import { MatchingSwitchState } from "@kuutti/schema";
import type { MiddlewareHandler } from "hono";
import type { Deps } from "../app.ts";
import { staffOf } from "../lib/admin-middleware.ts";
import type { AppEnv } from "../lib/env.ts";
import { matchingOpen } from "../lib/matching-config.ts";
import { bearer, errorContent, json, staffErrors } from "../lib/openapi.ts";
import { recordAudit } from "../safety/index.ts";
import { turnMatching } from "./repo.ts";

// The switch in the panel (#500, ADR-060 §1, §2): matching opens when an admin
// says so, for the whole country, and nothing else opens or closes it. It is
// one value among matching's own (`matching_open`), with no pond behind it
// (ADR-061 §8, #607). Its versions and the audit rows are the history of when
// it opened and closed; an audit row carries which way and no words, and no
// person is named by it.

const readRoute = createRoute({
  method: "get",
  path: "/admin/matching",
  summary: "Whether matching is open",
  description: "The switch that opens matching, for the whole country. Admins only.",
  ...bearer,
  responses: {
    200: { description: "The switch as it stands.", ...json(MatchingSwitchState) },
    ...staffErrors,
  },
});

const turnRoute = createRoute({
  method: "post",
  path: "/admin/matching",
  summary: "Open or close matching",
  description:
    "Sets the one switch, which stands for the whole country (ADR-061 §8). Open, each complete person reads their queue from their next read, and their matching card says so; closed, nobody new joins a queue, cards already queued stay for the day, and conversations go on (ADR-060, ADR-062). Nothing else turns it. A press that finds the switch as it asks changes nothing and writes nothing. Admins only; written to audit_log.",
  ...bearer,
  request: { body: { required: true, ...json(MatchingSwitchState) } },
  responses: {
    200: { description: "The switch as it now stands.", ...json(MatchingSwitchState) },
    400: errorContent("Validation failed."),
    ...staffErrors,
  },
});

export function pondAdminRoutes(deps: Deps, requireAdministrator: MiddlewareHandler<AppEnv>) {
  const app = new OpenAPIHono<AppEnv>();
  // One path for both: the guard is set once.
  app.use(readRoute.getRoutingPath(), requireAdministrator);

  app.openapi(readRoute, async (c) => c.json({ open: await matchingOpen(deps.db) }, 200));

  app.openapi(turnRoute, async (c) => {
    const staff = staffOf(c);
    const { open } = c.req.valid("json");
    const changed = await transaction(deps.db, async (tx) => {
      const written = await turnMatching(tx, open, staff.identityId);
      if (written === null) return false;
      await recordAudit(tx, {
        actorIdentityId: staff.identityId,
        action: "pond.matching",
        subjectType: "config",
        subjectId: written,
        detail: { open },
      });
      return true;
    });
    if (changed) deps.logger.info({ staffIdentityId: staff.identityId, open }, "pond matching");
    return c.json({ open }, 200);
  });

  return app;
}
