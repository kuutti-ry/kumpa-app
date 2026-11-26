// Public surface of the matching slice in apps/api. Other slices import from here only.
// #46 brings the two hard rows of onboarding; #94 what they mean between two
// people; the queue and its days (#96, #502), the stars (#575) and their
// rules are the rest.

// The anchored like (#463, ADR-077): a part of a card, kept as a reference; the
// chat keeps a match's and draws them as the queue does, the profile reads the parts.
export {
  type AnchorRow,
  anchorColumns,
  anchorOf,
  type CardParts,
  exportedAnchor,
  type PartsOf,
  partOn,
} from "./anchor.ts";
// The queue's builder reads every person's deal-breakers as the person's own read does (#87).
export {
  type DealBreakerRow,
  dealBreakersFrom,
  pausedOf,
  readDealBreakers,
} from "./deal-breakers.ts";
export { bandBetween, inEachOthersPool, type PoolPerson, relaxedBy } from "./pool.ts";
export {
  CHANGE_CADENCE_KEY,
  deletePreferencesOfAccount,
  deleteSeeksOfAccount,
  nextChangeFrom,
  preferencesFrom,
  readPreferences,
  savePreferences,
} from "./preferences.ts";
// The queue and the day's log of it (#96, #502, ADR-034, ADR-062): the routes,
// the one writer, and the halves erasure, the export and the night call.
export {
  addPlaces,
  eraseQueueOf,
  exportQueue,
  // The panel holds the log's clocks to the kept year (#687).
  KEPT_YEAR_KEYS,
  type Place,
  pruneQueueDays,
  QUEUE_RETENTION_DAYS,
  type Queue,
  type RelaxedCandidate,
  relaxationsOf,
} from "./queue.ts";
// The queue's builder (#95, ADR-035) reads across slices and lives with the
// jobs; its order and its one writer are this slice's.
export {
  comingBackOrder,
  likedYouPlaces,
  mayMeet,
  type QueueCandidate,
  queueOrder,
  type Return,
} from "./queue-order.ts";
export { queueRoutes } from "./queue-routes.ts";
export { preferencesRoutes } from "./routes.ts";
// The stars (#575, ADR-064), the Later list since #681: the routes, Later's step
// app.ts hands the queue, and the halves erasure and the export call.
export { starRoutes } from "./star-routes.ts";
export { eraseStarsOf, exportStars, putOnLaterList } from "./stars.ts";
