import type { PlainMessageKey, TFunction } from "./instance.ts";

/**
 * A sanction's statement in words (#715, ADR-073 §1): why, the rule of the
 * terms it rests on, that a moderator decided, and how to contest it. The one
 * place that turns a sanction's reason into these lines, for the notices and
 * the sign-in screen on the phone and for the email on the API, so the three
 * say the same. The API sends a key of the closed list (`SanctionReason` in
 * packages/schema), never a sentence; staff's note is never among them.
 */

/** The reasons, as the schema's closed list (#106). */
export type SanctionStatementReason =
  | "harassment"
  | "misrepresentation"
  | "under_age"
  | "commercial_use"
  | "scraping"
  | "other";

/** A reason in the words the export gives it (ADR-024 §8). */
export const SANCTION_REASON_WORDS: Record<SanctionStatementReason, PlainMessageKey> = {
  harassment: "account.export.sanction.reason.harassment",
  misrepresentation: "account.export.sanction.reason.misrepresentation",
  under_age: "account.export.sanction.reason.under_age",
  commercial_use: "account.export.sanction.reason.commercial_use",
  scraping: "account.export.sanction.reason.scraping",
  other: "account.export.sanction.reason.other",
};

/** The rule of the terms each reason rests on. */
const GROUNDS: Record<SanctionStatementReason, PlainMessageKey> = {
  harassment: "sanction.statement.ground.harassment",
  misrepresentation: "sanction.statement.ground.misrepresentation",
  under_age: "sanction.statement.ground.under_age",
  commercial_use: "sanction.statement.ground.commercial_use",
  scraping: "sanction.statement.ground.scraping",
  other: "sanction.statement.ground.other",
};

/**
 * The statement's paragraphs, after what the sanction does: its reason, the
 * terms' rule it rests on, that a moderator decided, and how to contest it:
 * to Kuutti ry's address, where somebody other than who decided looks again
 * (ADR-024 §3). Only what staff applied is told; an automatic rule's shadow
 * ban tells nobody (ADR-033).
 */
export function sanctionStatement(t: TFunction, reason: SanctionStatementReason): string[] {
  return [
    t("sanction.statement.why", { reason: t(SANCTION_REASON_WORDS[reason]) }),
    t(GROUNDS[reason]),
    t("sanction.statement.moderator"),
    t("sanction.statement.contest"),
  ];
}
