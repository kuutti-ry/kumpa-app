import { type Queryable, transaction } from "@kuutti/db";
import {
  type DealBreaker,
  type DealBreakerField,
  type DistanceBand,
  type Later,
  type ProfileCard,
  QUEUE_PAGE,
  QUEUE_POSITION_MAX,
  type QueueChoice,
  type QueueDecision,
  type QueueEntry,
  type QueueReason,
  type QueueResponse,
  type Relaxation,
  type RelaxationOffer,
  type RelaxationsResponse,
} from "@kuutti/schema";
import { AppError } from "../lib/errors.ts";
import { addDays, DAY_MS, finnishDay } from "../lib/finnish-day.ts";
import type { Logger } from "../lib/logger.ts";
import { matchingConfigNumber } from "../lib/matching-config.ts";
import { dayWindow, secondsUntil } from "../media/index.ts";
import { earnedFishWaiting, entriesPaidBy, releaseEarned, spendEarned } from "../rewards/index.ts";

// The queue and the day's log of it, the queue (#96, #502, TD-11, TD-12,
// ADR-034, ADR-062): what one person goes through on one Finnish calendar day,
// each card with why it is there, when the phone reported it seen, and the
// person's own decision, which may change until the day ends (the maintainer,
// 19/10/2026). Every statement names the caller's own queue (rule 6), and every
// one that writes asks, in itself, that the candidate is still live and that no
// block stands between the two (ADR-030 §2): a block that commits meanwhile
// leaves nothing written. Raw parameterised SQL through Queryable, as the other
// slices: the queue row's lock, the stored decision and the predicate all sit
// in the statements that write.

export type QueueDeps = { db: Queryable; logger: Logger; now: () => Date };

/** The card a person may be shown of another, or null where none may be: the profile slice's builder, handed in by app.ts. */
export type CardOf = (
  viewerAccountId: string,
  subjectAccountId: string,
) => Promise<ProfileCard | null>;

/**
 * What the queue reads across slices, the queue's builder's (#95, #502, ADR-062),
 * which lives with the jobs, handed in by app.ts. `fill` adds the next people
 * to the day's log, opening it when the person's matching is open, and says
 * whether it added anybody. `fits` says which of these people are in each
 * other's pool with the person now, both ways (§8), in the caller's
 * transaction when there is one. `later` puts a Later's person on the list
 * (#681, the stars' `putOnLaterList`), in `decide`'s transaction, under its
 * locks, after the skip is written.
 */
export type Queue = {
  fill: (accountId: string) => Promise<boolean>;
  fits: (
    db: Queryable,
    accountId: string,
    candidateIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
  later: (
    tx: Queryable,
    input: { accountId: string; candidateId: string; at: Date },
  ) => Promise<Later>;
};

/**
 * What the chat slice keeps of a match (#100, ADR-031: the conversation is
 * its record), handed in by app.ts as the card builder is: the conversation two
 * people can write in, or one they opened since `since` (ADR-062 §7), the
 * opening of one in the caller's transaction, and how many conversations are
 * on a person's turn (§5).
 */
export type Matches = {
  between: (
    db: Queryable,
    accountId: string,
    otherAccountId: string,
    since: Date,
  ) => Promise<string | null>;
  open: (tx: Queryable, input: { first: string; second: string; at: Date }) => Promise<string>;
  yourTurn: (db: Queryable, accountId: string) => Promise<number>;
  /**
   * After a match committed: the push to the person whose earlier like it met
   * (#102, ADR-055 §5), the notifications slice's, handed in by app.ts. It
   * runs after the answer and changes nothing in it, its timing included.
   */
  made?: (input: { accountId: string }) => void;
};

/**
 * Two people's decisions about each other are taken one pair at a time
 * (#100, ADR-038): the second like reads the first, committed, and a like
 * is never taken back while another makes a match of it. A transaction-scoped
 * advisory lock on the pair, the same whichever of the two decides; taken
 * after the decider's queue lock, never before, so no two wait for each
 * other. Two pairs whose keys collide wait for each other a moment, no more.
 */
const PAIR_LOCK = `SELECT pg_advisory_xact_lock(
  hashtextextended(least($1::text, $2::text) || greatest($1::text, $2::text), 100))`;

const LIKE_EXPIRY_KEY = "like_expiry_days";

/** Conversations on a person's turn at which they can make no new match (ADR-062 §5); 0 is off. */
const YOUR_TURN_LIMIT_KEY = "your_turn_limit";

/** How many times one read goes on past an empty page: what was added fits as it is written, so a second empty page is a card refused meanwhile, and more would be a loop. */
const FILL_TRIES = 3;

/** An entry `e` of queue `r` whose candidate can still be shown to the queue's owner. */
export const SERVABLE = `EXISTS (SELECT 1 FROM account c WHERE c.id = e.candidate_id AND c.state = 'active')
  AND NOT blocked_between(r.account_id, e.candidate_id)`;

/**
 * The highest place a queue `r` ever gave: `last_position`, or the highest entry
 * of a queue written before it was kept. A place an undo freed stays given
 * (ADR-042 §5).
 */
const PLACES = `greatest(r.last_position,
           coalesce((SELECT max(e.position) FROM queue_entry e WHERE e.queue_day_id = r.id), 0))::int`;

export const notFound = () => new AppError(404, "not_found", "No such card in today's queue");

/** The queue's owner's own star on an entry `e`'s person, for `entriesOf` (#575, ADR-064). */
const STAR_OF_ENTRY = `(SELECT s.id FROM star s
      WHERE s.account_id = r.account_id AND s.candidate_id = e.candidate_id) AS star`;

/** An entry `e` of a queue `r` as `EntryRow` reads it, its owner's star included. */
export const ENTRY_COLUMNS = `e.position, e.candidate_id, e.reason, e.decision, e.fish, e.relaxed_field, e.distance,
            ${STAR_OF_ENTRY}`;

/**
 * Today's card at `position`, locked as a decision takes it. The two accounts
 * first, shared and in id order, before any row of a queue: erasure and a
 * sanction take an account FOR UPDATE before they touch queue days or
 * conversations, so one under way finishes before this decision reads, and
 * one that comes later waits for it to commit; an erasure or a ban then
 * closes the match it opened, and a warning, a shadow ban or a suspension
 * leaves it as it leaves every conversation (ADR-024, ADR-031 §2). Taken
 * after the queue, they deadlocked with an erasure, and a sanction could slip
 * a match past its own check (ADR-038 §2). Then the queue's row. `notFound`
 * when the card or the queue is not there.
 */
export async function lockCard(
  tx: Queryable,
  input: { accountId: string; today: string; position: number },
): Promise<{ candidateId: string; queueDayId: string }> {
  const card = await tx.query<{ candidate_id: string }>(
    `SELECT e.candidate_id FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
        WHERE r.account_id = $1 AND r.day = $2 AND e.position = $3`,
    [input.accountId, input.today, input.position],
  );
  const candidateId = card.rows[0]?.candidate_id;
  if (!candidateId) throw notFound();
  await tx.query("SELECT 1 FROM account WHERE id = ANY($1::uuid[]) ORDER BY id FOR SHARE", [
    [input.accountId, candidateId],
  ]);
  const day = await tx.query<{ id: string }>(
    "SELECT id FROM queue_day WHERE account_id = $1 AND day = $2 FOR UPDATE",
    [input.accountId, input.today],
  );
  const queueDayId = day.rows[0]?.id;
  if (!queueDayId) throw notFound();
  return { candidateId, queueDayId };
}

/** The day's places now end at `last`: what was added is still to decide. */
async function givePlaces(
  tx: Queryable,
  queueDayId: string,
  accountId: string,
  last: number,
): Promise<void> {
  await tx.query("UPDATE queue_day SET last_position = $3 WHERE id = $1 AND account_id = $2", [
    queueDayId,
    accountId,
    last,
  ]);
}

/** Today's queue of the person, locked for a change of its relaxations, its owner's account held first; `noQueueDay` when there is none. */
async function lockQueueDayToday(tx: Queryable, accountId: string, today: string): Promise<string> {
  await tx.query("SELECT 1 FROM account WHERE id = $1 FOR SHARE", [accountId]);
  const day = await tx.query<{ id: string }>(
    "SELECT id FROM queue_day WHERE account_id = $1 AND day = $2 FOR UPDATE",
    [accountId, today],
  );
  const queueDayId = day.rows[0]?.id;
  if (!queueDayId) throw noQueueDay();
  return queueDayId;
}

/**
 * The day's likes (#98's first cut, the maintainer's of 20/10/2026): one
 * budget for everybody. A like spends one wherever it goes, and a like back
 * too (#503, the maintainer's of 30/10/2026, ADR-036 §3), so one limit bounds
 * what a person proposes and what they answer; a pass is never counted.
 */
const LIKE_BUDGET_KEY = "like_budget_balanced";

/** The cards whose like answers somebody's: a fish on one is a like (ADR-039 §2). */
const ANSWERS_A_LIKE: readonly QueueReason[] = ["liked_you", "fish"];

/**
 * The person's likes of the day against the budget: one count for the refusal
 * and for the number the queue says (#524), so the two never disagree.
 */
async function likesSent(
  db: Queryable,
  accountId: string,
  today: string,
): Promise<{ sent: number; budget: number }> {
  const budget = await matchingConfigNumber(db, LIKE_BUDGET_KEY);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND r.day = $2 AND e.decision = 'like'`,
    [accountId, today],
  );
  return { sent: rows[0]?.n ?? 0, budget };
}

/**
 * How many of the day's likes the person has left (#524, ADR-036 §6), from the
 * budget down to zero, a shadow-banned person's the same way.
 */
async function likesLeftOf(db: Queryable, accountId: string, today: string): Promise<number> {
  const { sent, budget } = await likesSent(db, accountId, today);
  return Math.max(0, budget - sent);
}

/**
 * The fish (#378, ADR-039, the maintainer's of 20/10/2026): a like with a
 * mark, `fish_budget` of them in each period of `fish_window_days` counted
 * from a Monday, so 7 is the calendar week, Monday to Sunday in Finland (the
 * maintainer's of 29/10/2026, #475; a rolling window until then). Counted
 * from the person's standing fish under the queue's lock, so one changed back
 * the same day is given back. A fish is a like for every other rule: the
 * day's likes, the expiry, the match. On a card of somebody whose like or
 * fish waits on the person it would answer a like, and is a like. Past the
 * period's budget a fish an invitation earned is used by itself (#107,
 * ADR-044 §8), and the fish it paid for are left out of the count.
 */
const FISH_BUDGET_KEY = "fish_budget";
const FISH_WINDOW_KEY = "fish_window_days";

/** A Monday, from which the fish's periods are counted. */
const FISH_PERIODS_FROM = Date.parse("1970-01-05");

/**
 * The person's standing fish of the period that holds today against the
 * budget, those an earned fish paid for left out, and the day the next period
 * begins: one count for the refusal's wait and for whether the queue offers a
 * fish (#475), so the two never disagree. A window of 0, which the panel
 * allows, reads as a day. A card's own fish is never counted against it,
 * since a fish is counted only for a card that holds none.
 */
async function fishSent(
  db: Queryable,
  accountId: string,
  today: string,
): Promise<{ sent: number; budget: number; next: string }> {
  const budget = await matchingConfigNumber(db, FISH_BUDGET_KEY);
  const window = Math.max(1, await matchingConfigNumber(db, FISH_WINDOW_KEY));
  const into = Math.round((Date.parse(today) - FISH_PERIODS_FROM) / DAY_MS) % window;
  const from = addDays(today, -into);
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND e.fish AND r.day >= $2::date AND e.id <> ALL($3::uuid[])`,
    [accountId, from, await entriesPaidBy(db, accountId)],
  );
  return { sent: rows[0]?.n ?? 0, budget, next: addDays(from, window) };
}

/**
 * Whether the person can send a fish today (#475): one of the period's own,
 * or an earned one waiting (ADR-044 §8). Never a count, and nothing of the
 * fish anybody sent the person (ADR-039 §6); a shadow-banned person's is
 * worked out the same way.
 */
async function fishToSendOf(db: Queryable, accountId: string, today: string): Promise<boolean> {
  const { sent, budget } = await fishSent(db, accountId, today);
  return sent < budget || (await earnedFishWaiting(db, accountId));
}

/** What the queue and each decision's answer say of the person's own budgets and turn, one read for both. */
export async function budgetsOf(
  db: Queryable,
  matches: Pick<Matches, "yourTurn">,
  accountId: string,
  today: string,
): Promise<{ fishToSend: boolean; likesLeft: number; yourTurn: number }> {
  return {
    fishToSend: await fishToSendOf(db, accountId, today),
    likesLeft: await likesLeftOf(db, accountId, today),
    yourTurn: await matches.yourTurn(db, accountId),
  };
}

/** What a person reads back of their own decision: a like with the mark is a fish. */
const choiceOf = (decision: QueueDecision | null, fish: boolean): QueueChoice | null =>
  decision === "like" && fish ? "fish" : decision;

/** Somebody the queue adds to the day's log, with why, and how far they live as measured now (ADR-061 §5). */
export type Place = {
  candidateId: string;
  reason: QueueReason;
  distance: DistanceBand;
  /** On a `relaxed` place: every relaxation of the day it needs, the one that names its label first (ADR-042 §5). */
  relaxedWith?: readonly string[];
};

/**
 * The queue's one writer (#95, #502, ADR-062 §1): the day's log, opened if this
 * is the day's first read, and these places after the highest it ever gave.
 * Under the queue's lock; somebody a read beside this one added first is not
 * added twice. Opening the day also deletes what earlier days queued and never
 * showed (§2). A candidate is never the owner and never twice in one day. Each
 * statement asks for itself, holding the rows FOR SHARE, that the owner is still
 * active or shadow-banned (not paused, sanctioned or erased) and that each
 * candidate is still active with no block between the two: the builder reads the
 * pool before it writes, and a pause, a sanction, an erasure or a block in
 * between must not leave a row that outlives it. A candidate dropped so leaves
 * its place empty, as the read does. Null with no owner to write for; otherwise
 * how many places it wrote.
 */
export async function addPlaces(
  deps: QueueDeps,
  input: { accountId: string; day: string; places: readonly Place[] },
): Promise<number | null> {
  if (input.places.some((place) => place.candidateId === input.accountId)) {
    throw new Error("addPlaces: a person is never a card in their own queue");
  }
  return transaction(deps.db, async (tx) => {
    const owner = await tx.query(
      "SELECT 1 FROM account WHERE id = $1 AND state IN ('active', 'shadow_banned') FOR SHARE",
      [input.accountId],
    );
    if (owner.rows.length === 0) return null;
    const opened = await tx.query(
      `INSERT INTO queue_day (account_id, day, started_at) VALUES ($1, $2, $3)
       ON CONFLICT (account_id, day) DO NOTHING`,
      [input.accountId, input.day, deps.now()],
    );
    const today = await tx.query<{ id: string; last: number }>(
      `SELECT r.id, ${PLACES} AS last FROM queue_day r
        WHERE r.account_id = $1 AND r.day = $2 FOR UPDATE OF r`,
      [input.accountId, input.day],
    );
    const stands = today.rows[0];
    if (!stands) throw new Error("addPlaces: the day's queue is not there");
    const written = await tx.query<{ position: number }>(
      `INSERT INTO queue_entry
         (queue_day_id, position, candidate_id, reason, distance, relaxed_field, relaxed_with)
       SELECT $1, $5 + e.ordinality, e.candidate, e.reason::queue_reason,
              e.distance::distance_band, nullif(split_part(e.relaxed, ',', 1), ''),
              string_to_array(e.relaxed, ',')
         FROM unnest($2::uuid[], $3::text[], $6::text[], $7::text[])
              WITH ORDINALITY AS e(candidate, reason, distance, relaxed, ordinality)
         JOIN account c ON c.id = e.candidate
        WHERE c.state = 'active' AND NOT blocked_between($4, e.candidate)
          AND NOT EXISTS (SELECT 1 FROM queue_entry x
                           WHERE x.queue_day_id = $1 AND x.candidate_id = e.candidate)
          FOR SHARE OF c
       RETURNING position`,
      [
        stands.id,
        input.places.map((place) => place.candidateId),
        input.places.map((place) => place.reason),
        input.accountId,
        stands.last,
        input.places.map((place) => place.distance),
        // Field keys hold no comma: each place's relaxations as one text.
        input.places.map((place) => (place.relaxedWith ?? []).join(",")),
      ],
    );
    const added = written.rows.length;
    if (added > 0) {
      // The places are the list's order: the highest a dropped candidate leaves empty is still given.
      await givePlaces(tx, stands.id, input.accountId, stands.last + input.places.length);
    }
    // After the people above are held: an erasure holds the person, then deletes
    // their entries, so an entry of somebody also in today's places, deleted first,
    // would leave each waiting for the other.
    if (opened.rowCount === 1) {
      await tx.query(
        `DELETE FROM queue_entry e USING queue_day r
          WHERE r.id = e.queue_day_id AND r.account_id = $1 AND r.day < $2::date
            AND e.seen_at IS NULL AND e.decision IS NULL`,
        [input.accountId, input.day],
      );
    }
    return added;
  });
}

/** A row of a queue's entry as the read takes it. */
export type EntryRow = {
  position: number | null;
  candidate_id: string | null;
  reason: QueueReason | null;
  decision: QueueDecision | null;
  fish: boolean | null;
  relaxed_field: DealBreakerField | null;
  distance: DistanceBand | null;
  star: string | null;
};

/**
 * The entries' cards in order, at most a page of them, each through the card
 * builder, which writes the shown record and counts the day's cards (ADR-008);
 * a card it refuses (a block either way, a sanction, a profile no longer
 * complete) is left out. Each says which of the person's own deal-breakers, not
 * paused, its card says nothing on (ADR-042 §8): the card leaves out an
 * unanswered field and a hidden one alike, so the label never tells them apart
 * (#515). Distance is no card field and everybody has a home, so no card is ever
 * without it (ADR-061 §7). The band is the one written with the entry, never
 * computed here (§5).
 */
export async function entriesOf(
  accountId: string,
  rows: readonly EntryRow[],
  cardOf: CardOf,
  dealBreakers: readonly DealBreaker[],
): Promise<QueueEntry[]> {
  const entries: QueueEntry[] = [];
  for (const row of rows) {
    if (entries.length === QUEUE_PAGE) break;
    if (row.position === null || row.candidate_id === null || row.reason === null) continue;
    const card = await cardOf(accountId, row.candidate_id);
    if (!card) continue;
    entries.push({
      position: row.position,
      reason: row.reason,
      decision: choiceOf(row.decision, row.fish === true),
      card,
      distance: row.distance,
      star: row.star,
      ...(row.relaxed_field ? { relaxedField: row.relaxed_field } : {}),
      notAnswered: dealBreakers.flatMap(({ field }) =>
        field === "distance" || card.fields[field] !== undefined ? [] : [field],
      ),
    });
  }
  return entries;
}

/**
 * The next cards of the day's log (`entriesOf`), those undecided that fit now,
 * both ways (ADR-062 §8): one that does not stays in the log, left out while it
 * does not fit. A shadow-banned person's liked-you and fish cards wait for the
 * lift, those queued before the ban too (ADR-037 §7): a like back would make no
 * match, and so tell them of it (ADR-024 §7). A starred card comes through the list
 * alone, unless somebody's like waits on it, which a star does not touch (ADR-064
 * §4). Null with no log for the day.
 */
async function nextCards(
  deps: QueueDeps,
  queue: Pick<Queue, "fits">,
  accountId: string,
  day: string,
  cardOf: CardOf,
  dealBreakers: readonly DealBreaker[],
): Promise<QueueEntry[] | null> {
  const { rows } = await deps.db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM queue_day r JOIN account me ON me.id = r.account_id
       LEFT JOIN queue_entry e ON e.queue_day_id = r.id AND e.decision IS NULL
        AND NOT (me.state = 'shadow_banned' AND e.reason IN ('liked_you', 'fish'))
        AND (e.reason IN ('liked_you', 'fish') OR NOT EXISTS (
              SELECT 1 FROM star s
               WHERE s.account_id = r.account_id AND s.candidate_id = e.candidate_id))
      WHERE r.account_id = $1 AND r.day = $2
      ORDER BY e.position`,
    [accountId, day],
  );
  if (rows.length === 0) return null;
  const queued = rows.flatMap((row) => (row.candidate_id ? [row.candidate_id] : []));
  if (queued.length === 0) return [];
  const fitting = await queue.fits(deps.db, accountId, queued);
  return entriesOf(
    accountId,
    rows.filter((row) => row.candidate_id !== null && fitting.has(row.candidate_id)),
    cardOf,
    dealBreakers,
  );
}

/**
 * The queue as the person reads it (ADR-062 §1): the next cards of the day's
 * log and, with none left, the next people added to it first. Null entries
 * while the person's matching has not opened, an empty list at the queue's end.
 * `dealBreakers` are the person's own, not paused.
 */
export async function readQueue(
  deps: QueueDeps,
  matches: Pick<Matches, "yourTurn">,
  queue: Pick<Queue, "fill" | "fits">,
  accountId: string,
  cardOf: CardOf,
  dealBreakers: readonly DealBreaker[] = [],
): Promise<QueueResponse> {
  const day = finnishDay(deps.now());
  let entries = await nextCards(deps, queue, accountId, day, cardOf, dealBreakers);
  for (let tries = 0; !entries?.length && tries < FILL_TRIES; tries += 1) {
    const added = await queue.fill(accountId);
    entries = await nextCards(deps, queue, accountId, day, cardOf, dealBreakers);
    if (!added) break;
  }
  return { day, entries, ...(await budgetsOf(deps.db, matches, accountId, day)) };
}

/** The day named, checked against today before anything is read: an ended day's queue answers day_ended, a later one is nobody's yet. */
export function todayOrRefuse(deps: QueueDeps, day: string): { at: Date; today: string } {
  const at = deps.now();
  const today = finnishDay(at);
  if (day < today) {
    throw new AppError(409, "day_ended", "That queue ended with its day");
  }
  if (day > today) throw notFound();
  return { at, today };
}

/**
 * The phone's report that a card was on the screen: the first sets
 * `seen_at`; a repeat writes nothing. A decision never needs it and never
 * writes it.
 */
export async function markSeen(
  deps: QueueDeps,
  input: { accountId: string; day: string; position: number },
): Promise<void> {
  const { at, today } = todayOrRefuse(deps, input.day);
  const marked = await deps.db.query(
    `UPDATE queue_entry e SET seen_at = $4
       FROM queue_day r
      WHERE r.id = e.queue_day_id AND r.account_id = $1 AND r.day = $2 AND e.position = $3
        AND e.seen_at IS NULL AND ${SERVABLE}`,
    [input.accountId, today, input.position, at],
  );
  if ((marked.rowCount ?? 0) > 0) return;
  // Seen before, or not there at all: told apart only to answer 404.
  const { rows } = await deps.db.query(
    `SELECT 1 FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND r.day = $2 AND e.position = $3 AND ${SERVABLE}`,
    [input.accountId, today, input.position],
  );
  if (rows.length === 0) throw notFound();
}

/**
 * A like, a pass or a skip on today's card, changeable until the day ends:
 * under the queue day's lock, which serialises the person's day across devices
 * and which the day's likes are counted under. The same decision again writes
 * nothing.
 *
 * A new like asks two things, in this order (ADR-062 §5, §8): the conversations
 * on the person's turn, before anything is read of the other person, so that
 * the refusal says nothing of them; and that the two fit now, both ways, with
 * the 404 of a card that can no longer be shown. Neither asks a pass or a skip,
 * so a like can always be taken back.
 *
 * A like of somebody whose like of the person stands, within
 * `like_expiry_days`, is a match (#100, ADR-038): the conversation is opened
 * in this transaction, under the pair's lock, and the answer names it. A like
 * that is part of a match is final, the maintainer's of 20/10/2026: it is
 * not changed, and its place in the day's likes stays spent; any other like
 * may still be taken back until midnight. No match is made while the person
 * is shadow-banned, nor with a block between the two.
 *
 * A fish past its budget spends one an invitation earned the person, in this
 * transaction, and a change of it gives the unit back (#107, ADR-044 §8); the
 * reward table is the rewards slice's, reached through its index.ts. The
 * answer says whether a fish can still go today (#475) and how
 * many likes are left (#524), which the decision moves, read in this
 * transaction after the write.
 */
export async function decide(
  deps: QueueDeps,
  matches: Matches,
  queue: Pick<Queue, "fits" | "later">,
  input: { accountId: string; day: string; position: number; decision: QueueChoice },
): Promise<{
  match: string | null;
  fishToSend: boolean;
  likesLeft: number;
  yourTurn: number;
  later: Later | null;
}> {
  const { at, today } = todayOrRefuse(deps, input.day);
  const decision: QueueDecision = input.decision === "fish" ? "like" : input.decision;
  const written = await transaction(deps.db, async (tx) => {
    const { queueDayId } = await lockCard(tx, {
      accountId: input.accountId,
      today,
      position: input.position,
    });
    const found = await tx.query<{
      id: string;
      candidate_id: string;
      reason: QueueReason;
      decision: QueueDecision | null;
      fish: boolean;
    }>(
      `SELECT e.id, e.candidate_id, e.reason, e.decision, e.fish
         FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
        WHERE r.id = $1 AND r.account_id = $2 AND e.position = $3 AND ${SERVABLE}`,
      [queueDayId, input.accountId, input.position],
    );
    const entry = found.rows[0];
    if (!entry) throw notFound();
    // A fish on a card that answers a like is a like (ADR-039 §2).
    const fish = input.decision === "fish" && !ANSWERS_A_LIKE.includes(entry.reason);
    await tx.query(PAIR_LOCK, [input.accountId, entry.candidate_id]);
    const standing = await matches.between(
      tx,
      input.accountId,
      entry.candidate_id,
      dayWindow(at).start,
    );
    // Later puts the person on the list (#681), again too, so a star cleared from
    // the list since comes back with the next Later.
    const listed = () =>
      decision === "skip"
        ? queue.later(tx, { accountId: input.accountId, candidateId: entry.candidate_id, at })
        : null;
    if (entry.decision === decision && entry.fish === fish) {
      return {
        match: decision === "like" ? standing : null,
        ...(await budgetsOf(tx, matches, input.accountId, today)),
        later: await listed(),
        matchedWith: null,
      };
    }
    if (standing && entry.decision === "like") {
      throw new AppError(409, "match_made", "This like made a match and stays");
    }
    if (decision === "like" && entry.decision !== "like") {
      const limit = await matchingConfigNumber(tx, YOUR_TURN_LIMIT_KEY);
      if (limit > 0 && (await matches.yourTurn(tx, input.accountId)) >= limit) {
        throw new AppError(409, "your_turn_limit", "Conversations are waiting for an answer");
      }
      const fitting = await queue.fits(tx, input.accountId, [entry.candidate_id]);
      if (!fitting.has(entry.candidate_id)) throw notFound();
    }
    // Counted under the queue's lock from the day's standing decisions, so a
    // like taken back gives its place back and two devices cannot both pass
    // the count; the refusal writes nothing. A like made a fish was counted.
    if (decision === "like" && entry.decision !== "like") {
      const count = await likesSent(tx, input.accountId, today);
      if (count.sent >= count.budget) {
        throw new AppError(429, "like_budget_exceeded", "The day's likes are used up", {
          retryAfterSeconds: secondsUntil(dayWindow(at).end, at),
        });
      }
    }
    // The person's fish of the period, under the queue's lock; past the
    // budget the fish takes an earned one, and with none the next can go at
    // the midnight that begins the next period, a Monday's with a week.
    if (fish && !entry.fish) {
      const count = await fishSent(tx, input.accountId, today);
      if (
        count.sent >= count.budget &&
        !(await spendEarned(tx, { accountId: input.accountId, entryId: entry.id, at }))
      ) {
        const back = dayWindow(new Date(`${count.next}T12:00:00Z`)).start;
        throw new AppError(429, "fish_budget_exceeded", "The period's fish are sent", {
          retryAfterSeconds: secondsUntil(back, at),
        });
      }
    }
    // What a fish took is given back when it is a fish no more (ADR-044 §8).
    if (entry.fish && !fish) {
      await releaseEarned(tx, { accountId: input.accountId, entryId: entry.id });
    }
    // The mark that holds a year (ADR-062 §6), read from the person's own earlier
    // days: the same day's pass changed back and forth is one pass.
    const secondPass =
      decision === "pass" &&
      (await passedBefore(tx, input.accountId, entry.candidate_id, queueDayId));
    // The predicate again where it writes: a block or an erasure that
    // committed since the read leaves nothing written.
    const updated = await tx.query(
      `UPDATE queue_entry e SET decision = $4, decided_at = $5, fish = $6, second_pass = $7
         FROM queue_day r
        WHERE r.id = e.queue_day_id AND r.id = $1 AND r.account_id = $2 AND e.id = $3 AND ${SERVABLE}`,
      [queueDayId, input.accountId, entry.id, decision, at, fish, secondPass],
    );
    if (updated.rowCount !== 1) throw notFound();
    // A like or a pass takes the star off (ADR-064 §3), so the list holds only the
    // undecided, and Later puts it on (#681); here, so that one refused or rolled
    // back changes neither.
    if (decision !== "skip") {
      await tx.query("DELETE FROM star WHERE account_id = $1 AND candidate_id = $2", [
        input.accountId,
        entry.candidate_id,
      ]);
    }
    const onList = await listed();
    let match = decision === "like" ? standing : null;
    let opened = false;
    if (decision === "like" && entry.decision !== "like" && !standing) {
      // A new like alone: one made a fish or back was asked neither the limit nor
      // the filters above. The other's like of the person, still standing and not
      // expired, today's included: under the pair's lock it is committed or it is
      // not there.
      const mutual = await tx.query(
        `SELECT 1 FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
          WHERE r.account_id = $1 AND e.candidate_id = $2 AND e.decision = 'like'
            AND r.day > $3::date - $4::int
            AND EXISTS (SELECT 1 FROM account me WHERE me.id = $2 AND me.state = 'active')
            AND NOT blocked_between($2, $1)
          LIMIT 1`,
        [
          entry.candidate_id,
          input.accountId,
          today,
          await matchingConfigNumber(tx, LIKE_EXPIRY_KEY),
        ],
      );
      if (mutual.rows.length > 0) {
        match = await matches.open(tx, {
          first: entry.candidate_id,
          second: input.accountId,
          at,
        });
        opened = true;
      }
    }
    return {
      match,
      // After this decision's write, under the queue's lock: the answer says
      // what it left, and is known before any push of the match starts (ADR-055 §5).
      ...(await budgetsOf(tx, matches, input.accountId, today)),
      later: onList,
      matchedWith: opened ? entry.candidate_id : null,
    };
  });
  // The one who just liked sees the match in the answer; the other is told (ADR-055 §5).
  if (written.matchedWith) matches.made?.({ accountId: written.matchedWith });
  return {
    match: written.match,
    fishToSend: written.fishToSend,
    likesLeft: written.likesLeft,
    yourTurn: written.yourTurn,
    later: written.later,
  };
}

/** Whether the person passed this somebody on another day, as far as the kept year remembers (ADR-062 §6). */
async function passedBefore(
  tx: Queryable,
  accountId: string,
  candidateId: string,
  queueDayId: string,
): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND e.candidate_id = $2 AND e.decision = 'pass' AND r.id <> $3
      LIMIT 1`,
    [accountId, candidateId, queueDayId],
  );
  return rows.length > 0;
}

/** Somebody a relaxation lets in, with the day's other relaxations their filters still need (ADR-042 §5) and how far they live, written with the card (ADR-061 §5). */
export type RelaxedCandidate = {
  candidateId: string;
  needs: DealBreakerField[];
  distance: DistanceBand;
};

/**
 * The short pool's side that reads across slices (#99, ADR-042 §4, §5): the
 * queue's builder's, which lives with the jobs and reads the pond as it does,
 * handed in by app.ts. `offers` is what the queue may relax today, null with no
 * queue today; `candidates` whom a relaxation lets in today, in the order they
 * would come, null for one the offers would not list.
 */
export type ShortPool = {
  offers: (accountId: string) => Promise<{ short: boolean; offers: RelaxationOffer[] } | null>;
  /**
   * With the day's relaxations the candidates were counted under (`basis`),
   * which the writer holds them to, and for each the ones of them it needs.
   */
  candidates: (
    accountId: string,
    relaxation: Relaxation,
  ) => Promise<{ basis: Relaxation[]; candidates: RelaxedCandidate[] } | null>;
};

/**
 * Today's relaxations of the person's queue (ADR-042 §3) and the highest place
 * it gave; null with no queue for the day.
 */
export async function relaxationsOf(
  db: Queryable,
  accountId: string,
  day: string,
): Promise<{ last: number; relaxed: Relaxation[] } | null> {
  const { rows } = await db.query<{ last: number; relaxed: Relaxation[] }>(
    `SELECT ${PLACES} AS last,
            coalesce((SELECT json_agg(json_build_object('field', x.field, 'kind', x.kind)
                                      ORDER BY x.field)
                        FROM queue_relaxation x WHERE x.queue_day_id = r.id), '[]') AS relaxed
       FROM queue_day r WHERE r.account_id = $1 AND r.day = $2`,
    [accountId, day],
  );
  return rows[0] ?? null;
}

/** The same relaxations, whatever their order. */
const sameRelaxations = (a: readonly Relaxation[], b: readonly Relaxation[]) => {
  const key = (r: Relaxation) => `${r.field}:${r.kind}`;
  return JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
};

/**
 * A relaxation tapped (ADR-042 §5, ADR-062 §10): recorded on today's queue, and
 * the first of the people it lets in added after the highest place the queue
 * ever gave (`last_position`, so a place an undo freed never names somebody
 * else), a page of them, in the order given, reason `relaxed` with the field,
 * and with the relaxations of the day each needs (`relaxed_with`, the tapped one
 * first), so undoing one of them takes the card back and a like waives them all;
 * the queue goes on to the rest once those are read. Under the queue's
 * lock, after the owner's account shared as a decision takes it; the day's
 * relaxations are held to those the candidates were counted under (`basis`),
 * so one undone or made meanwhile refuses the write, 409
 * `relaxations_changed`; each candidate is asked where it is written to be
 * still active, with no block between the two, and not in the queue yet.
 * The places written, in
 * order; 409 `already_relaxed` for a field relaxed today, nothing written.
 */
export async function appendRelaxed(
  deps: QueueDeps,
  input: {
    accountId: string;
    day: string;
    relaxation: Relaxation;
    basis: readonly Relaxation[];
    candidates: readonly RelaxedCandidate[];
  },
): Promise<number[]> {
  const { today } = todayOrRefuse(deps, input.day);
  return transaction(deps.db, async (tx) => {
    const queueDayId = await lockQueueDayToday(tx, input.accountId, today);
    const standing = await tx.query<Relaxation>(
      "SELECT field, kind FROM queue_relaxation WHERE queue_day_id = $1",
      [queueDayId],
    );
    if (standing.rows.some((r) => r.field === input.relaxation.field)) {
      throw new AppError(409, "already_relaxed", "That deal-breaker is relaxed today");
    }
    if (!sameRelaxations(standing.rows, input.basis)) {
      throw new AppError(409, "relaxations_changed", "The day's relaxations changed meanwhile");
    }
    // Read under the queue's lock above, so the same field cannot have come in meanwhile.
    await tx.query(
      "INSERT INTO queue_relaxation (queue_day_id, field, kind, created_at) VALUES ($1, $2, $3, $4)",
      [queueDayId, input.relaxation.field, input.relaxation.kind, deps.now()],
    );
    const placed = await tx.query<{ last: number }>(
      `SELECT ${PLACES} AS last FROM queue_day r WHERE r.id = $1 AND r.account_id = $2`,
      [queueDayId, input.accountId],
    );
    const last = placed.rows[0]?.last ?? 0;
    const room = Math.min(QUEUE_PAGE, QUEUE_POSITION_MAX - last);
    if (room <= 0 || input.candidates.length === 0) return [];
    const taken = await tx.query<{ candidate: string }>(
      `SELECT e.candidate FROM unnest($1::uuid[]) WITH ORDINALITY AS e(candidate, ordinality)
         JOIN account c ON c.id = e.candidate
        WHERE c.state = 'active' AND NOT blocked_between($2, e.candidate)
          AND NOT EXISTS (SELECT 1 FROM queue_entry x WHERE x.queue_day_id = $3 AND x.candidate_id = e.candidate)
          AND e.candidate <> $2
        ORDER BY e.ordinality LIMIT $4
        FOR SHARE OF c`,
      [input.candidates.map((c) => c.candidateId), input.accountId, queueDayId, room],
    );
    const positions = taken.rows.map((_, index) => last + index + 1);
    if (positions.length === 0) return [];
    const candidates = new Map(input.candidates.map((c) => [c.candidateId, c]));
    await tx.query(
      `INSERT INTO queue_entry (queue_day_id, position, candidate_id, reason, relaxed_field, relaxed_with, distance)
       SELECT $1, e.position, e.candidate, 'relaxed', $4, string_to_array(e.relaxed_with, ','),
              e.distance::distance_band
         FROM unnest($2::smallint[], $3::uuid[], $5::text[], $6::text[])
              AS e(position, candidate, relaxed_with, distance)`,
      [
        queueDayId,
        positions,
        taken.rows.map((row) => row.candidate),
        input.relaxation.field,
        // Field keys hold no comma: each card's relaxations as one text, the tapped one first.
        taken.rows.map((row) =>
          [input.relaxation.field, ...(candidates.get(row.candidate)?.needs ?? [])].join(","),
        ),
        taken.rows.map((row) => candidates.get(row.candidate)?.distance),
      ],
    );
    await givePlaces(tx, queueDayId, input.accountId, last + positions.length);
    return positions;
  });
}

/**
 * A relaxation undone (ADR-042 §6): its row deleted, and with it today's
 * cards that need it and are still undecided, a later relaxation's that
 * needed it too, under the queue's lock; a decided one stays. The places
 * removed; 404 for a field not relaxed today.
 */
export async function undoRelaxation(
  deps: QueueDeps,
  input: { accountId: string; day: string; field: DealBreakerField },
): Promise<number[]> {
  const { today } = todayOrRefuse(deps, input.day);
  return transaction(deps.db, async (tx) => {
    const queueDayId = await lockQueueDayToday(tx, input.accountId, today);
    const undone = await tx.query(
      "DELETE FROM queue_relaxation WHERE queue_day_id = $1 AND field = $2",
      [queueDayId, input.field],
    );
    if (undone.rowCount !== 1) throw new AppError(404, "not_found", "Not relaxed today");
    const removed = await tx.query<{ position: number }>(
      `DELETE FROM queue_entry WHERE queue_day_id = $1 AND $2 = ANY(relaxed_with) AND decision IS NULL
       RETURNING position`,
      [queueDayId, input.field],
    );
    return removed.rows.map((row) => row.position).sort((a, b) => a - b);
  });
}

const noQueueDay = () => new AppError(404, "not_found", "No queue today");

/**
 * What the person may relax today and what they have (ADR-042 §4), for the
 * day named: an ended day answers day_ended, a day with no queue 404.
 */
export async function readRelaxations(
  deps: QueueDeps,
  shortPool: ShortPool,
  input: { accountId: string; day: string },
): Promise<RelaxationsResponse> {
  const { today } = todayOrRefuse(deps, input.day);
  const now = await relaxationsOf(deps.db, input.accountId, today);
  if (!now) throw noQueueDay();
  const offered = await shortPool.offers(input.accountId);
  return { short: offered?.short ?? false, offers: offered?.offers ?? [], relaxed: now.relaxed };
}

/**
 * A relaxation tapped (ADR-042 §5): 409 `already_relaxed` for a field relaxed
 * today, 404 for one the offers would not list; otherwise the people it lets
 * in, added (`appendRelaxed`). The places written.
 */
export async function relax(
  deps: QueueDeps,
  shortPool: ShortPool,
  input: { accountId: string; day: string; relaxation: Relaxation },
): Promise<number[]> {
  const { today } = todayOrRefuse(deps, input.day);
  const now = await relaxationsOf(deps.db, input.accountId, today);
  if (!now) throw noQueueDay();
  if (now.relaxed.some((r) => r.field === input.relaxation.field)) {
    throw new AppError(409, "already_relaxed", "That deal-breaker is relaxed today");
  }
  const found = await shortPool.candidates(input.accountId, input.relaxation);
  if (!found) throw new AppError(404, "not_found", "No such relaxation to offer");
  return appendRelaxed(deps, { ...input, day: today, ...found });
}

/**
 * The cards at these places of today's queue, as the read gives them
 * (`entriesOf`), for the answer of a relaxation, those that fit now: somebody may
 * have narrowed their filters since the pool was walked (ADR-062 §8).
 */
export async function readAdded(
  deps: QueueDeps,
  queue: Pick<Queue, "fits">,
  accountId: string,
  day: string,
  positions: readonly number[],
  cardOf: CardOf,
  dealBreakers: readonly DealBreaker[],
): Promise<QueueEntry[]> {
  if (positions.length === 0) return [];
  const { rows } = await deps.db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND r.day = $2 AND e.position = ANY($3::smallint[])
      ORDER BY e.position`,
    [accountId, day, positions],
  );
  const added = rows.flatMap((row) => (row.candidate_id ? [row.candidate_id] : []));
  const fitting = await queue.fits(deps.db, accountId, added);
  return entriesOf(
    accountId,
    rows.filter((row) => row.candidate_id !== null && fitting.has(row.candidate_id)),
    cardOf,
    dealBreakers,
  );
}

/** How long a queue and its entries are kept (ADR-062 §13, the maintainer's of 01/11/2026): the longest clock of the ladder reads them this far back. */
export const QUEUE_RETENTION_DAYS = 365;

/**
 * The tunables counted back over the log: past the kept year each would end
 * at it without a word, so the panel refuses them there, rather than the log
 * being kept longer (#687, the maintainer's of 16/11/2026). An ended
 * conversation's clock is not among them: it counts from the conversation's
 * close, which the prune leaves alone.
 */
export const KEPT_YEAR_KEYS: ReadonlySet<string> = new Set([
  "pass_cooldown_days",
  "second_pass_cooldown_days",
  "liked_cooldown_days",
  LIKE_EXPIRY_KEY,
  FISH_WINDOW_KEY,
]);

/** The night's prune: queue days past the kept year, their entries and relaxations with them. */
export async function pruneQueueDays(db: Queryable, at: Date): Promise<number> {
  const { rowCount } = await db.query("DELETE FROM queue_day WHERE day < $1::date", [
    addDays(finnishDay(at), -QUEUE_RETENTION_DAYS),
  ]);
  return rowCount ?? 0;
}

/**
 * Erasure's part (TD-7, ADR-007 §4), inside its transaction: the entries in
 * which the person is somebody's card, others' decisions on them included,
 * and the person's own queue days, their entries with them.
 */
export async function eraseQueueOf(
  tx: Queryable,
  accountId: string,
): Promise<{ days: number; entriesAsCandidate: number }> {
  const asCandidate = await tx.query("DELETE FROM queue_entry WHERE candidate_id = $1", [
    accountId,
  ]);
  const own = await tx.query("DELETE FROM queue_day WHERE account_id = $1", [accountId]);
  return { days: own.rowCount ?? 0, entriesAsCandidate: asCandidate.rowCount ?? 0 };
}

export type OwnQueueDay = {
  day: string;
  startedAt: Date;
  /** The day's relaxations (ADR-042 §10), the oldest first. */
  relaxations: { field: DealBreakerField; kind: Relaxation["kind"]; createdAt: Date }[];
  entries: {
    position: number;
    reason: QueueReason;
    relaxedField: DealBreakerField | null;
    seenAt: Date | null;
    decision: QueueChoice | null;
    decidedAt: Date | null;
    secondPass: boolean;
    distance: DistanceBand | null;
  }[];
};

/** The person's own queue days for their export, newest day first: places, reasons and decisions, never whom. */
export async function exportQueue(
  db: Queryable,
  accountId: string,
  limit: number,
): Promise<OwnQueueDay[]> {
  const { rows } = await db.query<{
    id: string;
    day: string;
    started_at: Date;
  }>(
    `SELECT id, day::text AS day, started_at FROM queue_day
      WHERE account_id = $1 ORDER BY day DESC LIMIT $2`,
    [accountId, limit],
  );
  if (rows.length === 0) return [];
  const entries = await db.query<{
    queue_day_id: string;
    position: number;
    reason: QueueReason;
    relaxed_field: DealBreakerField | null;
    seen_at: Date | null;
    decision: QueueDecision | null;
    fish: boolean;
    second_pass: boolean;
    decided_at: Date | null;
    distance: DistanceBand | null;
  }>(
    `SELECT e.queue_day_id, e.position, e.reason, e.relaxed_field, e.seen_at, e.decision, e.fish,
            e.second_pass, e.decided_at, e.distance
       FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND r.id = ANY($2::uuid[])
      ORDER BY e.position`,
    [accountId, rows.map((row) => row.id)],
  );
  const relaxations = await db.query<{
    queue_day_id: string;
    field: DealBreakerField;
    kind: Relaxation["kind"];
    created_at: Date;
  }>(
    `SELECT x.queue_day_id, x.field, x.kind, x.created_at
       FROM queue_relaxation x JOIN queue_day r ON r.id = x.queue_day_id
      WHERE r.account_id = $1 AND r.id = ANY($2::uuid[])
      ORDER BY x.created_at, x.field`,
    [accountId, rows.map((row) => row.id)],
  );
  return rows.map((row) => ({
    day: row.day,
    startedAt: row.started_at,
    relaxations: relaxations.rows
      .filter((relaxation) => relaxation.queue_day_id === row.id)
      .map((relaxation) => ({
        field: relaxation.field,
        kind: relaxation.kind,
        createdAt: relaxation.created_at,
      })),
    entries: entries.rows
      .filter((entry) => entry.queue_day_id === row.id)
      .map((entry) => ({
        position: entry.position,
        reason: entry.reason,
        relaxedField: entry.relaxed_field,
        seenAt: entry.seen_at,
        decision: choiceOf(entry.decision, entry.fish),
        decidedAt: entry.decided_at,
        secondPass: entry.second_pass,
        distance: entry.distance,
      })),
  }));
}
