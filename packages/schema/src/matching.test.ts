import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { DEAL_BREAKERS_CAP } from "./deal-breakers.ts";
import {
  ExportedQueueEntry,
  ExportedStars,
  Later,
  QUEUE_PAGE,
  QUEUE_POSITION_MAX,
  QueueChoice,
  QueueDayParams,
  QueueDecision,
  QueueDecisionAnswer,
  QueueDecisionUpdate,
  QueueEntry,
  QueueEntryParams,
  QueueResponse,
  Relaxation,
  RelaxationAnswer,
  RelaxationKind,
  RelaxationOffer,
  RelaxationParams,
  RelaxationsResponse,
  RelaxationUndone,
  STARS_CEILING,
  StarList,
  StarParams,
  StarredPerson,
} from "./matching.ts";

// The queue's contracts and its day's log (#96, #502, ADR-034, ADR-062): the
// entry addressed by its day and
// place, the decision, and the read of the next cards, at their boundaries.

const codes = (schema: z.ZodType, input: unknown) =>
  schema.safeParse(input).error?.issues.map((issue) => issue.code) ?? [];

describe("an entry's distance", () => {
  const distance = QueueEntry.shape.distance;

  it.each(["nearby", "close", "around", "far"])("is the band %s", (band) => {
    expect(distance.parse(band)).toBe(band);
  });

  it("is null on an entry from before it, and must be said", () => {
    expect(distance.parse(null)).toBeNull();
    expect(codes(distance, undefined)).toEqual(["invalid_value"]);
  });

  it("is never kilometres", () => {
    expect(codes(distance, 12)).toEqual(["invalid_value"]);
    expect(codes(distance, "12 km")).toEqual(["invalid_value"]);
  });
});

describe("an entry by its day and place", () => {
  it("takes an ISO date and a place from 1 to the column's range, a place given as text", () => {
    expect(QueueEntryParams.parse({ day: "2026-10-19", position: "3" })).toEqual({
      day: "2026-10-19",
      position: 3,
    });
    expect(
      QueueEntryParams.parse({ day: "2026-10-19", position: String(QUEUE_POSITION_MAX) }).position,
    ).toBe(QUEUE_POSITION_MAX);
  });

  it.each([
    ["a day that is no date", { day: "2026-02-30", position: "1" }, "invalid_format"],
    ["a word for the day", { day: "today", position: "1" }, "invalid_format"],
    ["a place of zero", { day: "2026-10-19", position: "0" }, "too_small"],
    [
      "a place past the most",
      { day: "2026-10-19", position: String(QUEUE_POSITION_MAX + 1) },
      "too_big",
    ],
    ["a place in between", { day: "2026-10-19", position: "1.5" }, "invalid_type"],
  ] as const)("refuses %s", (_, input, code) => {
    expect(codes(QueueEntryParams, input)).toEqual([code]);
  });
});

describe("a decision", () => {
  it("is a like, a pass, a fish or a skip and nothing else (ADR-062 §3)", () => {
    for (const decision of ["like", "pass", "fish", "skip"] as const) {
      expect(QueueDecisionUpdate.parse({ decision })).toEqual({ decision });
    }
    expect(codes(QueueDecisionUpdate, { decision: "superlike" })).toEqual(["invalid_value"]);
    expect(codes(QueueDecisionUpdate, {})).toEqual(["invalid_value"]);
    expect(codes(QueueDecisionUpdate, { decision: "like", note: "x" })).toEqual([
      "unrecognized_keys",
    ]);
  });
});

describe("the answer to a decision", () => {
  it("names a match or none, and says whether a fish can still go (#475) and whose turn waits (ADR-062 §5)", () => {
    const match = { conversationId: "7d8f3c2a-1b4e-4c6d-9e0f-2a3b4c5d6e7f" };
    const made = { match, fishToSend: false, likesLeft: 0, yourTurn: 8, later: null };
    expect(QueueDecisionAnswer.parse(made)).toEqual(made);
    const none = { match: null, fishToSend: true, likesLeft: 7, yourTurn: 0, later: null };
    expect(QueueDecisionAnswer.parse(none)).toEqual(none);
  });

  it("says where a Later left the person (#681)", () => {
    const later = { match: null, fishToSend: true, likesLeft: 7, yourTurn: 0, later: "full" };
    expect(QueueDecisionAnswer.parse(later)).toEqual(later);
  });

  const answer = { match: null, fishToSend: true, likesLeft: 7, yourTurn: 0, later: null };

  it.each([
    ["no word on the fish", { ...answer, fishToSend: undefined }, "invalid_type"],
    ["the fish as a count", { ...answer, fishToSend: 1 }, "invalid_type"],
    ["no word on the likes", { ...answer, likesLeft: undefined }, "invalid_type"],
    ["the likes below zero", { ...answer, likesLeft: -1 }, "too_small"],
    ["the likes in part", { ...answer, likesLeft: 1.5 }, "invalid_type"],
    ["no word on the turn", { ...answer, yourTurn: undefined }, "invalid_type"],
    ["the turn below zero", { ...answer, yourTurn: -1 }, "too_small"],
    ["the turn in part", { ...answer, yourTurn: 1.5 }, "invalid_type"],
    ["the turn as a flag", { ...answer, yourTurn: true }, "invalid_type"],
    ["no word on Later", { ...answer, later: undefined }, "invalid_value"],
    ["Later as a flag", { ...answer, later: true }, "invalid_value"],
    ["anything else", { ...answer, liked: true }, "unrecognized_keys"],
  ] as const)("refuses %s", (_, input, code) => {
    expect(codes(QueueDecisionAnswer, input)).toEqual([code]);
  });
});

describe("the next cards of the queue", () => {
  const read = {
    day: "2026-10-19",
    entries: null,
    fishToSend: true,
    likesLeft: 10,
    yourTurn: 0,
  };

  it("names its day, null before matching opens and an empty list at the queue's end (ADR-062 §1)", () => {
    expect(QueueResponse.parse(read)).toEqual(read);
    expect(QueueResponse.parse({ ...read, entries: [] }).entries).toEqual([]);
    expect(codes(QueueResponse, { ...read, entries: undefined })).toEqual(["invalid_type"]);
  });

  it("says whether a fish can go today, never how many (#475)", () => {
    expect(codes(QueueResponse, { ...read, fishToSend: undefined })).toEqual(["invalid_type"]);
    expect(codes(QueueResponse, { ...read, fishToSend: 0 })).toEqual(["invalid_type"]);
  });

  it.each([
    ["no word on them", undefined, "invalid_type"],
    ["below zero", -1, "too_small"],
    ["in part", 1.5, "invalid_type"],
    ["as a flag", true, "invalid_type"],
  ] as const)(
    "refuses the conversations on the caller's turn %s (ADR-062 §5)",
    (_, yourTurn, code) => {
      expect(codes(QueueResponse, { ...read, yourTurn })).toEqual([code]);
    },
  );

  it.each([
    ["no word on them", undefined, "invalid_type"],
    ["below zero", -1, "too_small"],
    ["in part", 1.5, "invalid_type"],
    ["in words", "ten", "invalid_type"],
  ] as const)("refuses the likes left %s (#524)", (_, likesLeft, code) => {
    expect(codes(QueueResponse, { ...read, likesLeft })).toEqual([code]);
  });

  it("hands over a page at most, and a page is ten (ADR-062 §15)", () => {
    expect(QUEUE_PAGE).toBe(10);
    const tooMany = Array.from({ length: QUEUE_PAGE + 1 }, () => ({}));
    expect(codes(QueueResponse, { ...read, entries: tooMany })).toContain("too_big");
  });
});

describe("a star (#575, ADR-064)", () => {
  const id = "7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01";
  const person = { id, name: "Katja", age: 44, photo: null };

  it("on an entry is its id or null, and must be said", () => {
    const star = QueueEntry.shape.star;
    expect(star.parse(id)).toBe(id);
    expect(star.parse(null)).toBeNull();
    expect(codes(star, undefined)).toEqual(["invalid_type"]);
    expect(codes(star, "not-a-uuid")).toEqual(["invalid_format"]);
  });

  it("put by Later says where it left the person, and nothing else", () => {
    for (const later of ["first", "listed", "full", "not_listed"] as const) {
      expect(Later.parse(later)).toBe(later);
    }
    expect(codes(Later, "starred")).toEqual(["invalid_value"]);
    expect(codes(Later, 3)).toEqual(["invalid_value"]);
  });

  it("is addressed by its own id", () => {
    expect(StarParams.parse({ id })).toEqual({ id });
    expect(codes(StarParams, { id: "not-a-uuid" })).toEqual(["invalid_format"]);
    expect(codes(StarParams, {})).toEqual(["invalid_type"]);
  });

  it("on the list is a name, an age and perhaps a photo, and nothing else about anybody", () => {
    const photo = { id, blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" };
    expect(StarredPerson.parse({ ...person, photo })).toEqual({ ...person, photo });
    expect(StarredPerson.parse(person)).toEqual(person);
    expect(codes(StarredPerson, { ...person, accountId: id })).toEqual(["unrecognized_keys"]);
    expect(codes(StarredPerson, { ...person, starredAt: "x" })).toEqual(["unrecognized_keys"]);
    expect(codes(StarredPerson, { ...person, age: 17 })).toEqual(["too_small"]);
    expect(codes(StarredPerson, { ...person, photo: { ...photo, url: "x" } })).toEqual([
      "unrecognized_keys",
    ]);
  });

  it("holds the list to the contract's ceiling, one past it refused", () => {
    const at = (length: number) => ({ items: Array.from({ length }, () => person) });
    expect(StarList.parse(at(STARS_CEILING)).items).toHaveLength(STARS_CEILING);
    expect(codes(StarList, at(STARS_CEILING + 1))).toEqual(["too_big"]);
    expect(codes(StarList, { items: [], count: 0 })).toEqual(["unrecognized_keys"]);
  });

  it("in the export says when, and holds nothing else of use", () => {
    const at = "2026-11-03T10:00:00.000Z";
    expect(ExportedStars.parse({ about: "x", items: [{ at }] }).items).toEqual([{ at }]);
    // Zod strips what the contract does not name, so a person's id could not pass through.
    expect(ExportedStars.parse({ about: "x", items: [{ at, candidateId: id }] }).items).toEqual([
      { at },
    ]);
    expect(codes(ExportedStars, { about: "x", items: [{ at: "yesterday" }] })).toEqual([
      "invalid_format",
    ]);
  });
});

describe("what a person does with a card", () => {
  it("is a like, a pass or a skip as stored, and a fish as chosen (ADR-062 §3)", () => {
    expect(QueueDecision.options).toEqual(["like", "pass", "skip"]);
    expect(QueueChoice.options).toEqual(["like", "pass", "fish", "skip"]);
  });
});

describe("relaxing a deal-breaker for the day (#99, ADR-042)", () => {
  it("has two ways, closed", () => {
    expect(RelaxationKind.options).toEqual(["unanswered", "aside"]);
  });

  it("takes a deal-breaker field and a way, and nothing else", () => {
    expect(Relaxation.parse({ field: "smoking", kind: "aside" })).toEqual({
      field: "smoking",
      kind: "aside",
    });
    expect(codes(Relaxation, { field: "intent", kind: "aside" })).toEqual(["invalid_value"]);
    expect(codes(Relaxation, { field: "smoking", kind: "widen" })).toEqual(["invalid_value"]);
    expect(codes(Relaxation, { field: "smoking", kind: "aside", note: "x" })).toEqual([
      "unrecognized_keys",
    ]);
  });

  it("offers a figure of the pool, whole and never negative", () => {
    expect(RelaxationOffer.parse({ field: "smoking", kind: "aside", more: 20 }).more).toBe(20);
    expect(codes(RelaxationOffer, { field: "smoking", kind: "aside", more: -10 })).toEqual([
      "too_small",
    ]);
    expect(codes(RelaxationOffer, { field: "smoking", kind: "aside", more: 2.5 })).toEqual([
      "invalid_type",
    ]);
  });

  it("answers what is offered and what is relaxed, bounded by the deal-breakers' ceiling", () => {
    const offer = { field: "smoking", kind: "aside", more: 0 } as const;
    expect(RelaxationsResponse.parse({ short: true, offers: [offer], relaxed: [] }).offers).toEqual(
      [offer],
    );
    const each = Array(DEAL_BREAKERS_CAP * 2).fill(offer);
    expect(codes(RelaxationsResponse, { short: true, offers: each, relaxed: [] })).toEqual([]);
    expect(
      codes(RelaxationsResponse, { short: true, offers: [...each, offer], relaxed: [] }),
    ).toEqual(["too_big"]);
    expect(codes(RelaxationsResponse, { short: true, offers: [], relaxed: [], count: 3 })).toEqual([
      "unrecognized_keys",
    ]);
  });

  it("answers the first cards added, a page at most, and the places undone (ADR-062 §10)", () => {
    expect(RelaxationAnswer.parse({ entries: [] })).toEqual({ entries: [] });
    const tooMany = Array.from({ length: QUEUE_PAGE + 1 }, () => ({}));
    expect(codes(RelaxationAnswer, { entries: tooMany })).toContain("too_big");
    expect(RelaxationUndone.parse({ removed: [2, 3] })).toEqual({ removed: [2, 3] });
    expect(codes(RelaxationUndone, { removed: [0] })).toEqual(["too_small"]);
    expect(codes(RelaxationUndone, { removed: [QUEUE_POSITION_MAX + 1] })).toEqual(["too_big"]);
  });

  it("addresses a relaxation by its queue's day and its field", () => {
    expect(RelaxationParams.parse({ day: "2026-10-21", field: "languages" })).toEqual({
      day: "2026-10-21",
      field: "languages",
    });
    expect(codes(RelaxationParams, { day: "21.10.2026", field: "smoking" })).toEqual([
      "invalid_format",
    ]);
    expect(codes(QueueDayParams, { day: "2026-13-01" })).toEqual(["invalid_format"]);
  });

  it("lets a card carry the field it came in by and who did not answer, or neither, as an older API sends it", () => {
    const card = QueueEntry.shape.card;
    const base = { position: 1, reason: "relaxed", decision: null, distance: null, star: null };
    expect(QueueEntry.shape.relaxedField.safeParse(undefined).success).toBe(true);
    expect(QueueEntry.shape.notAnswered.safeParse(["smoking", "languages"]).success).toBe(true);
    expect(QueueEntry.shape.notAnswered.safeParse(["intent"]).success).toBe(false);
    expect(card).toBeDefined();
    expect(codes(QueueEntry.omit({ card: true }), { ...base, relaxedField: "nicotine" })).toEqual([
      "invalid_value",
    ]);
  });

  it("names the relaxed field in the export, or nothing", () => {
    const entry = {
      position: 1,
      reason: "relaxed",
      reasonInWords: "There because you relaxed a filter",
      relaxedField: "smoking",
      relaxedFieldInWords: "Smoking",
      seenAt: null,
      decision: null,
      decisionInWords: null,
      decidedAt: null,
      secondPass: false,
      distance: "nearby",
      distanceInWords: "Nearby",
    };
    expect(ExportedQueueEntry.parse(entry).relaxedField).toBe("smoking");
    // Null on an entry from before the band; never a number, nor a word of no band.
    expect(
      ExportedQueueEntry.parse({ ...entry, distance: null, distanceInWords: null }).distance,
    ).toBeNull();
    expect(ExportedQueueEntry.safeParse({ ...entry, distance: 4 }).success).toBe(false);
    expect(ExportedQueueEntry.safeParse({ ...entry, distance: "next door" }).success).toBe(false);
    expect(
      ExportedQueueEntry.parse({ ...entry, relaxedField: null, relaxedFieldInWords: null })
        .relaxedField,
    ).toBeNull();
    expect(codes(ExportedQueueEntry, { ...entry, relaxedField: undefined })).toEqual([
      "invalid_value",
    ]);
  });

  it("says a skip and a second pass in the export (ADR-062 §3, §6)", () => {
    const entry = {
      position: 3,
      reason: "matches_filters",
      reasonInWords: "Fits what you seek",
      relaxedField: null,
      relaxedFieldInWords: null,
      seenAt: null,
      decision: "skip",
      decisionInWords: "Later",
      decidedAt: "2026-10-19T09:00:00.000Z",
      secondPass: false,
      distance: null,
      distanceInWords: null,
    };
    expect(ExportedQueueEntry.parse(entry).decision).toBe("skip");
    const second = { ...entry, decision: "pass", decisionInWords: "Pass", secondPass: true };
    expect(ExportedQueueEntry.parse(second).secondPass).toBe(true);
    expect(codes(ExportedQueueEntry, { ...entry, secondPass: undefined })).toEqual([
      "invalid_type",
    ]);
    expect(codes(ExportedQueueEntry, { ...entry, secondPass: 1 })).toEqual(["invalid_type"]);
  });
});
