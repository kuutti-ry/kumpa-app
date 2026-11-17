import { describe, expect, it } from "vitest";
import { createI18n, typedT } from "./index.ts";
import {
  SANCTION_REASON_WORDS,
  type SanctionStatementKeys,
  sanctionStatement,
} from "./sanction.ts";

// A sanction's statement in words (#715, ADR-073 §1): the keys the API sends,
// said as the notices, the sign-in screen and the email say them. A person's
// decision gives why, the terms' rule, that a moderator decided and the
// contest with a second look; a rule's gives what it saw, the terms' section
// on automatic rules, the look to come or the look had, and its contest.

const t = (locale: "en" | "fi" | "sv") => typedT(createI18n({ locale }), locale);
const REASONS = Object.keys(SANCTION_REASON_WORDS) as SanctionStatementKeys["reason"][];
const RULES = [
  "reports",
  "first_messages",
  "same_first_message",
  "photo_fetches",
  "cards_served",
  "round_reads",
] as const;
const moderator = (reason: SanctionStatementKeys["reason"]): SanctionStatementKeys => ({
  reason,
  rule: null,
  reviewed: false,
  reviewHours: 0,
});
const CONTEST =
  "If you think we got this wrong, write to hello@kuutti.app. Someone other than the person who decided will look at it again. You can also take the matter to a court.";

describe("sanctionStatement", () => {
  it("says a moderator's decision: why, the terms' rule, who decided, and the contest with a second look", () => {
    expect(sanctionStatement(t("en"), moderator("harassment"))).toEqual([
      "Why: Harassment.",
      "The terms of use, section 4: you must not threaten, harass or pressure anyone, or ask anyone for money.",
      "A moderator decided this.",
      CONTEST,
    ]);
    expect(sanctionStatement(t("fi"), moderator("under_age"))).toEqual([
      expect.stringMatching(/^Syy: .+\.$/),
      "Käyttöehdot, kohta 3: sinun on oltava vähintään 18-vuotias.",
      "Tämän päätti moderaattori.",
      expect.stringContaining("hello@kuutti.app"),
    ]);
  });

  it.each(REASONS)("gives the reason %s its own words and its own rule of the terms", (reason) => {
    const [why, ground] = sanctionStatement(t("en"), moderator(reason));
    expect(why).toBe(`Why: ${t("en")(SANCTION_REASON_WORDS[reason])}.`);
    expect(ground).toMatch(/^The terms of use, section [346]: /);
    // No two reasons share their words.
    const others = REASONS.filter((r) => r !== reason).map(
      (r) => sanctionStatement(t("en"), moderator(r))[0],
    );
    expect(others).not.toContain(why);
  });

  it("says what a rule saw and the look to come, in the plural the hours need, and the contest without a second look", () => {
    const rule = { reason: "other", rule: "reports", reviewed: false } as const;
    expect(sanctionStatement(t("en"), { ...rule, reviewHours: 48 })).toEqual([
      "An automatic rule did this: many people reported you in a short time.",
      "The terms of use, section 6: automatic rules can limit what others see of an account until a moderator has looked at it.",
      "A moderator will look at it within 48 hours.",
      "If you think we got this wrong, write to hello@kuutti.app. You can also take the matter to a court.",
    ]);
    expect(sanctionStatement(t("en"), { ...rule, reviewHours: 1 })[2]).toBe(
      "A moderator will look at it within 1 hour.",
    );
    // Never the reason's own words: the rule says more than `other` or `scraping` would.
    expect(sanctionStatement(t("en"), { ...rule, reviewHours: 48 }).join(" ")).not.toContain(
      "Why:",
    );
  });

  it("says a rule's shadow ban a moderator has kept, with the contest a second look allows", () => {
    expect(
      sanctionStatement(t("en"), {
        reason: "scraping",
        rule: "photo_fetches",
        reviewed: true,
        reviewHours: 48,
      }).slice(2),
    ).toEqual(["A moderator has since looked at it and kept it in place.", CONTEST]);
  });

  it.each(RULES)("names what the rule %s saw, and never a number", (rule) => {
    const [saw] = sanctionStatement(t("en"), {
      reason: "other",
      rule,
      reviewed: false,
      reviewHours: 48,
    });
    expect(saw).toMatch(/^An automatic rule did this: /);
    expect(saw).not.toMatch(/\d/);
  });

  it.each(["en", "fi", "sv"] as const)(
    "leaves no placeholder unsaid and names the address in %s, for every reason and rule",
    (locale) => {
      const lines = [
        ...REASONS.flatMap((reason) => sanctionStatement(t(locale), moderator(reason))),
        ...RULES.flatMap((rule) =>
          [false, true].flatMap((reviewed) =>
            sanctionStatement(t(locale), { reason: "other", rule, reviewed, reviewHours: 48 }),
          ),
        ),
      ];
      for (const line of lines) expect(line).not.toMatch(/[{}]/);
      expect(lines.filter((line) => line.includes("hello@kuutti.app"))).toHaveLength(
        REASONS.length + RULES.length * 2,
      );
    },
  );
});
