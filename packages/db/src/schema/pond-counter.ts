import { sql } from "drizzle-orm";
import { boolean, check, date, integer, pgTable, timestamp } from "drizzle-orm/pg-core";

/**
 * The figures the pond counter stands on (#54, ADR-013): one row, written by
 * the nightly job and served, after suppression, by the public
 * `GET /ponds/counter`. The counts are exact and internal; what may be said in
 * public is decided when they are read (`publishCounts` in packages/schema),
 * so a change of k needs no rewrite. The row is replaced only when the pond has
 * moved by at least k (`moveFigures`), and `day` is the Finnish calendar day
 * that happened. `taken_at` is when the accounts were last counted, moved or
 * not: it marks the day that has had its count.
 *
 * One row and no history, on purpose: a series of daily exact counts would
 * say, next to a tombstone's `deleted_at`, which cell lost one that day, which
 * is what erasure removed (TD-7). Aggregates only: no account, no identity,
 * nobody's gender, nothing finer than a day.
 */
export const pondCounter = pgTable(
  "pond_counter",
  {
    // There is one pond, the country, and no row for it (ADR-061 §8, #607): the
    // key is a constant, no uuid, and the check keeps a second row out.
    id: boolean("id").primaryKey().default(true),
    day: date("day", { mode: "string" }).notNull(),
    // The finished profiles (#581). A row written before it stands at zero, which
    // says nothing, and the next count replaces it: it is below the floor.
    finished: integer("finished").notNull().default(0),
    // Finished profiles by whom they seek (#507): moved by their own sum, read only
    // as shares. A row written before them stands at zero, which says nothing.
    seeksMen: integer("seeks_men").notNull().default(0),
    seeksEveryone: integer("seeks_everyone").notNull().default(0),
    seeksWomen: integer("seeks_women").notNull().default(0),
    takenAt: timestamp("taken_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("pond_counter_one_row_check", sql`${table.id}`)],
);
