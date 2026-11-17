import { describe, expect, it } from "vitest";
import { createI18n, typedT } from "./index.ts";
import {
  SANCTION_REASON_WORDS,
  type SanctionStatementReason,
  sanctionStatement,
} from "./sanction.ts";

// A sanction's statement in words (#715, ADR-073 §1): the reason the API
// sends, said as the notices, the sign-in screen and the email say it: why,
// the terms' rule, that a moderator decided, and the contest with a second
// look. Only what staff applied is told; a rule's shadow ban never is.

const t = (locale: "en" | "fi" | "sv") => typedT(createI18n({ locale }), locale);
const REASONS = Object.keys(SANCTION_REASON_WORDS) as SanctionStatementReason[];
const CONTEST =
  "If you think we got this wrong, write to hello@kuutti.app. Someone other than the person who decided will look at it again.";

describe("sanctionStatement", () => {
  it("says a moderator's decision: why, the terms' rule, who decided, and the contest with a second look", () => {
    expect(sanctionStatement(t("en"), "harassment")).toEqual([
      "Why: Harassment.",
      "The terms of use, section 4: you must not threaten, harass or pressure anyone, or ask anyone for money.",
      "A moderator decided this.",
      CONTEST,
    ]);
    expect(sanctionStatement(t("fi"), "under_age")).toEqual([
      expect.stringMatching(/^Syy: .+\.$/),
      "Käyttöehdot, kohta 3: sinun on oltava vähintään 18-vuotias.",
      "Tämän päätti moderaattori.",
      expect.stringContaining("hello@kuutti.app"),
    ]);
  });

  it.each(REASONS)("gives the reason %s its own words and its own rule of the terms", (reason) => {
    const [why, ground] = sanctionStatement(t("en"), reason);
    expect(why).toBe(`Why: ${t("en")(SANCTION_REASON_WORDS[reason])}.`);
    expect(ground).toMatch(/^The terms of use, section [346]: /);
    // No two reasons share their words.
    const others = REASONS.filter((r) => r !== reason).map((r) => sanctionStatement(t("en"), r)[0]);
    expect(others).not.toContain(why);
  });

  it.each(["en", "fi", "sv"] as const)(
    "leaves no placeholder unsaid, names the address and no court in %s, for every reason",
    (locale) => {
      const lines = REASONS.flatMap((reason) => sanctionStatement(t(locale), reason));
      for (const line of lines) expect(line).not.toMatch(/[{}]/);
      expect(lines.filter((line) => line.includes("hello@kuutti.app"))).toHaveLength(
        REASONS.length,
      );
      // The court sentence is dropped (the maintainer, 17/11/2026).
      expect(lines.join(" ")).not.toMatch(/court|tuomioistuin|domstol/i);
    },
  );
});
