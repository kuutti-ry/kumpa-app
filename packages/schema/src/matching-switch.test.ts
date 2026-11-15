import { describe, expect, it } from "vitest";
import { MatchingSwitchState } from "./matching-switch.ts";

// The switch in the panel (#500, ADR-060 §2): how it stands, and the press that
// turns it, which says which way and nothing else.

describe("the switch, as it stands and as it is pressed", () => {
  it.each([true, false])("says which way: %s", (open) => {
    expect(MatchingSwitchState.parse({ open })).toEqual({ open });
  });

  it.each([
    ["nothing", {}],
    ["no boolean", { open: "true" }],
    ["a reason, which the audit row has no room for", { open: true, reason: "ready" }],
    ["a pond, of which there is no row (#607)", { open: true, id: "suomi" }],
  ])("refuses %s", (_, input) => {
    expect(MatchingSwitchState.safeParse(input).success).toBe(false);
  });
});
