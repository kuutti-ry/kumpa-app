import type { StarredPerson } from "@kuutti/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { clearSession, saveSession } from "@/lib/session";
import { noProblems } from "@/test/a11y";
import { FAILED_TO_LOAD } from "@/test/failed";
import { textsInOrder as said } from "@/test/layout";
import { renderWithTheme } from "@/test/render";
import { StarredScreen } from "./StarredScreen";
import { StarsButton } from "./StarsButton";

// The Later list on the phone (#575, ADR-064 §6, #681): the people as the API gives
// them and in its order, or in the person's own once Kumpa has given it one, with
// whoever came since at the top and marked; Kumpa's button in the header while two
// people or more are there; a row that opens the card and a button that takes the
// person off the list, what it says while it loads, fails or holds nobody, and the
// way into it from home, there only while the list shows somebody. A card opened
// from it, and the way into it where the queue ends, are QueueScreen.test.tsx's;
// Kumpa itself is KumpaScreen.test.tsx's.

const { __router: router, __focus: focus } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; back: jest.Mock; replace: jest.Mock };
  __focus: () => void;
};

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

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
  photo: null,
};
const ORDER = "kuutti.preference.laterOrder";

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
        url: "https://media.test/thumb.webp",
        variant: "thumb",
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
  await renderWithTheme(<StarredScreen />);
  await settle();
};
const press = async (name: string) => {
  await act(async () => {
    fireEvent.press(screen.getByRole("button", { name }));
  });
  await settle();
};

beforeEach(async () => {
  router.push.mockReset();
  router.back.mockReset();
  router.replace.mockReset();
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
  await clearSession();
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

describe("the Later list", () => {
  it("shows the people in the API's order, each named with their age, with no line above them (#581)", async () => {
    api(list(HENNA, KATJA));
    await show();

    expect(screen.getByRole("heading", { name: "Later" })).toBeTruthy();
    expect(said()).toEqual(["Later", "Kumpa?", "Henna, 31", "Katja, 44"]);
    expect(
      screen
        .getAllByRole("button")
        .map((button) => button.props.accessibilityLabel as string)
        .filter((label) => /, \d+$/.test(label)),
    ).toEqual(["Henna, 31", "Katja, 44"]);
    noProblems();
  });

  it("asks a shown photo's thumb, and no photo for somebody with none shown", async () => {
    const calls = api(list(HENNA, KATJA));
    await show();

    expect(calls.filter((call) => call.path.startsWith("/photos/")).map((c) => c.path)).toEqual([
      `/photos/${HENNA.photo?.id}/thumb`,
    ]);
    expect(screen.getByRole("image", { name: "Photo: Henna" })).toBeTruthy();
    expect(screen.queryByRole("image", { name: "Photo: Katja" })).toBeNull();
  });

  it("shows no count of anybody", async () => {
    api(list(HENNA, KATJA));
    await show();
    expect(screen.queryByText(/\b2\b/)).toBeNull();
  });

  it("opens the card from a row", async () => {
    api(list(HENNA));
    await show();

    await press("Henna, 31");

    expect(router.push).toHaveBeenCalledWith(`/stars/${HENNA.id}`);
  });

  it("takes the person off the list from their row, and the row goes", async () => {
    const calls = api((call) =>
      call.method === "DELETE" ? new Response(null, { status: 204 }) : list(HENNA, KATJA)(call),
    );
    await show();

    await press("Take off the list: Henna");

    expect(calls).toContainEqual({ method: "DELETE", path: `/stars/${HENNA.id}` });
    expect(screen.queryByRole("button", { name: "Henna, 31" })).toBeNull();
    expect(screen.getByRole("button", { name: "Katja, 44" })).toBeTruthy();
  });

  it("takes the row off when another phone took the person off first", async () => {
    api((call) => (call.method === "DELETE" ? refusal("not_found", 404) : list(HENNA)(call)));
    await show();

    await press("Take off the list: Henna");

    expect(screen.queryByRole("button", { name: "Henna, 31" })).toBeNull();
    expect(screen.queryByText("That did not go through. Try again.")).toBeNull();
  });

  it("says a person who was not taken off, and keeps the row", async () => {
    api((call) => (call.method === "DELETE" ? refusal("internal", 500) : list(HENNA)(call)));
    await show();

    await press("Take off the list: Henna");

    expect(screen.getByText("That did not go through. Try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Henna, 31" })).toBeTruthy();
  });

  it.each([
    ["en-US", "Later", "Nobody here right now."],
    ["fi-FI", "Myöhemmin", "Täällä ei ole nyt ketään."],
    ["sv-FI", "Senare", "Ingen här just nu."],
  ])(
    "says so with nobody on the list, and never that anybody went or how anybody comes: %s",
    async (languageTag, title, words) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
      api(list());
      await show();
      expect(said()).toEqual([title, words]);
    },
  );

  it("says it is loading, in a live region", async () => {
    let answer: (response: Response) => void = () => undefined;
    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    await renderWithTheme(<StarredScreen />);
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
      return failing ? refusal("internal", 500) : json({ items: [HENNA] });
    });
    await show();
    expect(screen.getByText(FAILED_TO_LOAD)).toBeTruthy();

    failing = false;
    await press("Try again");

    expect(screen.getByRole("button", { name: "Henna, 31" })).toBeTruthy();
  });

  it("reads again when the screen comes back in sight, as a card opened may have taken a star off", async () => {
    let items = [HENNA, KATJA];
    api((call) => (call.path === "/stars" ? json({ items }) : undefined));
    await show();
    items = [KATJA];

    await act(async () => {
      focus();
    });
    await settle();

    expect(screen.queryByRole("button", { name: "Henna, 31" })).toBeNull();
    expect(screen.getByRole("button", { name: "Katja, 44" })).toBeTruthy();
  });

  it("keeps what it shows when a later read fails", async () => {
    let failing = false;
    api((call) => {
      if (call.path !== "/stars") return undefined;
      return failing ? refusal("internal", 500) : json({ items: [HENNA] });
    });
    await show();
    failing = true;

    await act(async () => {
      focus();
    });
    await settle();

    expect(screen.getByRole("button", { name: "Henna, 31" })).toBeTruthy();
    expect(screen.queryByText(FAILED_TO_LOAD)).toBeNull();
  });

  it("leads back home", async () => {
    api(list(HENNA));
    await show();
    await press("Back to home");
    expect(router.back).toHaveBeenCalled();
  });
});

describe("Kumpa on the list (ADR-064 §6)", () => {
  afterEach(() => store.delete(ORDER));
  const kumpa = () =>
    screen.queryByRole("button", { name: "Kumpa? Put your Later list in order, two at a time." });

  it("is offered in the header while the list shows two people or more, by its word, and opens Kumpa", async () => {
    api(list(HENNA, KATJA));
    await show();

    expect(within(kumpa() as never).getByText("Kumpa?")).toBeTruthy();
    await press("Kumpa? Put your Later list in order, two at a time.");
    expect(router.push).toHaveBeenCalledWith("/stars/kumpa");
    noProblems();
  });

  it("is not offered with one person on the list, or none, or while it does not know", async () => {
    api(list(HENNA));
    await show();
    expect(kumpa()).toBeNull();

    api(list());
    await show();
    expect(kumpa()).toBeNull();

    api((call) => (call.path === "/stars" ? refusal("internal", 500) : undefined));
    await show();
    expect(kumpa()).toBeNull();
  });

  it("shows the person's own order once Kumpa has given one, whoever came since at the top and marked", async () => {
    store.set(ORDER, JSON.stringify({ order: [KATJA.id, HENNA.id], placing: null }));
    api(list(MINNA, HENNA, KATJA));
    await show();

    expect(said()).toEqual([
      "Later",
      "Kumpa?",
      "Minna, 28",
      "Not compared yet",
      "Katja, 44",
      "Henna, 31",
    ]);
    expect(screen.getByRole("button", { name: "Minna, 28, not compared yet" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Katja, 44" })).toBeTruthy();
    noProblems();
  });

  it("reads the order again when the list comes back in sight from Kumpa", async () => {
    api(list(HENNA, KATJA));
    await show();
    expect(said()).toEqual(["Later", "Kumpa?", "Henna, 31", "Katja, 44"]);
    store.set(ORDER, JSON.stringify({ order: [KATJA.id, HENNA.id], placing: null }));

    await act(async () => {
      focus();
    });
    await settle();

    expect(said()).toEqual(["Later", "Kumpa?", "Katja, 44", "Henna, 31"]);
  });

  it("keeps the API's order for an order the phone holds that names nobody on the list", async () => {
    store.set(ORDER, JSON.stringify({ order: ["somebody else's star"], placing: null }));
    api(list(HENNA, KATJA));
    await show();
    expect(said()).toEqual(["Later", "Kumpa?", "Henna, 31", "Katja, 44"]);
  });

  it.each([
    [
      "fi-FI",
      "Myöhemmin",
      "Ei vielä verrattu",
      "Minna, 28, ei vielä verrattu",
      "Kumpa? Järjestä Myöhemmin-listasi kaksi kerrallaan.",
    ],
    [
      "sv-FI",
      "Senare",
      "Inte jämförd än",
      "Minna, 28, inte jämförd än",
      "Kumpa? Ordna din Senare-lista, två i taget.",
    ],
  ])("marks and offers it in %s", async (languageTag, title, mark, label, offer) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    store.set(ORDER, JSON.stringify({ order: [KATJA.id, HENNA.id], placing: null }));
    api(list(MINNA, HENNA, KATJA));
    await show();

    expect(said().slice(0, 4)).toEqual([title, "Kumpa?", "Minna, 28", mark]);
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
    expect(screen.getByRole("button", { name: offer })).toBeTruthy();
  });
});

// Pressed, a row keeps its words' colour on a ground they are paired with:
// today's --accent, or the ink's tint in a try style, whose --accent is loud.
describe("a row pressed (#408)", () => {
  afterEach(() => store.delete("kuutti.preference.look"));

  it.each([
    ["today", "active:bg-accent", "active:bg-foreground/10"],
    ["organic", "active:bg-foreground/10", "active:bg-accent"],
  ] as const)("fills in the %s style's way", async (look, fill, not) => {
    if (look !== "today") store.set("kuutti.preference.look", look);
    api(list(HENNA));
    await show();
    const classes = () =>
      String(screen.getByRole("button", { name: "Henna, 31" }).props.className).split(" ");
    await waitFor(() => expect(classes()).toContain(fill));
    expect(classes()).not.toContain(not);
  });
});

describe("the home screen's way to the list", () => {
  const button = () => screen.queryByRole("button", { name: "Later list" });
  const showButton = async () => {
    await renderWithTheme(<StarsButton />);
    await settle();
  };

  it("is there while the list shows somebody, by its word alone, and leads to the list", async () => {
    api(list(HENNA, KATJA));
    await showButton();

    expect(within(button() as never).getByText("Later list")).toBeTruthy();
    expect(screen.queryByText(/\d/)).toBeNull();
    await press("Later list");
    expect(router.push).toHaveBeenCalledWith("/stars");
    expect(router.replace).not.toHaveBeenCalled();
    noProblems();
  });

  it("is not there with nobody to show, or while it does not know", async () => {
    api(list());
    await showButton();
    expect(button()).toBeNull();

    api((call) => (call.path === "/stars" ? refusal("internal", 500) : undefined));
    await showButton();
    expect(button()).toBeNull();
  });

  it("goes when the last star goes, once home is back in sight", async () => {
    let items = [HENNA];
    api((call) => (call.path === "/stars" ? json({ items }) : undefined));
    await showButton();
    expect(button()).not.toBeNull();
    items = [];

    await act(async () => {
      focus();
    });
    await settle();

    expect(button()).toBeNull();
  });
});
