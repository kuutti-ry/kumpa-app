import type { StarredPerson } from "@kuutti/schema";
import { readPreference, storedObject, writePreference } from "@/lib/preferences";

/**
 * The person's own order of their Later list, given with Kumpa (ADR-064 §6, the
 * maintainer, 26/11/2026): two people of the list at a time, the person picks
 * which, and each newcomer finds their place by halving, as a binary insertion
 * does, so that a list of thirty takes about five picks a person. The order is
 * the person's and stays on this phone: it is never sent, never logged, and it
 * goes when the phone signs out (`LaterOrderAtSignOut`). It holds the list's own
 * ids, which are the stars' and never the accounts' (`StarredPerson`), so an
 * order left by somebody else on a shared phone matches nothing on the next
 * person's list.
 *
 * Progress is kept: a newcomer half placed keeps the range still open for them,
 * and the next Kumpa goes on from there. Whoever has left the list since is left
 * out of the order, and a newcomer whose range they were in starts again.
 */
export type LaterOrder = {
  /** The placed stars, the one put first at the front. */
  order: string[];
  /** The newcomer being placed: their place is somewhere from `lo` to `hi` in `order`. */
  placing: { id: string; lo: number; hi: number } | null;
};

export const NO_ORDER: LaterOrder = { order: [], placing: null };

/** Far above the list's cap (`stars_max`), so that only a broken value reaches it. */
const MOST = 1000;
const ID_MAX = 100;

const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= ID_MAX;

/** What the phone holds, or no order when it holds nothing that reads as one. */
export function readOrder(raw: string | null): LaterOrder {
  const stored = storedObject(raw);
  const order = stored?.order;
  if (!Array.isArray(order) || order.length > MOST || !order.every(isId)) return NO_ORDER;
  if (new Set(order).size !== order.length) return NO_ORDER;
  const placing = stored?.placing;
  if (!placing || typeof placing !== "object" || Array.isArray(placing)) {
    return { order, placing: null };
  }
  const { id, lo, hi } = placing as Record<string, unknown>;
  const open =
    isId(id) &&
    !order.includes(id) &&
    Number.isInteger(lo) &&
    Number.isInteger(hi) &&
    (lo as number) >= 0 &&
    (lo as number) < (hi as number) &&
    (hi as number) <= order.length;
  return { order, placing: open ? { id, lo: lo as number, hi: hi as number } : null };
}

/**
 * The order held against the list as it is now: whoever has left it goes, a
 * newcomer whose range has moved starts again, and when nobody is being placed
 * the next newcomer is, in the list's own order. The first person of an empty
 * order needs no pick and is placed at once.
 */
export function settle(list: readonly string[], saved: LaterOrder): LaterOrder {
  const on = new Set(list);
  const order = saved.order.filter((id) => on.has(id));
  let placing = saved.placing && on.has(saved.placing.id) ? saved.placing : null;
  if (placing !== null && order.length !== saved.order.length) {
    placing = order.length > 0 ? { id: placing.id, lo: 0, hi: order.length } : null;
  }
  if (placing === null) {
    const placed = new Set(order);
    let fresh = list.filter((id) => !placed.has(id));
    const [first, ...rest] = fresh;
    if (order.length === 0 && first !== undefined) {
      order.push(first);
      fresh = rest;
    }
    const [next] = fresh;
    if (next !== undefined) placing = { id: next, lo: 0, hi: order.length };
  }
  return { order, placing };
}

/** The two people Kumpa shows next, the placed one first, or null when the list is in order. */
export function pairOf(state: LaterOrder): [string, string] | null {
  const { placing, order } = state;
  if (placing === null) return null;
  const across = order[Math.floor((placing.lo + placing.hi) / 2)];
  return across === undefined ? null : [across, placing.id];
}

/** The person picked of the pair: the newcomer goes before the other or after them. */
export function choose(state: LaterOrder, picked: string): LaterOrder {
  const { placing, order } = state;
  if (placing === null) return state;
  const middle = Math.floor((placing.lo + placing.hi) / 2);
  let { lo, hi } = placing;
  if (picked === placing.id) hi = middle;
  else if (picked === order[middle]) lo = middle + 1;
  else return state;
  if (lo < hi) return { order, placing: { id: placing.id, lo, hi } };
  return { order: [...order.slice(0, lo), placing.id, ...order.slice(lo)], placing: null };
}

/**
 * The Later list as it shows: in the API's order, the latest first, while the
 * person has put nothing in order; once they have, those who came since at the
 * top in the API's order, each marked as not compared yet, and then the rest in
 * the person's own order.
 */
export function arrange(
  items: readonly StarredPerson[],
  saved: LaterOrder,
): { person: StarredPerson; fresh: boolean }[] {
  const byId = new Map(items.map((person) => [person.id, person]));
  const placed = saved.order.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
  if (placed.length === 0) return items.map((person) => ({ person, fresh: false }));
  const inOrder = new Set(placed.map((person) => person.id));
  return [
    ...items.filter((person) => !inOrder.has(person.id)).map((person) => ({ person, fresh: true })),
    ...placed.map((person) => ({ person, fresh: false })),
  ];
}

export async function readLaterOrder(): Promise<LaterOrder> {
  return readOrder(await readPreference("laterOrder"));
}

/** An order with nobody placed is no order: nothing is kept for it. */
export async function saveLaterOrder(state: LaterOrder): Promise<void> {
  await writePreference("laterOrder", state.order.length > 0 ? JSON.stringify(state) : null);
}

export async function forgetLaterOrder(): Promise<void> {
  await writePreference("laterOrder", null);
}
