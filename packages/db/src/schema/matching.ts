import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { account } from "./identity.ts";

/**
 * Why a candidate is in a queue (TD-12), the label every card carries:
 * matches every filter, liked you, seen before, there because the person
 * relaxed a filter (#99), or sent them a fish (#378). A closed list, mirrored
 * in packages/schema.
 */
export const queueReason = pgEnum("queue_reason", [
  "matches_filters",
  "liked_you",
  "seen_before",
  "relaxed",
  // #378 (ADR-039): the card of somebody whose fish waits on the person, ahead of every like.
  "fish",
]);

/**
 * What a person did with a card; undecided is no value, and a card shown and
 * left undecided on an ended day reads as a skip (ADR-062 §3). A skip spends
 * nothing, starts no clock and answers no like.
 */
export const queueDecision = pgEnum("queue_decision", ["like", "pass", "skip"]);

/**
 * The part of a card a like names (#463, ADR-077): a photo by its id, an
 * answered prompt by its key, the bio, or a "you too" item by its field and
 * option. A reference, never a copy of anybody's words. A closed list, mirrored
 * in packages/schema.
 */
export const likeAnchorKind = pgEnum("like_anchor_kind", ["photo", "prompt", "bio", "shared"]);

/** How far a card's person lives (ADR-061 §5); never kilometres. A closed list, mirrored in packages/schema. */
export const distanceBand = pgEnum("distance_band", ["nearby", "close", "around", "far"]);

/**
 * A queue day (TD-11, #96, ADR-034, ADR-062 §1): the log of one person's queue
 * on one Finnish calendar day, begun by the day's first read and filled ten
 * people at a time. One per account and day; `started_at` is when it began. The
 * night deletes queue days past a year (ADR-062 §13), and erasure deletes the
 * person's queue days, their entries with them; the account itself is a
 * tombstone and never deleted.
 */
export const queueDay = pgTable(
  "queue_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    day: date("day", { mode: "string" }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    // The highest place the queue ever gave (#99, ADR-042 §5): a place an undo or an erasure freed is never given again.
    lastPosition: smallint("last_position").notNull().default(0),
  },
  (table) => [uniqueIndex("queue_day_account_day_idx").on(table.accountId, table.day)],
);

/**
 * One candidate in a queue day, at its place (from 1), with why they are there,
 * when the phone reported the card seen, and the person's decision, which
 * may change until the day ends (the maintainer, 19/10/2026). Seen means
 * displayed or decided: an entry queued and never displayed is nothing, and
 * goes at the owner's next day (ADR-062 §2). Addressed by its queue day and
 * its position, never by its id. Erasure deletes the entries in which a person
 * is the candidate, and the person's own go with their queue days.
 */
export const queueEntry = pgTable(
  "queue_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queueDayId: uuid("queue_day_id")
      .notNull()
      .references(() => queueDay.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => account.id),
    reason: queueReason("reason").notNull(),
    seenAt: timestamp("seen_at", { withTimezone: true }),
    decision: queueDecision("decision"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    // A fish (#378, ADR-039) is a like with a mark: every reader of a like reads it as one.
    fish: boolean("fish").notNull().default(false),
    // A pass with an earlier pass behind it (ADR-062 §6): the year's clock reads
    // this alone, since the first pass's entry may be pruned before the year ends.
    secondPass: boolean("second_pass").notNull().default(false),
    // The deal-breaker a relaxed card came in by, its label (#99, ADR-042 §5 and §9).
    relaxedField: text("relaxed_field"),
    // Every relaxation of the day it came in under, the tapped one first: undoing any takes it back, and a like on it waives them all (§6, §7).
    relaxedWith: text("relaxed_with").array().notNull().default(sql`'{}'::text[]`),
    // The band between the two homes when the entry was written (ADR-061 §5,
    // ADR-062 §8), read by the card's line. Null on an entry from before #514.
    distance: distanceBand("distance"),
    // The part of the card a like names (#463, ADR-077): `anchor_ref` is the
    // photo's id, the prompt's key or the option, none for the bio, and
    // `anchor_field` the field of a "you too" item. Checked against the card
    // built for the place when written, and drawn from the profile at each read.
    anchorKind: likeAnchorKind("anchor_kind"),
    anchorRef: text("anchor_ref"),
    anchorField: text("anchor_field"),
  },
  (table) => [
    // One card per place: the read's order, the cascade, and #98's count of the day's likes.
    uniqueIndex("queue_entry_day_position_idx").on(table.queueDayId, table.position),
    // A candidate's entries: the likes waiting on a person and the inbox stop's
    // count (ADR-062 §4), and never twice in one day (#99).
    uniqueIndex("queue_entry_candidate_day_idx").on(table.candidateId, table.queueDayId),
    check("queue_entry_position_check", sql`${table.position} >= 1`),
    check(
      "queue_entry_decided_check",
      sql`(${table.decision} IS NULL) = (${table.decidedAt} IS NULL)`,
    ),
    check("queue_entry_fish_check", sql`NOT ${table.fish} OR ${table.decision} = 'like'`),
    check(
      "queue_entry_second_pass_check",
      sql`NOT ${table.secondPass} OR ${table.decision} = 'pass'`,
    ),
    // Only a like names a part, a fish too (ADR-039 §1).
    check(
      "queue_entry_anchor_check",
      sql`${table.anchorKind} IS NULL OR ${table.decision} = 'like'`,
    ),
    check(
      "queue_entry_anchor_ref_check",
      sql`(${table.anchorKind} IS NULL OR ${table.anchorKind} = 'bio') = (${table.anchorRef} IS NULL)
          AND (${table.anchorKind} IS NOT DISTINCT FROM 'shared') = (${table.anchorField} IS NOT NULL)`,
    ),
    check(
      "queue_entry_relaxed_check",
      sql`(${table.reason} = 'relaxed') = (${table.relaxedField} IS NOT NULL)
          AND (${table.relaxedField} IS NULL OR ${table.relaxedField} = ANY(${table.relaxedWith}))`,
    ),
  ],
);

/**
 * A star (#575, ADR-064): one person's private mark on another, to come back to
 * later without a like or a pass. Starred or not, with no degrees: one per pair.
 * Nothing reads it but the person's own list and queue, so it never reaches the
 * starred person and feeds no order, count or event. No clock: it goes when the
 * person clears it, likes or passes, and when either person is erased.
 */
export const star = pgTable(
  "star",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => account.id),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => account.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One per pair, and the person's own list.
    uniqueIndex("star_account_candidate_idx").on(table.accountId, table.candidateId),
    // Erasure of the person starred.
    index("star_candidate_idx").on(table.candidateId),
    check("star_not_oneself_check", sql`${table.accountId} <> ${table.candidateId}`),
  ],
);

/**
 * How a person loosened one of their own deal-breakers for the day (#99,
 * ADR-042 §3): let through those who did not answer its field, or set it
 * aside. Never another filter.
 */
export const relaxationKind = pgEnum("relaxation_kind", ["unanswered", "aside"]);

/**
 * A deal-breaker relaxed for one day (#99, ADR-042 §3): it hangs on the queue
 * day, so tomorrow's is built from the filters as stored, and goes with it
 * (erasure, the queue's retention). One per field and day; undoing it
 * deletes the row.
 */
export const queueRelaxation = pgTable(
  "queue_relaxation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    queueDayId: uuid("queue_day_id")
      .notNull()
      .references(() => queueDay.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    kind: relaxationKind("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("queue_relaxation_day_field_idx").on(table.queueDayId, table.field)],
);
