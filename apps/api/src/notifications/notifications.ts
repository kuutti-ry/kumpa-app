import type { Queryable } from "@kuutti/db";
import {
  type ExportedNotifications,
  NOTICES_MAX,
  type Notice,
  type Notices,
  type NotificationChoice,
  NotificationKind,
  type SanctionReason,
} from "@kuutti/schema";
import { AppError, noLiveAccount } from "../lib/errors.ts";
import { announcementTextFor } from "./announcements.ts";
import * as repo from "./repo.ts";

// The notification choices and the notices in the app (#176, ADR-032). A
// choice is the person's switch per kind, on until switched off; nothing is
// sent from here: the senders read the choice (the push of #102, in
// `push.ts`). A notice is what must reach the person even without a push, the
// first of them a moderator's warning (ADR-024 §7), the second an invitation
// of theirs that counted (#107, ADR-044 §9); a moderator's shadow ban told
// to its owner is the sanction's other (#715, ADR-073 §2).

/** Every kind in its order, each on unless the person switched it off. */
export async function choicesOf(db: Queryable, accountId: string): Promise<NotificationChoice[]> {
  const stored = new Map(
    (await repo.listChoices(db, accountId)).map((row) => [row.kind, row.enabled]),
  );
  return NotificationKind.options.map((kind) => ({ kind, enabled: stored.get(kind) ?? true }));
}

/** Switches one kind for the caller; an account erased meanwhile writes nothing (404). */
export async function setChoice(
  deps: { db: Queryable; now: () => Date },
  input: { accountId: string; kind: NotificationKind; enabled: boolean },
): Promise<NotificationChoice[]> {
  if (!(await repo.upsertChoice(deps.db, { ...input, at: deps.now() }))) {
    throw noLiveAccount();
  }
  return choicesOf(deps.db, input.accountId);
}

/**
 * One notice as the contract has it: a warning or a shadow ban with its
 * reason, a counted invitation with what it earned the person, an
 * announcement with its words in the reader's language (ADR-068 §3).
 */
function noticeOf(row: repo.NoticeRow, locale: string): Notice {
  const base = { id: row.id, at: row.at.toISOString(), readAt: row.readAt?.toISOString() ?? null };
  // A sanction's notice holds its sanction (notice_sanction_check), so its reason is there.
  if (row.kind === "warning" || row.kind === "shadow_ban") {
    return { ...base, kind: row.kind, reason: row.reason as SanctionReason };
  }
  if (row.kind === "announcement") {
    // An announcement's notice holds it (notice_announcement_check), and goes with it.
    if (!row.texts) throw new Error(`notice ${row.id}: an announcement's notice without its words`);
    const { text } = announcementTextFor(row.texts, locale);
    return { ...base, kind: row.kind, title: text.title, body: text.body };
  }
  return { ...base, kind: row.kind, reward: { fish: row.fish } };
}

/** The caller's newest notices, an announcement's in `locale`, the request's language. */
export async function noticesOf(
  db: Queryable,
  accountId: string,
  locale: string,
): Promise<Notices> {
  const rows = await repo.listNotices(db, accountId, NOTICES_MAX);
  return { notices: rows.map((row) => noticeOf(row, locale)) };
}

/** Marks one of the caller's notices read; one not theirs is 404. */
export async function readNotice(
  deps: { db: Queryable; now: () => Date },
  input: { accountId: string; noticeId: string },
): Promise<void> {
  if (!(await repo.markRead(deps.db, { ...input, at: deps.now() }))) {
    throw new AppError(404, "not_found", "No such notice");
  }
}

/**
 * A warning and a moderator's shadow ban tell the person in the app (ADR-024
 * §7, ADR-073 §2), in the sanction's transaction; a suspension and a ban end
 * the sessions and are told at the bank login.
 */
export async function recordSanctionNotice(
  db: Queryable,
  input: { accountId: string; kind: "warning" | "shadow_ban"; sanctionId: string; at: Date },
): Promise<void> {
  await repo.insertSanctionNotice(db, input);
}

/** A counted invitation tells its inviter and its friend (ADR-044 §9), in the night's count's transaction. */
export async function recordInvitationNotices(
  db: Queryable,
  input: {
    kind: "invitation_counted" | "invitation_friend";
    counted: ReadonlyArray<{ accountId: string; invitationId: string }>;
    at: Date;
  },
): Promise<void> {
  await repo.insertInvitationNotices(db, input);
}

/** The person's part of the export (ADR-007 §3): the choices as they stand and every notice. */
export async function exportNotifications(
  db: Queryable,
  accountId: string,
): Promise<ExportedNotifications> {
  return {
    choices: await choicesOf(db, accountId),
    notices: (await repo.exportedNotices(db, accountId)).map((row) => ({
      kind: row.kind,
      at: row.at.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
  };
}

/** The person's part of an erasure (ADR-007 §4), in its transaction. */
export async function eraseNotificationsOf(
  db: Queryable,
  accountId: string,
): Promise<{ choices: number; notices: number }> {
  return repo.deleteOf(db, accountId);
}
