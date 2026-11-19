import type { Queryable } from "@kuutti/db";
import type {
  AnnouncementDraft,
  AnnouncementText,
  NoticeKind,
  NotificationKind,
  SanctionKind,
  SanctionReason,
} from "@kuutti/schema";

/** The person keeps announcements to everybody on: no row is on (#573, ADR-068 §5). */
const announcementsOn = (account: string) =>
  `NOT EXISTS (SELECT 1 FROM notification_preference p
                WHERE p.account_id = ${account} AND p.kind = 'announcement' AND NOT p.enabled)`;

/** An address an announcement is mailed to: the account live, its address confirmed, the switch on. */
const MAILED = `a.state <> 'deleted' AND a.email IS NOT NULL AND a.email_confirmed_at IS NOT NULL
  AND ${announcementsOn("a.id")}`;

// The notification choices and the notices (#176, ADR-032). Raw
// parameterised SQL, as in the other slices; every statement names the
// caller's account (rule 6). A warning's notice reads its sanction, the
// safety slice's row, for the reason and whether it was lifted; a counted
// invitation's reads the units it earned, the rewards slice's rows (#107,
// ADR-044 §9): the notice holds nothing of its own.

type Row = Record<string, unknown>;

/** The kinds the person switched, with their state; a kind with no row is on. */
export async function listChoices(
  db: Queryable,
  accountId: string,
): Promise<Array<{ kind: NotificationKind; enabled: boolean }>> {
  const { rows } = await db.query<{ kind: NotificationKind; enabled: boolean }>(
    "SELECT kind, enabled FROM notification_preference WHERE account_id = $1 ORDER BY kind",
    [accountId],
  );
  return rows;
}

/**
 * Sets one kind for a live account; false when the account is erased. The
 * account row is held (FOR SHARE) as every writer holds it, so an erasure
 * under way either finishes first and this writes nothing, or waits for it
 * and deletes what it wrote.
 */
export async function upsertChoice(
  db: Queryable,
  input: { accountId: string; kind: NotificationKind; enabled: boolean; at: Date },
): Promise<boolean> {
  const { rows } = await db.query(
    `INSERT INTO notification_preference (account_id, kind, enabled, updated_at)
     SELECT a.id, $2, $3, $4 FROM account a WHERE a.id = $1 AND a.state <> 'deleted'
     FOR SHARE
     ON CONFLICT (account_id, kind)
       DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [input.accountId, input.kind, input.enabled, input.at],
  );
  return rows.length > 0;
}

/** An announcement's words in its languages (#573, ADR-068 §1): Swedish may be missing. */
export type AnnouncementTexts = {
  en: AnnouncementText;
  fi: AnnouncementText;
  sv: AnnouncementText | null;
};

export type NoticeRow = {
  id: string;
  kind: NoticeKind;
  at: Date;
  readAt: Date | null;
  /** A sanction's, a warning's or a shadow ban's; null for any other kind. */
  reason: SanctionReason | null;
  /** The units a counted invitation earned the person; nought for a warning. */
  fish: number;
  /** An announcement's words; null for any other kind. */
  texts: AnnouncementTexts | null;
};

const ANNOUNCEMENT_TEXT_COLUMNS = "title_en, body_en, title_fi, body_fi, title_sv, body_sv";

/** The words of an announcement's row, read with ANNOUNCEMENT_TEXT_COLUMNS. */
function textsOf(r: Row): AnnouncementTexts {
  return {
    en: { title: r.title_en as string, body: r.body_en as string },
    fi: { title: r.title_fi as string, body: r.body_fi as string },
    sv: r.title_sv === null ? null : { title: r.title_sv as string, body: r.body_sv as string },
  };
}

/**
 * The person's notices, newest first; a sanction lifted since, a warning or a
 * shadow ban, is not one any more, and the filter is a sanction's alone:
 * another kind has none.
 */
export async function listNotices(
  db: Queryable,
  accountId: string,
  limit: number,
): Promise<NoticeRow[]> {
  const { rows } = await db.query<Row>(
    `SELECT n.id, n.kind, n.created_at, n.read_at, s.reason, count(r.id)::int AS fish,
            a.id AS announcement, a.title_en, a.body_en, a.title_fi, a.body_fi, a.title_sv, a.body_sv
       FROM notice n
       LEFT JOIN sanction s ON s.id = n.sanction_id
       LEFT JOIN reward r ON r.invitation_id = n.invitation_id AND r.account_id = n.account_id
       LEFT JOIN announcement a ON a.id = n.announcement_id
      WHERE n.account_id = $1 AND (n.sanction_id IS NULL OR s.lifted_at IS NULL)
      GROUP BY n.id, s.reason, a.id
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT $2`,
    [accountId, limit],
  );
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as NoticeKind,
    at: r.created_at as Date,
    readAt: (r.read_at as Date | null) ?? null,
    reason: (r.reason as SanctionReason | null) ?? null,
    fish: r.fish as number,
    texts: r.announcement === null ? null : textsOf(r),
  }));
}

/** Marks one of the caller's notices read, once; false when it is not theirs. */
export async function markRead(
  db: Queryable,
  input: { accountId: string; noticeId: string; at: Date },
): Promise<boolean> {
  const result = await db.query(
    "UPDATE notice SET read_at = coalesce(read_at, $3) WHERE id = $2 AND account_id = $1",
    [input.accountId, input.noticeId, input.at],
  );
  return (result.rowCount ?? 0) > 0;
}

/** A sanction's notice, a warning's or a shadow ban's, in the sanction's transaction (ADR-073 §2). */
export async function insertSanctionNotice(
  db: Queryable,
  input: { accountId: string; kind: "warning" | "shadow_ban"; sanctionId: string; at: Date },
): Promise<void> {
  await db.query(
    "INSERT INTO notice (account_id, kind, sanction_id, created_at) VALUES ($1, $2, $3, $4)",
    [input.accountId, input.kind, input.sanctionId, input.at],
  );
}

/** Each counted invitation's notice for one of its two, in the night's count's transaction (#107, ADR-044 §7). */
export async function insertInvitationNotices(
  db: Queryable,
  input: {
    kind: "invitation_counted" | "invitation_friend";
    counted: ReadonlyArray<{ accountId: string; invitationId: string }>;
    at: Date;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO notice (account_id, kind, invitation_id, created_at)
     SELECT c.account, $4::notice_kind, c.invitation, $3
       FROM unnest($1::uuid[], $2::uuid[]) AS c(account, invitation)`,
    [
      input.counted.map((c) => c.accountId),
      input.counted.map((c) => c.invitationId),
      input.at,
      input.kind,
    ],
  );
}

/** Everything of the person's here, for the export: every notice, lifted warnings' too. */
export async function exportedNotices(
  db: Queryable,
  accountId: string,
): Promise<Array<{ kind: NoticeKind; at: Date; readAt: Date | null }>> {
  const { rows } = await db.query<Row>(
    `SELECT kind, created_at, read_at FROM notice WHERE account_id = $1
     ORDER BY created_at DESC, id DESC LIMIT 1000`,
    [accountId],
  );
  return rows.map((r) => ({
    kind: r.kind as NoticeKind,
    at: r.created_at as Date,
    readAt: (r.read_at as Date | null) ?? null,
  }));
}

/** Erasure (ADR-007 §4): the person's choices, notices and unsubscribe secret go. */
export async function deleteOf(
  db: Queryable,
  accountId: string,
): Promise<{ choices: number; notices: number }> {
  const notices = await db.query("DELETE FROM notice WHERE account_id = $1", [accountId]);
  const choices = await db.query("DELETE FROM notification_preference WHERE account_id = $1", [
    accountId,
  ]);
  await db.query("DELETE FROM unsubscribe_token WHERE account_id = $1", [accountId]);
  return { choices: choices.rowCount ?? 0, notices: notices.rowCount ?? 0 };
}

/**
 * The account's unsubscribe secret (#196, ADR-068 §5): `fresh` becomes it the
 * first time, and every later call answers the one kept, so the links in
 * older emails keep working. Null when the account is erased; the account row
 * is held as every writer holds it, so an erasure under way either finishes
 * first or deletes what this wrote.
 */
export async function unsubscribeTokenOf(
  db: Queryable,
  accountId: string,
  fresh: string,
): Promise<string | null> {
  const { rows } = await db.query<{ token: string }>(
    `INSERT INTO unsubscribe_token (account_id, token)
     SELECT a.id, $2 FROM account a WHERE a.id = $1 AND a.state <> 'deleted'
     FOR SHARE
     ON CONFLICT (account_id) DO UPDATE SET token = unsubscribe_token.token
     RETURNING token`,
    [accountId, fresh],
  );
  return rows[0]?.token ?? null;
}

/**
 * One click (#196, RFC 8058): the Announcements switch of the account whose
 * secret this is goes off, as Settings would set it; its id, or null when no
 * live account holds the secret. The one statement here not scoped by a
 * session's account, since a mail provider's POST carries nothing but the
 * link (RFC 8058 §3.2): the secret, 256 random bits, is the scope, found by
 * the database's index and never compared in the process.
 */
export async function unsubscribeByToken(
  db: Queryable,
  token: string,
  at: Date,
): Promise<string | null> {
  const { rows } = await db.query<{ account_id: string }>(
    `INSERT INTO notification_preference (account_id, kind, enabled, updated_at)
     SELECT a.id, 'announcement', false, $2
       FROM unsubscribe_token u JOIN account a ON a.id = u.account_id
      WHERE u.token = $1 AND a.state <> 'deleted'
     FOR SHARE OF a
     ON CONFLICT (account_id, kind)
       DO UPDATE SET enabled = false, updated_at = EXCLUDED.updated_at
     RETURNING account_id`,
    [token, at],
  );
  return rows[0]?.account_id ?? null;
}

// Announcements (#573, ADR-068): the panel's rows, and whom one reaches. Every
// account is read here, never one person's data: how many, and the notices
// the approval writes; the address is read one account at a time, only to
// send, and never leaves this file but in the message.

export type AnnouncementRow = {
  id: string;
  texts: AnnouncementTexts;
  writtenBy: string;
  writtenAt: Date;
  approvedAt: Date | null;
};

const ANNOUNCEMENT_COLUMNS = `id, ${ANNOUNCEMENT_TEXT_COLUMNS}, written_by, written_at, approved_at`;

function announcementOf(r: Row): AnnouncementRow {
  return {
    id: r.id as string,
    texts: textsOf(r),
    writtenBy: r.written_by as string,
    writtenAt: r.written_at as Date,
    approvedAt: (r.approved_at as Date | null) ?? null,
  };
}

/** A draft, by the admin who wrote it. */
export async function insertAnnouncement(
  db: Queryable,
  input: { draft: AnnouncementDraft; writtenBy: string; at: Date },
): Promise<AnnouncementRow> {
  const { en, fi, sv } = input.draft;
  const { rows } = await db.query<Row>(
    `INSERT INTO announcement
       (title_en, body_en, title_fi, body_fi, title_sv, body_sv, written_by, written_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${ANNOUNCEMENT_COLUMNS}`,
    [
      en.title,
      en.body,
      fi.title,
      fi.body,
      sv?.title ?? null,
      sv?.body ?? null,
      input.writtenBy,
      input.at,
    ],
  );
  return announcementOf(rows[0] as Row);
}

/** The newest announcements, drafts and sent alike. */
export async function listAnnouncements(db: Queryable, limit: number): Promise<AnnouncementRow[]> {
  const { rows } = await db.query<Row>(
    `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcement ORDER BY written_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(announcementOf);
}

/** One announcement, held against a concurrent approval or deletion; null when there is none. */
export async function lockAnnouncement(db: Queryable, id: string): Promise<AnnouncementRow | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${ANNOUNCEMENT_COLUMNS} FROM announcement WHERE id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0] ? announcementOf(rows[0]) : null;
}

/** A draft goes; a sent announcement is never deleted, which the caller checked under the lock. */
export async function deleteAnnouncement(db: Queryable, id: string): Promise<void> {
  await db.query("DELETE FROM announcement WHERE id = $1 AND approved_at IS NULL", [id]);
}

/**
 * The approval (ADR-068 §2, §3), in one transaction with the row held: the
 * second admin and the time, then a notice for every account not erased.
 * Each account row is held (FOR SHARE) as every writer holds it, so an
 * erasure under way either finishes first and is not told, or waits and
 * deletes the notice with the rest. The number of notices written.
 */
export async function approveAnnouncement(
  db: Queryable,
  input: { id: string; approvedBy: string; at: Date },
): Promise<{ row: AnnouncementRow; notices: number }> {
  const { rows } = await db.query<Row>(
    `UPDATE announcement SET approved_by = $2, approved_at = $3
      WHERE id = $1 AND approved_at IS NULL
      RETURNING ${ANNOUNCEMENT_COLUMNS}`,
    [input.id, input.approvedBy, input.at],
  );
  const row = rows[0];
  if (!row) throw new Error(`approveAnnouncement: ${input.id} is not a draft held by the caller`);
  const written = await db.query(
    `INSERT INTO notice (account_id, kind, announcement_id, created_at)
     SELECT a.id, 'announcement', $1, $2 FROM account a WHERE a.state <> 'deleted'
     FOR SHARE`,
    [input.id, input.at],
  );
  return { row: announcementOf(row), notices: written.rowCount ?? 0 };
}

/** How many an announcement approved now would reach (ADR-068 §2). */
export async function announcementReach(
  db: Queryable,
  at: Date,
): Promise<{ accounts: number; phones: number; addresses: number }> {
  const { rows } = await db.query<{ accounts: number; phones: number; addresses: number }>(
    `SELECT
       (SELECT count(*)::int FROM account WHERE state <> 'deleted') AS accounts,
       (SELECT count(DISTINCT t.account_id)::int FROM push_token t
          JOIN session s ON s.id = t.session_id AND s.account_id = t.account_id
          JOIN account a ON a.id = t.account_id AND a.state <> 'deleted'
         WHERE s.revoked_at IS NULL AND s.expires_at > $1
           AND ${announcementsOn("t.account_id")}) AS phones,
       (SELECT count(*)::int FROM account a
         WHERE ${MAILED}) AS addresses`,
    [at],
  );
  return rows[0] ?? { accounts: 0, phones: 0, addresses: 0 };
}

/** An announcement's words, for its email; null once it is gone. */
export async function announcementTexts(
  db: Queryable,
  id: string,
): Promise<AnnouncementTexts | null> {
  const { rows } = await db.query<Row>(
    `SELECT ${ANNOUNCEMENT_TEXT_COLUMNS} FROM announcement WHERE id = $1`,
    [id],
  );
  return rows[0] ? textsOf(rows[0]) : null;
}

/** Everybody an announcement's notice reached whose notice is still unread: whom its push may tell. */
export async function unreadAnnouncementAccounts(db: Queryable, id: string): Promise<string[]> {
  const { rows } = await db.query<{ account_id: string }>(
    `SELECT n.account_id FROM notice n
       JOIN account a ON a.id = n.account_id AND a.state <> 'deleted'
      WHERE n.announcement_id = $1 AND n.read_at IS NULL
      ORDER BY n.account_id`,
    [id],
  );
  return rows.map((r) => r.account_id);
}

/** Everybody an announcement's notice reached: whom its email may go to. */
export async function announcementAccounts(db: Queryable, id: string): Promise<string[]> {
  const { rows } = await db.query<{ account_id: string }>(
    `SELECT account_id FROM notice WHERE announcement_id = $1 ORDER BY account_id`,
    [id],
  );
  return rows.map((r) => r.account_id);
}

/**
 * The person's confirmed address and the language they read the terms in,
 * read fresh just before the send: null when the account is erased, the
 * address unconfirmed or gone, or the announcements switch off (ADR-068 §5).
 */
export async function announcementMailOf(
  db: Queryable,
  accountId: string,
): Promise<{ address: string; locale: string | null } | null> {
  const { rows } = await db.query<{ email: string; locale: string | null }>(
    `SELECT a.email,
            (SELECT c.locale_shown FROM consent c
              WHERE c.account_id = a.id AND c.kind = 'terms'
              ORDER BY c.given_at DESC LIMIT 1) AS locale
       FROM account a
      WHERE a.id = $1 AND ${MAILED}`,
    [accountId],
  );
  const row = rows[0];
  return row ? { address: row.email, locale: row.locale } : null;
}

/** A sanction's statement as its email needs it (#715, ADR-073 §4). */
export type SanctionMail = {
  address: string;
  /** The language the person read the terms in; null for none recorded. */
  locale: string | null;
  kind: SanctionKind;
  reason: SanctionReason;
  /** A suspension's end: the start of its chosen day in Finland. */
  endsAt: Date | null;
};

/**
 * What a sanction's email says and where it goes, read fresh after the
 * sanction committed (#715, ADR-073 §4): the sanction's own keys, and its
 * account's confirmed address with the language the terms were read in.
 * Null when the sanction is lifted or gone, the account erased, or its
 * address unconfirmed or gone. No switch is read: a decision about the
 * account is told whatever the person turned off. Staff's note is never read.
 */
export async function sanctionMailOf(
  db: Queryable,
  input: { accountId: string; sanctionId: string },
): Promise<SanctionMail | null> {
  const { rows } = await db.query<{
    email: string;
    locale: string | null;
    kind: SanctionKind;
    reason: SanctionReason;
    ends_at: Date | null;
  }>(
    `SELECT a.email, s.kind, s.reason, s.ends_at,
            (SELECT c.locale_shown FROM consent c
              WHERE c.account_id = a.id AND c.kind = 'terms'
              ORDER BY c.given_at DESC LIMIT 1) AS locale
       FROM sanction s
       JOIN account a ON a.id = s.account_id
      WHERE s.id = $1 AND s.account_id = $2 AND s.lifted_at IS NULL
        AND a.state <> 'deleted' AND a.email IS NOT NULL AND a.email_confirmed_at IS NOT NULL`,
    [input.sanctionId, input.accountId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    address: row.email,
    locale: row.locale,
    kind: row.kind,
    reason: row.reason,
    endsAt: row.ends_at,
  };
}
