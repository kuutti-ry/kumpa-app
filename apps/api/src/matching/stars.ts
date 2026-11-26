import type { Queryable } from "@kuutti/db";
import {
  type DealBreaker,
  type Later,
  type QueueResponse,
  STARS_CEILING,
  type StarredPerson,
} from "@kuutti/schema";
import { AppError } from "../lib/errors.ts";
import { finnishDay } from "../lib/finnish-day.ts";
import { matchingConfigNumber } from "../lib/matching-config.ts";
import { wasShown } from "../media/index.ts";
import type { PartsOf } from "./anchor.ts";
import {
  addPlaces,
  budgetsOf,
  type CardOf,
  ENTRY_COLUMNS,
  type EntryRow,
  entriesOf,
  type Matches,
  notFound,
  type Place,
  type QueueDeps,
  withLikedYour,
} from "./queue.ts";

// The stars (#575, ADR-064): somebody saved to come back to, put by Later since
// #681. A star is the person's own and nothing else reads it: the queue leaves a
// starred person out of that person's own cards (`todayOf`, `nextCards`), and
// their Later list and the card it opens are here. It reaches nobody, and feeds no
// order, no count and no event. Every statement names the caller (rule 6), and no
// route takes another person's id: a star is put by a skip on a card's place, and
// read, opened and cleared by its own id, which answers 404 to anybody but its
// owner. Raw parameterised SQL through Queryable, as `queue.ts`, under whose locks
// it writes.

/** The most stars a person's list may hold (ADR-064 §5); 0 is off, and STARS_CEILING stands either way. */
const STARS_MAX_KEY = "stars_max";

/**
 * What the stars read across slices, the jobs' (`jobs/stars.ts`), handed in by
 * app.ts. `shown` says which of these people a person's list shows now, in the
 * caller's transaction when there is one; `place` is where a starred card goes in
 * today's log; `people` is the list itself.
 */
export type Stars = {
  shown: (
    db: Queryable,
    accountId: string,
    candidateIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
  place: (accountId: string, candidateId: string) => Promise<Place | null>;
  people: (accountId: string) => Promise<StarredPerson[]>;
  /** What of a card a like may name (#463, ADR-077), as the queue's `parts`: a card opened from the list says what a waiting like named. */
  parts: PartsOf;
};

/**
 * Later's place on the list (#681, ADR-064 History), in `decide`'s transaction,
 * which holds the two accounts in id order and then the queue's row, so an
 * erasure under way finishes first, one that comes later waits, and two devices
 * cannot both pass the count. The same person again keeps the star that stands.
 * A card the person was never served takes none, since the list says a name and
 * an age and no budget would count them (ADR-008): `not_listed`. Past the most a
 * list may hold it puts none and says `full`, and the skip stands alone, back
 * another day: the count is of those the list shows now (§5), so it never says
 * full to somebody who sees fewer.
 */
export async function putOnLaterList(
  tx: Queryable,
  stars: Pick<Stars, "shown">,
  input: { accountId: string; candidateId: string; at: Date },
): Promise<Later> {
  const { accountId, candidateId } = input;
  const served = await wasShown(tx, { viewerAccountId: accountId, subjectAccountId: candidateId });
  if (!served) return "not_listed";
  const held = await tx.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM star WHERE account_id = $1",
    [accountId],
  );
  if (held.rows.some((row) => row.candidate_id === candidateId)) return "listed";
  if (held.rows.length >= STARS_CEILING) return "full";
  const shown = await stars.shown(
    tx,
    accountId,
    held.rows.map((row) => row.candidate_id),
  );
  const max = await matchingConfigNumber(tx, STARS_MAX_KEY);
  if (max > 0 && shown.size >= max) return "full";
  await tx.query("INSERT INTO star (account_id, candidate_id, created_at) VALUES ($1, $2, $3)", [
    accountId,
    candidateId,
    input.at,
  ]);
  return shown.size === 0 ? "first" : "listed";
}

/** The person takes a star off, wherever they are: the card's or the list's. 404 for one that is not theirs, or gone. */
export async function clearStar(
  db: Queryable,
  input: { accountId: string; id: string },
): Promise<void> {
  const { rowCount } = await db.query("DELETE FROM star WHERE id = $1 AND account_id = $2", [
    input.id,
    input.accountId,
  ]);
  if (rowCount !== 1) throw new AppError(404, "not_found", "No such star");
}

/** The entry of `candidateId` in the person's log of `day`, as `entriesOf` takes it. */
async function entryOfCandidate(
  db: Queryable,
  accountId: string,
  day: string,
  candidateId: string,
): Promise<EntryRow | null> {
  const { rows } = await db.query<EntryRow>(
    `SELECT ${ENTRY_COLUMNS}
       FROM queue_entry e JOIN queue_day r ON r.id = e.queue_day_id
      WHERE r.account_id = $1 AND r.day = $2 AND e.candidate_id = $3`,
    [accountId, day, candidateId],
  );
  return rows[0] ?? null;
}

/**
 * A star opened from the list (ADR-064 §2, §4): somebody the list shows now comes
 * into today's log, or comes as they already are there, so that the card is
 * addressed, decided and counted as any card is, with the band of when it was
 * written. The card is served by the card builder (ADR-008, ADR-041) as a read of
 * the queue serves one. An answer of the queue's shape holding that one card; 404
 * for a star that is not the caller's, or for somebody the list leaves out now.
 */
export async function openStar(
  deps: QueueDeps,
  matches: Pick<Matches, "yourTurn">,
  stars: Pick<Stars, "shown" | "place" | "parts">,
  cardOf: CardOf,
  dealBreakers: readonly DealBreaker[],
  input: { accountId: string; id: string },
): Promise<QueueResponse> {
  const day = finnishDay(deps.now());
  const { accountId } = input;
  const { rows } = await deps.db.query<{ candidate_id: string }>(
    "SELECT candidate_id FROM star WHERE id = $1 AND account_id = $2",
    [input.id, accountId],
  );
  const candidateId = rows[0]?.candidate_id;
  if (!candidateId) throw notFound();
  const shown = await stars.shown(deps.db, accountId, [candidateId]);
  if (!shown.has(candidateId)) throw notFound();
  let row = await entryOfCandidate(deps.db, accountId, day, candidateId);
  if (!row) {
    const place = await stars.place(accountId, candidateId);
    if (!place) throw notFound();
    // A read beside this one may have written them first; the read back says.
    await addPlaces(deps, { accountId, day, places: [place] });
    row = await entryOfCandidate(deps.db, accountId, day, candidateId);
  }
  if (!row) throw notFound();
  const entries = await withLikedYour(
    deps.db,
    stars.parts,
    accountId,
    day,
    await entriesOf(accountId, [row], cardOf, dealBreakers),
  );
  if (entries.length === 0) throw notFound();
  return { day, entries, ...(await budgetsOf(deps.db, matches, accountId, day)) };
}

/**
 * Erasure's part (TD-7, ADR-007 §4, ADR-064 §9), inside its transaction: the stars
 * the person put and those put on them. How many the person put, for the summary:
 * how many were on them is in no count, a log line's included (§8).
 */
export async function eraseStarsOf(tx: Queryable, accountId: string): Promise<number> {
  const own = await tx.query("DELETE FROM star WHERE account_id = $1", [accountId]);
  await tx.query("DELETE FROM star WHERE candidate_id = $1", [accountId]);
  return own.rowCount ?? 0;
}

/** The person's own stars for their export, the latest first: when, never on whom. */
export async function exportStars(db: Queryable, accountId: string): Promise<Date[]> {
  const { rows } = await db.query<{ created_at: Date }>(
    "SELECT created_at FROM star WHERE account_id = $1 ORDER BY created_at DESC, id",
    [accountId],
  );
  return rows.map((row) => row.created_at);
}
