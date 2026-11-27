import type { StarredPerson } from "@kuutti/schema";
import * as SecureStore from "expo-secure-store";
import fc from "fast-check";
import {
  arrange,
  choose,
  forgetLaterOrder,
  type LaterOrder,
  NO_ORDER,
  pairOf,
  readLaterOrder,
  readOrder,
  saveLaterOrder,
  settle,
} from "./later-order";

// Kumpa's order (ADR-064 §6, the maintainer, 26/11/2026): what the phone holds and
// how it is read back, the order held against the list as it is now, a pick, the
// list as it shows, and the whole run, which puts any list in the order the picks
// give it, by halving, and goes on where it stopped. The screens are
// KumpaScreen.test.tsx's and StarredScreen.test.tsx's.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = "kuutti.preference.laterOrder";

const person = (id: string): StarredPerson => ({ id, name: id, age: 30, photo: null });

/** Kumpa run over a list, each pick the one ranked first, up to `picks` picks. */
function run(
  list: readonly string[],
  rank: (id: string) => number,
  saved: LaterOrder = NO_ORDER,
  most = Number.POSITIVE_INFINITY,
) {
  let state = settle(list, saved);
  let picks = 0;
  for (let pair = pairOf(state); pair !== null && picks < most; pair = pairOf(state)) {
    const [placed, newcomer] = pair;
    state = settle(list, choose(state, rank(placed) < rank(newcomer) ? placed : newcomer));
    picks += 1;
  }
  return { state, picks };
}

/** At most this many picks place the k-th newcomer among k - 1: a binary insertion's. */
const mostPicks = (n: number) => {
  let sum = 0;
  for (let placed = 1; placed < n; placed += 1) sum += Math.ceil(Math.log2(placed + 1));
  return sum;
};

beforeEach(() => store.clear());

describe("what the phone holds", () => {
  it("reads an order and the newcomer being placed", () => {
    const held = { order: ["a", "b", "c"], placing: { id: "d", lo: 1, hi: 3 } };
    expect(readOrder(JSON.stringify(held))).toEqual(held);
    expect(readOrder(JSON.stringify({ order: ["a"], placing: null }))).toEqual({
      order: ["a"],
      placing: null,
    });
  });

  it.each([
    ["nothing", null],
    ["no words", ""],
    ["words that are no JSON", "{order"],
    ["a list", JSON.stringify(["a", "b"])],
    ["a number", "3"],
    ["JSON's null", "null"],
    ["no order", JSON.stringify({ placing: null })],
    ["an order that is no list", JSON.stringify({ order: "a,b" })],
    ["an id that is no string", JSON.stringify({ order: ["a", 2] })],
    ["an empty id", JSON.stringify({ order: ["a", ""] })],
    ["an id past a hundred characters", JSON.stringify({ order: ["a", "x".repeat(101)] })],
    ["the same id twice", JSON.stringify({ order: ["a", "b", "a"] })],
    [
      "more than a thousand ids",
      JSON.stringify({ order: Array.from({ length: 1001 }, (_, i) => `s${i}`) }),
    ],
  ])("reads no order from %s", (_, raw) => {
    expect(readOrder(raw)).toEqual(NO_ORDER);
  });

  it("reads an id of a hundred characters and an order of a thousand", () => {
    const long = "x".repeat(100);
    expect(readOrder(JSON.stringify({ order: [long] })).order).toEqual([long]);
    const many = Array.from({ length: 1000 }, (_, i) => `s${i}`);
    expect(readOrder(JSON.stringify({ order: many })).order).toEqual(many);
  });

  it.each([
    ["a list", ["d", 0, 1]],
    ["a newcomer already placed", { id: "b", lo: 0, hi: 1 }],
    ["an id that is no string", { id: 4, lo: 0, hi: 1 }],
    ["an empty id", { id: "", lo: 0, hi: 1 }],
    ["a bound that is no whole number", { id: "d", lo: 0.5, hi: 1 }],
    ["a bound that is no number", { id: "d", lo: "0", hi: 1 }],
    ["a low bound under nought", { id: "d", lo: -1, hi: 1 }],
    ["a range with no room", { id: "d", lo: 1, hi: 1 }],
    ["a range turned round", { id: "d", lo: 2, hi: 1 }],
    ["a high bound past the order", { id: "d", lo: 0, hi: 3 }],
  ])("keeps the order and drops a newcomer's range that is %s", (_, placing) => {
    expect(readOrder(JSON.stringify({ order: ["a", "b"], placing }))).toEqual({
      order: ["a", "b"],
      placing: null,
    });
  });

  it("reads a range that runs to the end of the order", () => {
    expect(
      readOrder(JSON.stringify({ order: ["a", "b"], placing: { id: "d", lo: 0, hi: 2 } })).placing,
    ).toEqual({ id: "d", lo: 0, hi: 2 });
  });

  it("reads whatever the phone holds as an order it can use, and never throws", () => {
    const shaped = fc.record({
      order: fc.oneof(fc.array(fc.string({ maxLength: 4 }), { maxLength: 6 }), fc.jsonValue()),
      placing: fc.oneof(
        fc.record({ id: fc.string({ maxLength: 4 }), lo: fc.integer(), hi: fc.integer() }),
        fc.jsonValue(),
      ),
    });
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.jsonValue().map((v) => JSON.stringify(v)),
          shaped.map((v) => JSON.stringify(v)),
        ),
        (raw) => {
          const { order, placing } = readOrder(raw);
          expect(new Set(order).size).toBe(order.length);
          expect(order.every((id) => typeof id === "string" && id.length > 0)).toBe(true);
          if (placing !== null) {
            expect(order).not.toContain(placing.id);
            expect(0 <= placing.lo && placing.lo < placing.hi && placing.hi <= order.length).toBe(
              true,
            );
          }
        },
      ),
      { seed: 26112026, numRuns: 400 },
    );
  });
});

describe("the order held against the list", () => {
  it("places the first person without a pick and shows the second beside them", () => {
    const state = settle(["a", "b", "c"], NO_ORDER);
    expect(state).toEqual({ order: ["a"], placing: { id: "b", lo: 0, hi: 1 } });
    expect(pairOf(state)).toEqual(["a", "b"]);
  });

  it("puts a list of one in order at once, and has nothing to show for an empty one", () => {
    expect(settle(["a"], NO_ORDER)).toEqual({ order: ["a"], placing: null });
    expect(pairOf(settle(["a"], NO_ORDER))).toBeNull();
    expect(settle([], NO_ORDER)).toEqual(NO_ORDER);
    expect(pairOf(NO_ORDER)).toBeNull();
  });

  it("keeps a newcomer's range while nobody has left", () => {
    const saved = { order: ["a", "b", "c"], placing: { id: "d", lo: 2, hi: 3 } };
    expect(settle(["e", "d", "a", "b", "c"], saved)).toEqual(saved);
  });

  it("leaves out whoever has left the list, and starts the newcomer's range again", () => {
    const saved = { order: ["a", "b", "c"], placing: { id: "d", lo: 2, hi: 3 } };
    expect(settle(["d", "a", "c"], saved)).toEqual({
      order: ["a", "c"],
      placing: { id: "d", lo: 0, hi: 2 },
    });
  });

  it("drops a newcomer who has left, and takes the next one in the list's order", () => {
    const saved = { order: ["a", "b"], placing: { id: "c", lo: 0, hi: 2 } };
    expect(settle(["e", "d", "a", "b"], saved)).toEqual({
      order: ["a", "b"],
      placing: { id: "e", lo: 0, hi: 2 },
    });
  });

  it("starts afresh once everybody in the order has left, the list's first placed at once", () => {
    const saved = { order: ["a"], placing: { id: "b", lo: 0, hi: 1 } };
    expect(settle(["c", "b"], saved)).toEqual({
      order: ["c"],
      placing: { id: "b", lo: 0, hi: 1 },
    });
  });

  it("has nobody to place once everybody on the list has a place", () => {
    expect(settle(["b", "a"], { order: ["a", "b"], placing: null })).toEqual({
      order: ["a", "b"],
      placing: null,
    });
  });
});

describe("a pick", () => {
  const two = settle(["a", "b"], NO_ORDER);

  it("puts the newcomer picked before the other, and after the other when the other is picked", () => {
    expect(choose(two, "b")).toEqual({ order: ["b", "a"], placing: null });
    expect(choose(two, "a")).toEqual({ order: ["a", "b"], placing: null });
  });

  it("halves the newcomer's range until it holds one place", () => {
    const five = { order: ["a", "b", "c", "d"], placing: { id: "e", lo: 0, hi: 4 } };
    expect(pairOf(five)).toEqual(["c", "e"]);
    const before = choose(five, "e");
    expect(before).toEqual({ order: five.order, placing: { id: "e", lo: 0, hi: 2 } });
    expect(pairOf(before)).toEqual(["b", "e"]);
    expect(choose(before, "b")).toEqual({ order: ["a", "b", "e", "c", "d"], placing: null });
    const after = choose(five, "c");
    expect(after).toEqual({ order: five.order, placing: { id: "e", lo: 3, hi: 4 } });
    expect(choose(after, "d")).toEqual({ order: ["a", "b", "c", "d", "e"], placing: null });
  });

  it("changes nothing for somebody not of the pair, or with nobody being placed", () => {
    expect(choose(two, "c")).toBe(two);
    const done = { order: ["a", "b"], placing: null };
    expect(choose(done, "a")).toBe(done);
  });
});

describe("the list as it shows", () => {
  const items = ["e", "d", "c", "b", "a"].map(person);
  const ids = (rows: ReturnType<typeof arrange>) =>
    rows.map(({ person, fresh }) => `${person.id}${fresh ? "*" : ""}`);

  it("is the API's order while nothing is in order, with nobody marked", () => {
    expect(ids(arrange(items, NO_ORDER))).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("puts whoever came since at the top, marked, then the rest in the person's order", () => {
    const saved = { order: ["a", "c", "b"], placing: { id: "d", lo: 0, hi: 3 } };
    expect(ids(arrange(items, saved))).toEqual(["e*", "d*", "a", "c", "b"]);
  });

  it("leaves out of the order whoever has left the list, and an order of nobody on it is none", () => {
    expect(ids(arrange(items, { order: ["x", "b", "y"], placing: null }))).toEqual([
      "e*",
      "d*",
      "c*",
      "a*",
      "b",
    ]);
    expect(ids(arrange(items, { order: ["x", "y"], placing: null }))).toEqual([
      "e",
      "d",
      "c",
      "b",
      "a",
    ]);
  });

  it("shows everybody on the list once, whatever the phone holds", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "e", "f"), { maxLength: 6 }),
        fc.uniqueArray(fc.constantFrom("a", "b", "c", "d", "x", "y"), { maxLength: 6 }),
        (list, order) => {
          const shown = arrange(list.map(person), { order, placing: null }).map(
            (row) => row.person.id,
          );
          expect([...shown].sort()).toEqual([...list].sort());
        },
      ),
      { seed: 575, numRuns: 300 },
    );
  });
});

describe("a whole Kumpa", () => {
  const ranked = fc
    .uniqueArray(fc.uuid(), { maxLength: 30 })
    .chain((list) =>
      fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length })),
    );

  it("puts any list in the order the picks give it, in no more picks than halving takes", () => {
    fc.assert(
      fc.property(ranked, ([list, wanted]) => {
        const { state, picks } = run(list, (id) => wanted.indexOf(id));
        expect(state).toEqual({ order: wanted, placing: null });
        expect(picks).toBeLessThanOrEqual(mostPicks(list.length));
      }),
      { seed: 2611, numRuns: 300 },
    );
  });

  it("goes on where it stopped, from what the phone held, and ends the same", () => {
    fc.assert(
      fc.property(ranked, fc.nat({ max: 200 }), ([list, wanted], stop) => {
        const rank = (id: string) => wanted.indexOf(id);
        const whole = run(list, rank);
        const first = run(list, rank, NO_ORDER, stop);
        const held = readOrder(JSON.stringify(first.state));
        const rest = run(list, rank, held);
        expect(rest.state).toEqual(whole.state);
        expect(first.picks + rest.picks).toBe(whole.picks);
      }),
      { seed: 2612, numRuns: 300 },
    );
  });

  it("places a newcomer among those already in order, the rest kept as they were", () => {
    const { state } = run(["n", "a", "b", "c"], (id) => ["a", "n", "b", "c"].indexOf(id), {
      order: ["a", "b", "c"],
      placing: null,
    });
    expect(state.order).toEqual(["a", "n", "b", "c"]);
  });
});

describe("on the phone", () => {
  it("keeps an order and reads it back", async () => {
    const state = { order: ["a", "b"], placing: { id: "c", lo: 0, hi: 2 } };
    await saveLaterOrder(state);
    expect(JSON.parse(store.get(KEY) ?? "null")).toEqual(state);
    await expect(readLaterOrder()).resolves.toEqual(state);
  });

  it("keeps nothing for an order with nobody placed, and forgets one it kept", async () => {
    await saveLaterOrder({ order: ["a"], placing: null });
    await saveLaterOrder(NO_ORDER);
    expect(store.has(KEY)).toBe(false);
    await saveLaterOrder({ order: ["a"], placing: null });
    await forgetLaterOrder();
    expect(store.has(KEY)).toBe(false);
    await expect(readLaterOrder()).resolves.toEqual(NO_ORDER);
  });
});
