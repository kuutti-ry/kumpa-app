import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import * as Sentry from "@sentry/node";
import { Hono } from "hono";
import { afterAll, describe, expect, it } from "vitest";
import { captureLogger } from "../test/harness.ts";
import { onError } from "./errors.ts";
import { sentryOptions, sentryReporter } from "./sentry.ts";

/**
 * The real SDK with its default integrations, as boot starts it, and a real
 * server on this computer's loopback: what an unhandled error sends is what
 * the transport is handed, and nothing leaves. The SDK's Http integration
 * names the event after the raw path from Node's own channel, whatever
 * runtime injection says, and a path can carry a secret (#196's unsubscribe
 * link, an invitation's code), so this is held on a live request rather than
 * a built event.
 */
const sent: unknown[] = [];
Sentry.init({
  ...sentryOptions({
    SENTRY_DSN: "https://k@o1.ingest.de.sentry.io/2",
    APP_ENV: "test",
    APP_VERSION: "0.0.0",
    GIT_COMMIT: "abc1234",
  }),
  transport: () => ({
    send: async (envelope) => {
      sent.push(envelope);
      return {};
    },
    flush: async () => true,
  }),
});

afterAll(async () => {
  await Sentry.close(0);
});

/** An event item of the envelopes the transport was handed. */
function events(): Record<string, unknown>[] {
  return (sent as [unknown, [{ type: string }, Record<string, unknown>][]][]).flatMap(([, items]) =>
    items.filter(([header]) => header.type === "event").map(([, item]) => item),
  );
}

describe("an unhandled error on a route whose path carries a secret", () => {
  it("reaches Sentry with the route's pattern, and nothing of the path", async () => {
    // Built, not written: the event quotes the source lines around the throw.
    const secret = Buffer.alloc(32, 0xfb).toString("base64url");
    const { logger } = await captureLogger();
    const app = new Hono();
    app.onError(onError(logger, sentryReporter()));
    app.post("/mail/unsubscribe/:token", () => {
      throw new Error("connection terminated unexpectedly");
    });
    const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" });
    await new Promise<void>((up) => server.once("listening", () => up()));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/mail/unsubscribe/${secret}?why=${secret}`, {
        method: "POST",
      });
      expect(res.status).toBe(500);
      await Sentry.flush(2000);
    } finally {
      await new Promise((down) => server.close(down));
    }

    const [event, ...others] = events();
    expect(others).toEqual([]);
    expect(event?.tags).toMatchObject({ route: "/mail/unsubscribe/:token" });
    expect(event?.transaction).toBeUndefined();
    expect(event?.request).toBeUndefined();
    expect(JSON.stringify(sent)).not.toContain(secret);
  });
});
