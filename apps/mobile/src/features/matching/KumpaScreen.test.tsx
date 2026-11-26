import type { StarredPerson } from "@kuutti/schema";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { getRandomValues } from "expo-crypto";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, Dimensions, StyleSheet } from "react-native";
import { clearSession, saveSession } from "@/lib/session";
import { noProblems } from "@/test/a11y";
import { FAILED_TO_LOAD } from "@/test/failed";
import { textsInOrder as said } from "@/test/layout";
import { renderWithTheme } from "@/test/render";
import { KumpaScreen } from "./KumpaScreen";

// Kumpa on the phone (ADR-064 §6, the maintainer, 26/11/2026): two people of the
// Later list, one under the other on a window higher than it is wide and side by
// side on one wider, which of the two comes first drawn for each pair, each with
// the main photo they were shown in the card's shape, a tap that puts that one
// first and the order kept on the phone, the next pair, the line once the list is
// in order with the way back and Start again, the order taken up where it
// stopped, and what it says while it loads, fails or has nobody. The order's own
// rules are later-order.test.ts's; the list it gives is StarredScreen.test.tsx's.

const { __router: router } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; back: jest.Mock; replace: jest.Mock };
};

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = "kuutti.preference.laterOrder";

/** The system's generator gives this side every time: 0 shows a pair as the order has it, 1 turned round. */
const random = jest.mocked(getRandomValues);
const toss = (side: 0 | 1) =>
  random.mockImplementation((array) => {
    new Uint8Array(array.buffer).fill(side);
    return array;
  });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (code: string, status: number) =>
  json({ error: { code, message: "x", requestId: "r" } }, status);
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);

const HENNA: StarredPerson = {
  id: "7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01",
  name: "Henna",
  age: 31,
  photo: { id: "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01", blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" },
};
const KATJA: StarredPerson = {
  id: "7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a02",
  name: "Katja",
  age: 44,
  photo: null,
};
const MINNA: StarredPerson = {
  id: "7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a03",
  name: "Minna",
  age: 28,
  photo: { id: "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a03", blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj" },
};

type Call = { method: string; path: string };

function api(answer: (call: Call) => Response | undefined) {
  const calls: Call[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const call = { method: request.method, path: new URL(request.url).pathname };
    calls.push(call);
    const given = answer(call);
    if (given) return given;
    if (call.path.startsWith("/photos/")) {
      return json({
        url: "https://media.test/card.webp",
        variant: "card",
        expiresAt: "2030-01-01T00:15:00.000Z",
      });
    }
    return refusal("not_found", 404);
  }) as unknown as typeof fetch;
  return calls;
}

const list =
  (...items: StarredPerson[]) =>
  (call: Call) =>
    call.path === "/stars" ? json({ items }) : undefined;

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const show = async () => {
  await renderWithTheme(<KumpaScreen />);
  await settle();
};
const press = async (name: string) => {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
  await settle();
};
const held = () => JSON.parse(store.get(KEY) ?? "null") as unknown;
const photos = (calls: Call[]) =>
  calls.filter((call) => call.path.startsWith("/photos/")).map((call) => call.path);
/** What the screen reader was last taken to, by its words. */
const takenTo = () => {
  const [node] = (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mock.calls.at(-1) as [
    { props: { accessibilityLabel?: string; children?: unknown } },
  ];
  return node.props.accessibilityLabel ?? node.props.children;
};
/** The frame a person's photo is drawn in. */
const frameOf = (name: string) => {
  let node = screen.getByRole("image", { name }).parent;
  while (node && StyleSheet.flatten(node.props.style)?.aspectRatio === undefined) {
    node = node.parent;
  }
  return StyleSheet.flatten(node?.props.style);
};

beforeEach(async () => {
  toss(0);
  store.clear();
  router.push.mockReset();
  router.back.mockReset();
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
  (AccessibilityInfo.sendAccessibilityEvent as jest.Mock).mockClear();
  await clearSession();
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

afterEach(() => jest.restoreAllMocks());

describe("Kumpa", () => {
  it("shows two people of the list, each named with their age, a tap's hint and nothing else", async () => {
    api(list(HENNA, KATJA, MINNA));
    await show();

    expect(screen.getByRole("heading", { name: "Kumpa?" })).toBeTruthy();
    expect(said()).toEqual(["Kumpa?", "Henna, 31", "Katja, 44"]);
    for (const name of ["Henna, 31", "Katja, 44"]) {
      expect(screen.getByRole("button", { name }).props.accessibilityHint).toBe(
        "Puts them before the other one.",
      );
    }
    expect(screen.queryByRole("button", { name: "Minna, 28" })).toBeNull();
    expect(screen.queryByText(/\b[23]\b/)).toBeNull();
    noProblems();
  });

  it("asks the card's size of the main photo of the two on the screen, and nobody's ahead of them", async () => {
    const calls = api(list(HENNA, KATJA, MINNA));
    await show();

    expect(photos(calls)).toEqual([`/photos/${HENNA.photo?.id}/card`]);
    expect(screen.getByRole("image", { name: "Photo: Henna" })).toBeTruthy();
    expect(screen.queryByRole("image", { name: "Photo: Katja" })).toBeNull();
  });

  // jest's window is 750 x 1334; these set their own.
  it.each([
    ["higher than it is wide", 390, 844, "flex-col", false, 0.3],
    ["as high as it is wide", 600, 600, "flex-col", false, 0.3],
    ["a point wider than it is high", 601, 600, "flex-row", true, 0.55],
    ["wider than it is high", 1000, 550, "flex-row", true, 0.55],
  ])(
    "lays the two out for a window %s",
    async (_shape, width, height, direction, halves, share) => {
      jest.spyOn(Dimensions, "get").mockReturnValue({ width, height, scale: 3, fontScale: 1 });
      api(list(HENNA, KATJA, MINNA));
      await show();

      expect(screen.getByTestId("kumpa-pair").props.className.split(" ")).toContain(direction);
      for (const name of ["Henna, 31", "Katja, 44"]) {
        const words = screen.getByRole("button", { name }).props.className.split(" ");
        expect(words.includes("flex-1")).toBe(halves);
      }
      expect(frameOf("Photo: Henna")).toEqual({
        height: expect.closeTo(share * height),
        aspectRatio: 3 / 4,
        maxWidth: "100%",
      });
      noProblems();
    },
  );

  it("draws which of the two comes first for each pair, and a pick puts the one picked first wherever they stand", async () => {
    toss(1);
    api(list(HENNA, KATJA, MINNA));
    await show();
    expect(said()).toEqual(["Kumpa?", "Katja, 44", "Henna, 31"]);

    toss(0);
    await press("Henna, 31");

    expect(held()).toEqual({ order: [HENNA.id, KATJA.id], placing: null });
    expect(said()).toEqual(["Kumpa?", "Katja, 44", "Minna, 28"]);
    expect(takenTo()).toBe("Katja, 44");

    toss(1);
    await press("Minna, 28");

    expect(held()).toEqual({
      order: [HENNA.id, KATJA.id],
      placing: { id: MINNA.id, lo: 0, hi: 1 },
    });
    expect(said()).toEqual(["Kumpa?", "Minna, 28", "Henna, 31"]);
    expect(takenTo()).toBe("Minna, 28");
  });

  it("puts the one picked first, keeps the order on the phone, and shows the next pair", async () => {
    const calls = api(list(HENNA, KATJA, MINNA));
    await show();

    await press("Katja, 44");

    expect(held()).toEqual({ order: [KATJA.id, HENNA.id], placing: null });
    expect(said()).toEqual(["Kumpa?", "Henna, 31", "Minna, 28"]);
    expect(photos(calls)).toEqual([
      `/photos/${HENNA.photo?.id}/card`,
      `/photos/${MINNA.photo?.id}/card`,
    ]);
    expect(takenTo()).toBe("Henna, 31");
    expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  });

  it("says the list is in order once everybody has a place, with the way back and Start again", async () => {
    api(list(HENNA, KATJA));
    await show();

    await press("Henna, 31");

    expect(held()).toEqual({ order: [HENNA.id, KATJA.id], placing: null });
    expect(said()).toEqual([
      "Kumpa?",
      "Your Later list is in order.",
      "Back to Later list",
      "Start again",
    ]);
    expect(screen.getByText("Your Later list is in order.").props.accessibilityLiveRegion).toBe(
      "polite",
    );
    expect(takenTo()).toBe("Your Later list is in order.");
    noProblems();

    // The header's arrow and the button under the line, the same words.
    const backs = screen.getAllByRole("button", { name: "Back to Later list" });
    expect(backs).toHaveLength(2);
    await act(async () => {
      fireEvent.press(backs[1] as never);
    });
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("starts again from the beginning, the order forgotten and the first pair drawn again", async () => {
    store.set(KEY, JSON.stringify({ order: [KATJA.id, HENNA.id], placing: null }));
    api(list(HENNA, KATJA));
    await show();
    expect(screen.getByText("Your Later list is in order.")).toBeTruthy();

    toss(1);
    await press("Start again");

    expect(store.has(KEY)).toBe(false);
    expect(said()).toEqual(["Kumpa?", "Katja, 44", "Henna, 31"]);
    expect(takenTo()).toBe("Katja, 44");
  });

  it("goes on where it stopped, from the order the phone keeps", async () => {
    store.set(
      KEY,
      JSON.stringify({ order: [KATJA.id, HENNA.id], placing: { id: MINNA.id, lo: 1, hi: 2 } }),
    );
    api(list(MINNA, HENNA, KATJA));
    await show();

    expect(said()).toEqual(["Kumpa?", "Henna, 31", "Minna, 28"]);
    await press("Minna, 28");

    expect(held()).toEqual({ order: [KATJA.id, MINNA.id, HENNA.id], placing: null });
    expect(screen.getByText("Your Later list is in order.")).toBeTruthy();
  });

  it("has the list in order at once with one person on it", async () => {
    api(list(HENNA));
    await show();
    expect(said()).toEqual([
      "Kumpa?",
      "Your Later list is in order.",
      "Back to Later list",
      "Start again",
    ]);
    expect(store.has(KEY)).toBe(false);
  });

  it.each([
    [
      "en-US",
      "Kumpa?",
      "Puts them before the other one.",
      "Your Later list is in order.",
      "Start again",
    ],
    [
      "fi-FI",
      "Kumpa?",
      "Asettaa hänet toisen edelle.",
      "Myöhemmin-listasi on järjestyksessä.",
      "Aloita alusta",
    ],
    ["sv-FI", "Kumpa?", "Sätter hen före den andra.", "Din Senare-lista är i ordning.", "Börja om"],
  ])("speaks %s", async (languageTag, title, hint, done, again) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    api(list(HENNA, KATJA));
    await show();
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Henna, 31" }).props.accessibilityHint).toBe(hint);

    await press("Henna, 31");

    expect(screen.getByText(done)).toBeTruthy();
    expect(screen.getByRole("button", { name: again })).toBeTruthy();
  });

  it("says so with nobody on the list", async () => {
    api(list());
    await show();
    expect(said()).toEqual(["Kumpa?", "Nobody here right now."]);
  });

  it("says it is loading, in a live region", async () => {
    let answer: (response: Response) => void = () => undefined;
    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    await renderWithTheme(<KumpaScreen />);
    expect(screen.getByText("Loading…").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => {
      answer(json({ items: [] }));
    });
    await settle();
  });

  it("says a failed read, and tries again", async () => {
    let failing = true;
    api((call) => {
      if (call.path !== "/stars") return undefined;
      return failing ? refusal("internal", 500) : json({ items: [HENNA, KATJA] });
    });
    await show();
    expect(screen.getByText(FAILED_TO_LOAD)).toBeTruthy();
    expect(store.has(KEY)).toBe(false);

    failing = false;
    await press("Try again");

    expect(screen.getByRole("button", { name: "Henna, 31" })).toBeTruthy();
  });

  it("leads back to the Later list from its arrow", async () => {
    api(list(HENNA, KATJA));
    await show();
    await press("Back to Later list");
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
