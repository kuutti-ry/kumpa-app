# Phase 3: tooling

One thing was done (#673, `f220fc87`). No tool was removed or cut down, and none of their tests was removed.

- **The demo reset's copied step.** `apps/api/scripts/demo-reset.ts` wrote the stories' conversations and the photos sent in them twice, once for this computer and once for staging, the two differing only in the store handed in. It is one function now, as the recount beside it already was.
