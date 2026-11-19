import { z } from "zod";
import { DEAL_BREAKERS_CAP, DealBreakerField } from "./deal-breakers.ts";
import { DistanceBand } from "./distance.ts";
import { ProfileCard } from "./profile.ts";
import { exportPart } from "./report.ts";

// The queue (#502, ADR-062) and the day's log of it, the queue (#96, TD-11,
// TD-12, ADR-034): what one person goes through on one Finnish calendar day,
// each card with why it is there and the person's own decision, which may
// change until the day ends. No answer carries a score, a seen time or
// anybody's decision about the person, and the counts it carries are the
// person's own: their likes left today (#524) and the conversations on their
// turn (ADR-062 §5). A star is the person's own too (#575, ADR-064), put by
// Later since #681: no answer tells anybody else of one, and none says how many
// stars anybody has.

/** The most cards one read hands over (ADR-062 §1): a bound of the contract, not a tunable; nobody meets it, the next read goes on. */
export const QUEUE_PAGE = 10;

/** The highest place of a day's log: the column's range, which nobody meets, not a limit on how far a person reads. */
export const QUEUE_POSITION_MAX = 32_767;

/** Why a candidate is in the queue (TD-12), the label on every card. Mirrors the database's queue_reason. */
export const QueueReason = z
  .enum(["matches_filters", "liked_you", "seen_before", "relaxed", "fish"])
  .meta({ id: "QueueReason" });
export type QueueReason = z.infer<typeof QueueReason>;

/** What the person did with a card. Mirrors the database's queue_decision. */
export const QueueDecision = z.enum(["like", "pass", "skip"]).meta({ id: "QueueDecision" });
export type QueueDecision = z.infer<typeof QueueDecision>;

/**
 * What a person chooses on a card, and reads back: a like, a pass, a fish,
 * which is a like with a mark (#378, stored as `like` with `fish`, ADR-039), or
 * a skip, Later on the button, which moves on, costs nobody anything (ADR-062
 * §3) and puts the person on the Later list, the star's (#681, ADR-064).
 */
export const QueueChoice = z.enum(["like", "pass", "fish", "skip"]).meta({ id: "QueueChoice" });
export type QueueChoice = z.infer<typeof QueueChoice>;

const position = z.int().min(1).max(QUEUE_POSITION_MAX);

/** One card of the queue, at its place, with the person's own decision so far. */
export const QueueEntry = z
  .object({
    position,
    reason: QueueReason,
    /** Null while undecided. */
    decision: QueueChoice.nullable(),
    card: ProfileCard,
    /** How far the card's person lives, as it stood when the entry was written (ADR-061 §5). Null on an entry from before distance. */
    distance: DistanceBand.nullable(),
    /** The person's own star on this card's person, by its id (#575, ADR-064); null with none. Nobody else's. */
    star: z.uuid().nullable(),
    /** The deal-breaker a `relaxed` card came in by (#99, ADR-042 §9); absent on every other card. */
    relaxedField: DealBreakerField.optional(),
    /**
     * The person's own deal-breakers, not paused, whose field the card says
     * nothing on, unanswered or hidden alike (#99, ADR-042 §8, #515): "Doesn't
     * say: {field}". Absent on an older API.
     */
    notAnswered: z.array(DealBreakerField).max(DEAL_BREAKERS_CAP).optional(),
  })
  .meta({ id: "QueueEntry" });
export type QueueEntry = z.infer<typeof QueueEntry>;

/**
 * How a person loosens one of their own deal-breakers for the day (#99,
 * ADR-042 §3): let through those who did not answer its field, or set it
 * aside. Mirrors the database's relaxation_kind.
 */
export const RelaxationKind = z.enum(["unanswered", "aside"]).meta({ id: "RelaxationKind" });
export type RelaxationKind = z.infer<typeof RelaxationKind>;

/** One deal-breaker relaxed for today, or to be. */
export const Relaxation = z
  .object({ field: DealBreakerField, kind: RelaxationKind })
  .strict()
  .meta({ id: "Relaxation" });
export type Relaxation = z.infer<typeof Relaxation>;

/**
 * A relaxation a short queue offers (ADR-042 §4), with `more`: how much it
 * widens the person's pool, rounded down to a step of `pond_counter_k` (ADR-015
 * §6), so zero says fewer than a step. Never a count of anything else.
 */
export const RelaxationOffer = Relaxation.extend({ more: z.int().min(0) })
  .strict()
  .meta({ id: "RelaxationOffer" });
export type RelaxationOffer = z.infer<typeof RelaxationOffer>;

/**
 * What a person may relax today and what they have (#99, ADR-042 §4): `short`
 * once no new person is left in the queue (ADR-062 §10); offers only then, each
 * adding somebody today; the relaxations in force, each one tap to undo.
 */
export const RelaxationsResponse = z
  .object({
    short: z.boolean(),
    offers: z.array(RelaxationOffer).max(DEAL_BREAKERS_CAP * 2),
    relaxed: z.array(Relaxation).max(DEAL_BREAKERS_CAP),
  })
  .strict()
  .meta({ id: "RelaxationsResponse" });
export type RelaxationsResponse = z.infer<typeof RelaxationsResponse>;

/** The first cards a relaxation added to the queue, in order, so the phone adds them without a read (ADR-042 §5, ADR-062 §10). */
export const RelaxationAnswer = z
  .object({ entries: z.array(QueueEntry).max(QUEUE_PAGE) })
  .strict()
  .meta({ id: "RelaxationAnswer" });
export type RelaxationAnswer = z.infer<typeof RelaxationAnswer>;

/** A relaxation undone: the places of the cards it added that were still undecided, which leave the queue (ADR-042 §6). */
export const RelaxationUndone = z
  .object({ removed: z.array(position).max(QUEUE_POSITION_MAX) })
  .strict()
  .meta({ id: "RelaxationUndone" });
export type RelaxationUndone = z.infer<typeof RelaxationUndone>;

/** A queue by its day: a day that has ended answers day_ended. */
export const QueueDayParams = z.object({ day: z.iso.date() }).meta({ id: "QueueDayParams" });

/** A relaxation by its queue's day and its deal-breaker's field. */
export const RelaxationParams = z
  .object({ day: z.iso.date(), field: DealBreakerField })
  .meta({ id: "RelaxationParams" });

/**
 * Whether the fish's budget lets the caller send one today (#475, ADR-039
 * §3, §6): one of the week's own, or one their invitations earned waiting
 * (ADR-044 §8). The day's likes, which a fish counts in too, are `likesLeft`'s.
 * The queue offers Send a fish only while it is true and a like is left, or
 * on a card the person already liked (the maintainer's of 01/11/2026, #503),
 * and on the card that holds the fish. Never a count, nor anything of the fish
 * others sent.
 */
const fishToSend = z.boolean();

/**
 * How many of the day's likes the caller has left (#524, ADR-036 §6): from
 * matching_config like_budget_balanced down to zero, by the count the refusal
 * uses, so the screen can say so before the refusal does. Their own number,
 * from their own decisions; nothing about anybody else.
 */
const likesLeft = z.int().min(0);

/**
 * How many conversations are on the caller's turn (ADR-062 §5): at
 * matching_config your_turn_limit a like answers `your_turn_limit`, and the
 * refusal says this number. Their own conversations; nothing about anybody else.
 */
const yourTurn = z.int().min(0);

/**
 * The queue as a read finds it: the Finnish day it is, and the next cards to go
 * through, in order, at most QUEUE_PAGE; null while the person's matching has
 * not opened, and an empty list at the queue's end (ADR-062 §1, §11). A card
 * that cannot be shown now (a block, a sanction, a profile no longer complete,
 * a filter of either side) is left out, so places may skip a number.
 */
export const QueueResponse = z
  .object({
    day: z.iso.date(),
    entries: z.array(QueueEntry).max(QUEUE_PAGE).nullable(),
    fishToSend,
    likesLeft,
    yourTurn,
  })
  .meta({ id: "QueueResponse" });
export type QueueResponse = z.infer<typeof QueueResponse>;

/** An entry by its queue's day and its place: a day that has ended answers day_ended. */
export const QueueEntryParams = z
  .object({ day: z.iso.date(), position: z.coerce.number().int().min(1).max(QUEUE_POSITION_MAX) })
  .meta({ id: "QueueEntryParams" });

/** A like, a pass, a fish or a skip; another one the same day replaces it. */
export const QueueDecisionUpdate = z
  .object({ decision: QueueChoice })
  .strict()
  .meta({ id: "QueueDecisionUpdate" });
export type QueueDecisionUpdate = z.infer<typeof QueueDecisionUpdate>;

/**
 * Where a Later left the card's person (#681, ADR-064 History): on the Later
 * list, `first` when they are the only one it shows, so the phone can say then
 * that only the person sees it; `full` when the list shows matching_config
 * stars_max people, so the card comes back another day as a skip did before;
 * `not_listed` for a card the person was never served, which takes no place
 * (ADR-064 §1). Nothing about anybody else.
 */
export const Later = z.enum(["first", "listed", "full", "not_listed"]).meta({ id: "Later" });
export type Later = z.infer<typeof Later>;

/**
 * The answer to a decision (#100): the conversation the card's like is part
 * of, a match made by this like or before it; null for a pass and for a like
 * that made none. Nothing says whether the other person liked, unless it is a
 * match. `fishToSend` as the queue says it, after this decision: a fish sent
 * may spend the last, one changed to a like or a pass gives it back (#475).
 * `likesLeft` and `yourTurn` likewise, so the screen follows each decision
 * without a read. `later` for a skip, null for any other decision.
 */
export const QueueDecisionAnswer = z
  .object({
    match: z.object({ conversationId: z.uuid() }).strict().nullable(),
    fishToSend,
    likesLeft,
    yourTurn,
    later: Later.nullable(),
  })
  .strict()
  .meta({ id: "QueueDecisionAnswer" });
export type QueueDecisionAnswer = z.infer<typeof QueueDecisionAnswer>;

/**
 * How many stars one person's rows may ever hold, whatever matching_config
 * stars_max says (#575, ADR-064 §5): those left out of the list do not count
 * towards that, so without this a person could keep adding by narrowing their
 * filters. A bound of the contract, as INVITATIONS_OPEN_CAP is, that nobody meets.
 */
export const STARS_CEILING = 100;

/** A star by its id: the caller's own, or nobody's (rule 6). */
export const StarParams = z.object({ id: z.uuid() }).meta({ id: "StarParams" });

/**
 * Somebody the person starred, as the list shows them (#575): the star's id, never
 * the account's, a name and an age, and the main one of the photos the person was
 * shown, whose thumb the phone asks for as any photo's (ADR-008 §3). No count, no
 * time and no word of whoever the list leaves out.
 */
export const StarredPerson = z
  .object({
    id: z.uuid(),
    name: z.string().max(100),
    age: z.int().min(18).max(130),
    photo: z
      .object({ id: z.uuid(), blurhash: z.string().max(100) })
      .strict()
      .nullable(),
  })
  .strict()
  .meta({ id: "StarredPerson" });
export type StarredPerson = z.infer<typeof StarredPerson>;

/** The Later list (#575, ADR-064): those who pass now, by when the person starred them, the latest first, and by nothing else. */
export const StarList = z
  .object({ items: z.array(StarredPerson).max(STARS_CEILING) })
  .strict()
  .meta({ id: "StarList" });
export type StarList = z.infer<typeof StarList>;

/** The person's own stars in their export (ADR-007 §4): when each was put, never on whom. */
export const ExportedStars = exportPart(
  z.array(z.object({ at: z.iso.datetime() })).max(STARS_CEILING),
).meta({ id: "ExportedStars" });
export type ExportedStars = z.infer<typeof ExportedStars>;

/** One card of a queue in the person's own export (ADR-007 §4): never whom, in keys and in words. */
export const ExportedQueueEntry = z
  .object({
    position,
    reason: QueueReason,
    reasonInWords: z.string(),
    /** The deal-breaker a relaxed card came in by (ADR-042 §10), in key and in words; null on every other card. */
    relaxedField: DealBreakerField.nullable(),
    relaxedFieldInWords: z.string().nullable(),
    seenAt: z.iso.datetime().nullable(),
    decision: QueueChoice.nullable(),
    decisionInWords: z.string().nullable(),
    decidedAt: z.iso.datetime().nullable(),
    /** A pass with an earlier pass behind it, which holds a year (ADR-062 §6). */
    secondPass: z.boolean(),
    /** The band the card carried (ADR-061 §5), in key and in words; null on an entry from before #514. */
    distance: DistanceBand.nullable(),
    distanceInWords: z.string().nullable(),
  })
  .meta({ id: "ExportedQueueEntry" });
export type ExportedQueueEntry = z.infer<typeof ExportedQueueEntry>;

/** A deal-breaker the person relaxed for the day (ADR-042 §10), in keys and in words. */
export const ExportedRelaxation = z
  .object({
    field: DealBreakerField,
    fieldInWords: z.string(),
    kind: RelaxationKind,
    kindInWords: z.string(),
    at: z.iso.datetime(),
  })
  .meta({ id: "ExportedRelaxation" });

export const ExportedQueueDay = z
  .object({
    day: z.iso.date(),
    startedAt: z.iso.datetime(),
    relaxations: z.array(ExportedRelaxation).max(DEAL_BREAKERS_CAP),
    entries: z.array(ExportedQueueEntry).max(QUEUE_POSITION_MAX),
  })
  .meta({ id: "ExportedQueueDay" });
export type ExportedQueueDay = z.infer<typeof ExportedQueueDay>;

// The person's own queue days, newest day first, at most 1000.
export const ExportedQueue = exportPart(z.array(ExportedQueueDay).max(1000)).meta({
  id: "ExportedQueue",
});
export type ExportedQueue = z.infer<typeof ExportedQueue>;
