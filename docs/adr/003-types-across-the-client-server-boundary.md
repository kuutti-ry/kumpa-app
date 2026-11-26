# ADR-003: Types across the client-server boundary

- Status: accepted, amended 2026-11-26 (the phone app leaves out a key of an answer that it does not know, #745; see History)
- Date: 2026-09-13
- Follows: TD-2 (Hono, zod contracts), TD-19 (open decision on RPC style), ADR-002

## Context

REST as the wire format is settled: machine callers (the Telia redirect, SNS bounce notifications) need plain HTTP endpoints, path-based rate limiting and velocity detection are central to the anti-scraping design, and an AGPL repository benefits from a documented API. The open question was how the mobile app and the admin panel get types for that API without drift.

Three ways were on the table:

1. **Inferred**: Hono's `hc<typeof app>()` client. Best ergonomics, zero build step. The type of the whole app is inferred from every route, and the cost of that inference lands on the client's TypeScript project. With dozens of routes and zod contracts, the mobile typecheck slows down and editor feedback degrades; the failure mode is a codebase people stop typechecking.
2. **Generated**: routes declared with `@hono/zod-openapi`, an OpenAPI document produced from them, and `openapi-typescript` turning it into a `paths` type the clients consume through `openapi-fetch`. One build step, a committed document, no inference cliff.
3. **Declared**: shared zod schemas plus a hand-written client. About two hundred lines of boilerplate, no risk, and a client that drifts the day someone adds a route without touching it.

## Decision

**Generated.** Routes are declared with `createRoute` from `@hono/zod-openapi`, using the zod schemas from `packages/schema` as the request and response contracts. `pnpm openapi` writes `apps/api/openapi.json` from the running app and regenerates `packages/schema/src/api.generated.ts`. Clients use `openapi-fetch` typed by those paths, and parse responses with the same zod schema at runtime where the value matters.

Both files are committed. CI runs the generator and fails on a diff, so the document can only change together with the routes that define it. The document is served at `/openapi.json` in every environment except production, where the API surface is not advertised.

Validation and typing meet in one place: the contract that validates a request at the boundary is the same object that describes it to clients. There is no second schema to keep in step.

The phone app reads every answer through `readAnswer` or `readAnswerSafely` (`apps/mobile/src/lib/answer.ts`), never through a contract's own `parse` (2026-11-26, #745). A build on a phone is older than the API it talks to, so a key the API has added since is one the build does not know: the reader leaves it out, at any depth, and anything else outside the contract fails as the contract's `parse` says. The contracts are unchanged and the API's own tests read its answers with them, so there a key that a `.strict()` contract does not declare still fails.

## Consequences

- Adding a route means declaring it with `createRoute`; a plain `app.get` still works for internal endpoints but appears in no client type and no document.
- The generated types file is large and boring; nobody edits it. The generator header says so.
- `openapi-fetch` treats every non-2xx response as `error`, typed by the declared error responses. The one error envelope (`ErrorResponse`) is therefore what clients handle, with `requestId` for support.
- The document doubles as the public API reference for the repository.
- A field added to an answer breaks no installed build (since 2026-11-26), as long as it changes nothing about the fields beside it: a build that does not know it reads the rest as it always has, so a field that changes what another means (a pond beside the counter's number, until #607) is a new shape. Everything else still breaks one: a field removed or renamed, a value of another type, a new value of an enum, a new kind of frame. For those the API answers in the old shape until the builds that read it are gone, or answers the new shape only to a build that asks for it, as #746 did with a card decision's `later`.

## Alternatives considered

**`hc<typeof app>`** rejected for the inference cost described above; it stays a fine choice for small internal apps.

**Hand-written client** rejected because drift is silent: nothing fails when a route and the client disagree until a user hits it.

**tRPC** never entered the shortlist: it replaces the wire format, and REST is settled.

## History

- 2026-11-26 (#745; the maintainer's choice that day in chat, from the four things #745 left open): the phone app became a tolerant reader. The store builds of 0.127.0 run JavaScript built before #734, which added `later` to a card decision's answer, and their strict contract threw on that key after the API had already recorded the decision: every Like, Pass and Later said that it had not gone through. #746 answered such a build in its old shape. Since this change, a key the build does not know is left out instead, and a test of the app's own code fails on any contract's `parse` outside the tests. Not chosen, and still open on #745: a CI check that holds `main`'s answers to the newest store build's contract, and a rule against merging changes to what the app reads while a store reviews a build. The panel is left as it was, since it is deployed with the API, and the API itself is unchanged.
