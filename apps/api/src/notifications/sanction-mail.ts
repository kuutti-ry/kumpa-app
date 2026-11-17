import type { Queryable } from "@kuutti/db";
import { formatDate, type RealLocale, realLocale, sanctionStatement } from "@kuutti/i18n";
import type { SanctionKind } from "@kuutti/schema";
import { errorName } from "../lib/errors.ts";
import { tFor } from "../lib/i18n.ts";
import type { Logger } from "../lib/logger.ts";
import { type Mailer, MailFailed } from "../lib/mail.ts";
import { type SanctionMail, sanctionMailOf } from "./repo.ts";

/** Each kind's subject. */
const SUBJECTS = {
  warn: "mail.sanction.subject.warn",
  shadow_ban: "mail.sanction.subject.shadow_ban",
  suspend: "mail.sanction.subject.suspend",
  ban: "mail.sanction.subject.ban",
} as const satisfies Record<SanctionKind, string>;

/** What the sanction does, in the words the app gives it: the notice's, or the bank login's. */
function whatOf(mail: SanctionMail, t: ReturnType<typeof tFor>, locale: RealLocale): string {
  switch (mail.kind) {
    case "warn":
      return t("notices.warning.body");
    case "shadow_ban":
      return t("notices.shadowBan.body");
    case "suspend":
      // A suspension always has its end, and only a suspension (sanction_ends_at_check).
      return t("signIn.error.auth_suspended_until", {
        date: formatDate(locale, mail.endsAt as Date, { timeZone: "Europe/Helsinki" }),
      });
    case "ban":
      return t("mail.sanction.ban.what");
  }
}

/**
 * A sanction's statement by email (#715, ADR-073 §4): sent once, after the
 * sanction committed, to the account's confirmed address, whatever its
 * switches say, in the language the person read the terms in. The app says
 * the same in its notice or at the bank login. Plain text from messages.yaml
 * that names nobody and carries no link; staff's note never. A failed send
 * is logged by its reason and nothing is retried. Whether it went.
 */
export async function mailSanction(
  deps: { db: Queryable; logger: Logger; mailer: Mailer },
  input: { accountId: string; sanctionId: string },
): Promise<boolean> {
  const mail = await sanctionMailOf(deps.db, input);
  if (!mail) return false;
  const locale = realLocale(mail.locale ?? "en");
  const t = tFor(locale);
  const statement = sanctionStatement(t, mail.reason);
  try {
    await deps.mailer.send({
      to: mail.address,
      subject: t(SUBJECTS[mail.kind]),
      text: [
        whatOf(mail, t, locale),
        ...statement,
        t("mail.sanction.why"),
        t("mail.signature"),
      ].join("\n\n"),
    });
  } catch (error) {
    const reason =
      error instanceof MailFailed
        ? { reason: error.reason, status: error.status }
        : { reason: errorName(error) };
    deps.logger.warn(
      { accountId: input.accountId, kind: mail.kind, ...reason },
      "sanction mail not sent",
    );
    return false;
  }
  deps.logger.info({ accountId: input.accountId, kind: mail.kind }, "sanction mailed");
  return true;
}
