import type { Queryable } from "@kuutti/db";
import {
  type DealBreaker,
  type DistanceEdges,
  type GateResponse,
  PROFILE_FIELDS,
  type PreferencesResponse,
} from "@kuutti/schema";
import { CURRENT_CONSENT_VERSIONS } from "../identity/index.ts";
import { distanceEdges, matchingOpen } from "../lib/matching-config.ts";
import {
  type DealBreakerRow,
  dealBreakersFrom,
  type PoolPerson,
  preferencesFrom,
  type QueueCandidate,
} from "../matching/index.ts";
import { homeRules, keptPlace, pointOf } from "../pond/index.ts";
import { ageInYears, answeredFieldsOf, answeredPromptsOf, completeness } from "../profile/index.ts";

/**
 * Who is complete, and what their pools ask of them (#94, #500, ADR-060): one
 * reader for the queue's builder, for what a person is told of their matching,
 * and for the invitations. The pond is everybody who is complete, the country
 * over, with no row of its own (ADR-061 §8, #607). It lives here and not in a
 * slice because it reads across several (accounts, consents, profiles, photos,
 * preferences, blocks) and none of them should depend on the others for
 * it (rules/layout.md). The rules it applies are pure functions of the slices:
 * `inEachOthersPool` of matching, `completeness` of the profile.
 *
 * Raw parameterised SQL for the same reason as pond/repo.ts. No statement
 * takes input from a request but the caller's own account id; what is put
 * into a statement's text is a constant of the code.
 */
type FactsRow = {
  id: string;
  identity_id: string;
  gender: string | null;
  home_place: string | null;
  state: string;
  birth_year: number | null;
  birth_month: number | null;
  display_name: string | null;
  bio: string | null;
  bio_preset: string | null;
  prompts: unknown;
  fields: unknown;
  intent: string | null;
  approved_photos: string;
  seeks: unknown;
  age_window: unknown;
  terms: boolean;
  privacy: boolean;
  special_category: boolean;
};

/** A person whose profile and onboarding are complete, as the queue's builder sees them (#95). */
export type Subject = QueueCandidate & {
  /** Seen by others: a shadow-banned person has queue days of their own and is in nobody's pool. */
  visible: boolean;
};

/**
 * What `profileComplete` reads of an account `a` beside its profile's own
 * columns: its approved profile photos, and its seeks and age window.
 */
export const PROFILE_FACTS = `(SELECT count(*) FROM photo ph
           WHERE ph.account_id = a.id AND ph.purpose = 'profile' AND ph.state = 'approved') AS approved_photos,
         (SELECT r.value FROM preferences r
           WHERE r.account_id = a.id AND r.mode = 'hard' AND r.field = 'seeks') AS seeks,
         (SELECT r.value FROM preferences r
           WHERE r.account_id = a.id AND r.mode = 'hard' AND r.field = 'age_window') AS age_window`;

/**
 * Whether a profile is complete, decided by `completeness()` itself from the
 * facts the profile screen gathers, so the queue, the counter and the screen
 * cannot disagree.
 */
export function profileComplete(
  row: {
    display_name: string | null;
    bio: string | null;
    bio_preset: string | null;
    prompts: unknown;
    approved_photos: string;
  },
  preferences: PreferencesResponse,
): boolean {
  return completeness({
    displayName: row.display_name,
    bio: row.bio,
    bioPreset: row.bio_preset,
    answeredPrompts: answeredPromptsOf(row.prompts),
    approvedPhotos: Number(row.approved_photos),
    seeks: preferences.seeks,
    ageWindow: preferences.ageWindow,
  }).complete;
}

// Who can be complete: live accounts in good standing. `registered` is not
// (no consents yet), paused, suspended and banned accounts are hidden or gone.
const FACTS = `
  SELECT a.id, a.identity_id, a.gender, a.home_place, a.state, a.birth_year, a.birth_month,
         p.display_name, p.bio, p.bio_preset, p.prompts, p.fields, p.fields->>'intent' AS intent,
         ${PROFILE_FACTS},
         EXISTS (SELECT 1 FROM consent c WHERE c.account_id = a.id AND c.kind = 'terms'
                  AND c.withdrawn_at IS NULL AND c.version = $2) AS terms,
         EXISTS (SELECT 1 FROM consent c WHERE c.account_id = a.id AND c.kind = 'privacy'
                  AND c.withdrawn_at IS NULL AND c.version = $3) AS privacy,
         EXISTS (SELECT 1 FROM consent c WHERE c.account_id = a.id AND c.kind = 'special_category'
                  AND c.withdrawn_at IS NULL AND c.version = $4) AS special_category
  FROM account a
  JOIN identity i ON i.id = a.identity_id
  LEFT JOIN profile p ON p.account_id = a.id
  WHERE a.id = ANY($1::uuid[])
    AND a.state IN ('active', 'shadow_banned')
    AND i.standing = 'ok'`;

/** Somebody who blocked nobody here. */
const NO_BLOCKS: ReadonlySet<string> = new Set();
/** Somebody with no deal-breaker. */
const NO_DEAL_BREAKERS: readonly DealBreaker[] = [];

/** What a read of people measures homes by (ADR-061 §2, §5): read once, the same for everybody of it. */
type Homes = { minInhabitants: number; edges: DistanceEdges };

async function homesOf(db: Queryable): Promise<Homes> {
  const { minInhabitants } = await homeRules(db);
  return { minInhabitants, edges: await distanceEdges(db) };
}

/**
 * The row as a subject, or null while something is missing: the profile's
 * completeness (#47) and onboarding's (ADR-010 §6: a consent for an older
 * wording reads as none) are both asked, by the rules the person's own
 * screens are told by. `blocks` are the identities the person blocked (#84),
 * `dealBreakers` the person's deal-breakers as stored (#87), `homes` what a
 * home is measured by.
 */
function subjectFrom(
  row: FactsRow,
  at: Date,
  blocks: ReadonlySet<string>,
  dealBreakers: readonly DealBreaker[],
  homes: Homes,
): Subject | null {
  const preferences = preferencesFrom({ seeks: row.seeks, ageWindow: row.age_window });
  const gender = row.gender as PoolPerson["gender"] | null;
  if (!gender || !preferences.seeks || !preferences.ageWindow) return null;
  if (row.birth_year === null || row.birth_month === null) return null;
  // Intent is a hard filter both ways (#147): an onboarding step, so a person without one is not done.
  const intent = PROFILE_FIELDS.intent.schema.safeParse(row.intent).data;
  if (!intent) return null;
  // So is the home (ADR-061 §1, §2): read through the floor, and without a place the list knows there is nobody to measure from.
  const place = row.home_place === null ? null : keptPlace(row.home_place, homes.minInhabitants);
  const point = place === null ? null : pointOf(place);
  if (!point) return null;
  // The seek answer counts only with the special-category consent (ADR-019 §4), as the status reads it.
  if (!row.terms || !row.privacy || !row.special_category) return null;
  if (!profileComplete(row, preferences)) return null;
  return {
    id: row.id,
    person: {
      gender,
      seeks: preferences.seeks,
      ageWindow: preferences.ageWindow,
      age: ageInYears(row.birth_year, row.birth_month, at),
      intent,
      home: { ...point, edges: homes.edges },
      identityId: row.identity_id,
      blocks,
      fields: answeredFieldsOf(row.fields),
      dealBreakers,
    },
    visible: row.state === "active",
  };
}

/**
 * The complete people among `accounts`, with whom each blocked and their
 * deal-breakers. There is no pond to be of (ADR-061 §8, #607): a home is what
 * puts a person among the others, and `subjectFrom` asks for it.
 */
export async function subjectsAmong(
  db: Queryable,
  accounts: readonly string[],
  at: Date,
): Promise<Subject[]> {
  const { rows } = await db.query<FactsRow>(FACTS, [
    accounts,
    CURRENT_CONSENT_VERSIONS.terms,
    CURRENT_CONSENT_VERSIONS.privacy,
    CURRENT_CONSENT_VERSIONS.special_category,
  ]);
  const blocks = await blocksWithin(
    db,
    rows.map((row) => row.identity_id),
  );
  const dealBreakers = await dealBreakersOf(
    db,
    rows.map((row) => row.id),
  );
  const homes = await homesOf(db);
  return rows.flatMap(
    (row) =>
      subjectFrom(
        row,
        at,
        blocks.get(row.identity_id) ?? NO_BLOCKS,
        dealBreakers.get(row.id) ?? NO_DEAL_BREAKERS,
        homes,
      ) ?? [],
  );
}

/**
 * Everybody who is complete, the one pond there is (ADR-061 §8), for the queue
 * builder (#95, ADR-035): whether they are seen by others, and their pool
 * facts. Read with no lock: the builder's one writer asks each candidate's
 * liveness and the blocks again in the statements that write (ADR-034 §8).
 */
export async function subjectsOfPond(db: Queryable, at: Date): Promise<Subject[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM account
      WHERE home_place IS NOT NULL AND state IN ('active', 'shadow_banned')`,
  );
  return subjectsAmong(
    db,
    rows.map((row) => row.id),
    at,
  );
}

/** One person, or null while they are not complete: the queue's builder's first look (#95, ADR-035 §5). */
export async function subjectOf(
  db: Queryable,
  accountId: string,
  at: Date,
): Promise<Subject | null> {
  return (await subjectsAmong(db, [accountId], at))[0] ?? null;
}

/**
 * The blocks between the people read, by who set them (#84, ADR-030
 * §3): a blocked pair is not in each other's pool, so the queue days never show
 * them to each other. Read here, not through the safety slice: this reader
 * reads every slice's rows itself.
 */
async function blocksWithin(
  db: Queryable,
  identities: readonly string[],
): Promise<Map<string, Set<string>>> {
  const { rows } = await db.query<{ blocker_identity_id: string; blocked_identity_id: string }>(
    `SELECT blocker_identity_id, blocked_identity_id FROM block
     WHERE blocker_identity_id = ANY($1::uuid[]) AND blocked_identity_id = ANY($1::uuid[])`,
    [identities],
  );
  const byBlocker = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = byBlocker.get(row.blocker_identity_id) ?? new Set<string>();
    set.add(row.blocked_identity_id);
    byBlocker.set(row.blocker_identity_id, set);
  }
  return byBlocker;
}

/**
 * The deal-breakers of the people read (#87, #149), by account, read as
 * the person's own screen reads them (`dealBreakersFrom`): a pair one of them
 * excludes is not in each other's pool. Whether one is paused is the pool's to
 * ask, from the holder's own answers. Nothing of them is logged or written here.
 */
async function dealBreakersOf(
  db: Queryable,
  accounts: readonly string[],
): Promise<Map<string, DealBreaker[]>> {
  const { rows } = await db.query<DealBreakerRow & { account_id: string }>(
    `SELECT account_id, field, value, include_unknown FROM preferences
     WHERE account_id = ANY($1::uuid[]) AND mode = 'hard'
       AND field NOT IN ('seeks', 'age_window')
     ORDER BY account_id, field`,
    [accounts],
  );
  const byAccount = new Map<string, DealBreakerRow[]>();
  for (const row of rows) {
    const list = byAccount.get(row.account_id) ?? [];
    list.push(row);
    byAccount.set(row.account_id, list);
  }
  return new Map([...byAccount].map(([account, list]) => [account, dealBreakersFrom(list)]));
}

/** Whether the person's profile and onboarding are complete (ADR-060 §3, §7): read when asked, kept nowhere. */
export async function isComplete(db: Queryable, accountId: string, at: Date): Promise<boolean> {
  return (await subjectOf(db, accountId, at)) !== null;
}

/**
 * Whether matching is open for the caller (ADR-060 §3, §4): the one switch
 * and their own completeness, nothing else, and nothing said of anybody but
 * the caller (rule 6: the statement about a person names them).
 */
export async function matchingStatusOf(
  deps: { db: Queryable; now: () => Date },
  accountId: string,
): Promise<GateResponse> {
  if (!(await subjectOf(deps.db, accountId, deps.now()))) return { state: "incomplete" };
  return { state: (await matchingOpen(deps.db)) ? "open" : "closed" };
}
