import type { PlainMessageKey, TFunction } from "./instance.ts";

/**
 * A sanction's statement in words (#715, ADR-073 §1): why, the rule of the
 * terms it rests on, whether a person or an automatic rule decided, and how
 * to contest it. The one place that turns a sanction's keys into these
 * lines, for the notices and the sign-in screen on the phone and for the
 * email on the API, so the three say the same. The API sends keys of the
 * closed lists (`SanctionReason`, `SanctionRule` in packages/schema), never
 * a sentence; staff's note is never among them.
 */

/** The reasons, as the schema's closed list (#106). */
type Reason =
  | "harassment"
  | "misrepresentation"
  | "under_age"
  | "commercial_use"
  | "scraping"
  | "other";

/** The automatic rules (#105, ADR-033; #86, ADR-041), as the schema's closed list. */
type Rule =
  | "reports"
  | "first_messages"
  | "same_first_message"
  | "photo_fetches"
  | "cards_served"
  | "round_reads";

/** What the statement says of a sanction: keys, never words. */
export type SanctionStatementKeys = {
  reason: Reason;
  /** The rule that applied it; null for what a person decided. */
  rule: Rule | null;
  /** Whether a moderator has looked at an automatic one since and kept it. */
  reviewed: boolean;
  /** How many hours a moderator's look at an automatic one should take (`auto_shadow_ban_review_hours`). */
  reviewHours: number;
};

/** A reason in the words the export gives it (ADR-024 §8). */
export const SANCTION_REASON_WORDS: Record<Reason, PlainMessageKey> = {
  harassment: "account.export.sanction.reason.harassment",
  misrepresentation: "account.export.sanction.reason.misrepresentation",
  under_age: "account.export.sanction.reason.under_age",
  commercial_use: "account.export.sanction.reason.commercial_use",
  scraping: "account.export.sanction.reason.scraping",
  other: "account.export.sanction.reason.other",
};

/** The rule of the terms each reason rests on. */
const GROUNDS: Record<Reason, PlainMessageKey> = {
  harassment: "sanction.statement.ground.harassment",
  misrepresentation: "sanction.statement.ground.misrepresentation",
  under_age: "sanction.statement.ground.under_age",
  commercial_use: "sanction.statement.ground.commercial_use",
  scraping: "sanction.statement.ground.scraping",
  other: "sanction.statement.ground.other",
};

/** What each automatic rule saw, never its threshold or whom it counted. */
const RULES: Record<Rule, PlainMessageKey> = {
  reports: "sanction.statement.rule.reports",
  first_messages: "sanction.statement.rule.first_messages",
  same_first_message: "sanction.statement.rule.same_first_message",
  photo_fetches: "sanction.statement.rule.photo_fetches",
  cards_served: "sanction.statement.rule.cards_served",
  round_reads: "sanction.statement.rule.round_reads",
};

/**
 * The statement's paragraphs, after what the sanction does. A person's
 * decision says its reason, the terms' rule and that a moderator decided;
 * an automatic one says what the rule saw and the terms' section on
 * automatic rules (its reason, `other` or `scraping`, says less than the
 * rule does), then when a moderator will look, or that one has and kept it.
 * The last line is how to contest it: to Kuutti ry's address, where
 * somebody other than who decided looks again (ADR-024 §3), and a court.
 */
export function sanctionStatement(t: TFunction, keys: SanctionStatementKeys): string[] {
  if (keys.rule === null) {
    return [
      t("sanction.statement.why", { reason: t(SANCTION_REASON_WORDS[keys.reason]) }),
      t(GROUNDS[keys.reason]),
      t("sanction.statement.moderator"),
      t("sanction.statement.contest"),
    ];
  }
  return [
    t(RULES[keys.rule]),
    t("sanction.statement.ruleGround"),
    keys.reviewed
      ? t("sanction.statement.reviewed")
      : t("sanction.statement.review", { hours: keys.reviewHours }),
    t(keys.reviewed ? "sanction.statement.contest" : "sanction.statement.contestAutomatic"),
  ];
}
