import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { QueueDecisionAnswer, ServerFrame, StarList } from "@kuutti/schema";
import fc from "fast-check";
import { readAnswer, readAnswerSafely } from "./answer";

// A build on a phone is older than the API it talks to (#745): a key the API
// added since is left out, at any depth, and anything else outside the
// contract fails as the contract's own parse says.

const PERSON = "6f1d1b2e-8a3c-4e5f-9a7b-1c2d3e4f5a6b";
const PHOTO = "0b9c8d7e-6f5a-4b3c-8d2e-1f0a9b8c7d6e";
const CONVERSATION = "3a4b5c6d-7e8f-4a1b-9c2d-3e4f5a6b7c8d";

const STARS = {
  items: [
    { id: PERSON, name: "Henna", age: 31, photo: { id: PHOTO, blurhash: "LEHV6nWB2yk8" } },
    { id: PHOTO, name: "Katja", age: 29, photo: null },
  ],
};
const DECISION = {
  match: { conversationId: CONVERSATION },
  fishToSend: true,
  likesLeft: 9,
  yourTurn: 0,
};

describe("readAnswer", () => {
  it("reads an answer within its contract as the contract's parse does", () => {
    expect(readAnswer(StarList, STARS)).toEqual(StarList.parse(STARS));
    expect(readAnswer(QueueDecisionAnswer, DECISION)).toEqual(QueueDecisionAnswer.parse(DECISION));
  });

  it.each([
    ["at the top", { ...DECISION, sooner: "2026-12-01" }, QueueDecisionAnswer, DECISION],
    [
      "in a nullable object",
      { ...DECISION, match: { conversationId: CONVERSATION, firstLine: null } },
      QueueDecisionAnswer,
      DECISION,
    ],
    [
      "in an array's element and in the object inside it",
      {
        items: [
          { ...STARS.items[0], pronouns: "she", photo: { ...STARS.items[0]?.photo, width: 800 } },
          STARS.items[1],
        ],
      },
      StarList,
      STARS,
    ],
  ] as const)("leaves out a key this build does not know %s", (_where, sent, contract, known) => {
    expect(readAnswer(contract as typeof StarList, sent)).toEqual(
      (contract as typeof StarList).parse(known),
    );
  });

  it("leaves out a key a frame's own kind does not know, in a discriminated union", () => {
    const frame = { type: "read", conversationId: CONVERSATION, upTo: 4, at: "now" };
    expect(readAnswerSafely(ServerFrame, frame)).toEqual({
      success: true,
      data: { type: "read", conversationId: CONVERSATION, upTo: 4 },
    });
  });

  it("changes nothing of the answer it was given", () => {
    const sent = { items: [{ ...STARS.items[0], pronouns: "she" }] };
    const copy = structuredClone(sent);
    readAnswer(StarList, sent);
    expect(sent).toEqual(copy);
  });

  // JSON.parse makes "__proto__" a key of the object's own, never its prototype: it is left out
  // like any key this build does not know, and no object gains what it carried.
  it("leaves out a key named __proto__ and changes no prototype", () => {
    const person = `{"id":"${PERSON}","name":"Henna","age":31,"photo":null,"__proto__":{"polluted":1}}`;
    const sent = JSON.parse(`{"items":[${person}],"__proto__":{"polluted":1}}`);
    const read = readAnswer(StarList, sent);
    expect(read).toEqual({ items: [{ id: PERSON, name: "Henna", age: 31, photo: null }] });
    expect(Object.keys(read)).toEqual(["items"]);
    expect(Object.keys(read.items[0] ?? {}).sort()).toEqual(["age", "id", "name", "photo"]);
    expect(Object.getPrototypeOf(read)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(read.items[0])).toBe(Object.prototype);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("fails as the contract's parse does when something else is outside it too", () => {
    const sent = { ...DECISION, likesLeft: -1, sooner: "2026-12-01" };
    expect(() => readAnswer(QueueDecisionAnswer, sent)).toThrow(
      QueueDecisionAnswer.safeParse(sent).error,
    );
    expect(readAnswerSafely(QueueDecisionAnswer, sent)).toEqual(
      QueueDecisionAnswer.safeParse(sent),
    );
  });

  it.each([
    ["a frame of a kind this build does not know", ServerFrame, { type: "shout", text: "hi" }],
    ["a known key's value of the wrong type", StarList, { items: "Henna" }],
    ["no answer at all", StarList, null],
  ] as const)("fails on %s", (_what, contract, sent) => {
    expect(readAnswerSafely(contract as typeof StarList, sent).success).toBe(false);
  });

  it("reads an answer with keys added anywhere in it as the answer without them", () => {
    // Every object in the answer, by its path, for a newer API to add a key to.
    const objects = (value: unknown, path: PropertyKey[] = []): PropertyKey[][] =>
      typeof value !== "object" || value === null
        ? []
        : [
            ...(Array.isArray(value) ? [] : [path]),
            ...Object.entries(value).flatMap(([key, inner]) =>
              objects(inner, [...path, Array.isArray(value) ? Number(key) : key]),
            ),
          ];
    const added = (value: unknown, path: PropertyKey[], key: string, extra: unknown): unknown => {
      if (path.length === 0) return { ...(value as object), [key]: extra };
      const [step, ...rest] = path;
      if (Array.isArray(value)) {
        return value.map((item, index) => (index === step ? added(item, rest, key, extra) : item));
      }
      const record = value as Record<PropertyKey, unknown>;
      return {
        ...record,
        [step as PropertyKey]: added(record[step as PropertyKey], rest, key, extra),
      };
    };
    const places = objects(STARS);
    const known = new Set(["items", "id", "name", "age", "photo", "blurhash"]);
    const addition = fc.record({
      at: fc.nat({ max: places.length - 1 }),
      key: fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((key) => !known.has(key) && key !== "__proto__"),
      extra: fc.jsonValue(),
    });
    fc.assert(
      fc.property(fc.array(addition, { minLength: 1, maxLength: 6 }), (additions) => {
        const sent = additions.reduce<unknown>(
          (value, { at, key, extra }) => added(value, places[at] ?? [], key, extra),
          STARS,
        );
        expect(readAnswer(StarList, sent)).toEqual(StarList.parse(STARS));
      }),
      { seed: 745, numRuns: 300 },
    );
  });
});

describe("the app's code", () => {
  // Every answer goes through the reader: a contract's own parse fails on a key
  // a newer API added, which is what broke 0.127.0's Like and Pass (#745).
  it("reads no answer with a contract's own parse", () => {
    const root = join(__dirname, "..", "..");
    const files = ["src", "app"].flatMap((top) =>
      readdirSync(join(root, top), { recursive: true, encoding: "utf8" })
        .filter(
          (file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && !file.includes("test/"),
        )
        .map((file) => join(root, top, file)),
    );
    const parses = files.flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) =>
          /\b(?!JSON\b)[A-Z]\w*\.parse\(/.test(line)
            ? [`${relative(root, file)}:${index + 1}`]
            : [],
        ),
    );
    expect(parses).toEqual([]);
  });
});
