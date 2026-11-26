import { DISTANCE_BANDS, type ProfileCard } from "@kuutti/schema";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react-native";
import { Image } from "expo-image";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { saveSession } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { InScroll, layOut, placePhotos, scrollTo } from "@/test/sight";
import { ProfileCardView } from "./ProfileCardView";

// A card as others see it (#47, #150): what it shows when the person has
// given little, what wins when they have given more, and a refused photo
// handed to the screen.

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const PHOTO = "0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01" as ProfileCard["photos"][number]["id"];
const photoAt = (
  n: number,
  caption: ProfileCard["photos"][number]["caption"] = null,
  description: ProfileCard["photos"][number]["description"] = null,
) => ({
  id: `0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a0${n}` as ProfileCard["photos"][number]["id"],
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  width: 1200,
  height: 1600,
  caption,
  description,
});
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

const bare: ProfileCard = {
  accountId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
  displayName: "Aino",
  age: { years: 36, verifiedByBank: true },
  gender: null,
  place: null,
  photos: [],
  fields: {},
  bio: null,
  bioPreset: null,
  prompts: [],
  shared: { hobbies: [], languages: [], university: [], guild: [] },
};

/** Every text of the rendered tree, in reading order. */
const texts = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node && typeof node === "object" && "children" in node) {
    return texts((node as { children: unknown }).children);
  }
  return [];
};

/** The texts and the photos, as "[photo n]" by the card's order of them, in reading order. */
const reading = (card: ProfileCard) => {
  const walk = (node: unknown): string[] => {
    if (typeof node === "string") return [node];
    if (Array.isArray(node)) return node.flatMap(walk);
    if (!node || typeof node !== "object") return [];
    const id = (node as { props?: { testID?: unknown } }).props?.testID;
    const at = card.photos.findIndex((photo) => id === `card-photo-${photo.id}`);
    if (at >= 0) return [`[photo ${at + 1}]`];
    return "children" in node ? walk((node as { children: unknown }).children) : [];
  };
  return walk(screen.toJSON());
};

beforeEach(async () => {
  placePhotos();
  store.delete("kuutti.preference.photoDescriptions");
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
  globalThis.fetch = jest.fn(async () =>
    json({ error: { code: "not_found", message: "x", requestId: "r" } }, 404),
  ) as unknown as typeof fetch;
});

describe("ProfileCardView", () => {
  it("shows the name with the age as the title, and nothing the person did not give", async () => {
    await renderWithTheme(<ProfileCardView card={bare} />);
    // The age as visible as the name, and no word on the bank: every account is verified (#239).
    expect(screen.getByRole("heading", { name: "Aino, 36" })).toBeTruthy();
    expect(texts(screen.toJSON())).toEqual(["Aino, 36"]);
    expect(screen.queryByRole("image")).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  describe("the place and how far (#514, ADR-061)", () => {
    const place = { fi: "Kallio", sv: "Berghäll" };

    it("says the gender, the label, the place and the band on one line under the name, apart by a drawn dot, before the words (#644)", async () => {
      await renderWithTheme(
        <ProfileCardView
          card={{
            ...bare,
            gender: "non_binary",
            fields: { identityLabel: "genderfluid" },
            place,
            bio: "Long walks.",
          }}
          distance="close"
        />,
      );
      expect(texts(screen.toJSON())).toEqual([
        "Aino, 36",
        "Non-binary",
        "Genderfluid",
        "Kallio",
        "Close",
        "Long walks.",
      ]);
      // One line, each word a text of its own and heard on its own; the dots are no text.
      const line = screen.getByTestId("card-line");
      for (const word of ["Non-binary", "Genderfluid", "Kallio", "Close"]) {
        expect(within(line).getByText(word)).toBeTruthy();
      }
      expect(within(line).queryByText("Long walks.")).toBeNull();
      expect(screen.queryAllByTestId("card-line-dot")).toEqual([]);
      expect(screen.getAllByTestId("card-line-dot", { includeHiddenElements: true })).toHaveLength(
        3,
      );
    });

    it("draws no dot beside a word alone (#644)", async () => {
      await renderWithTheme(<ProfileCardView card={{ ...bare, place }} />);
      expect(within(screen.getByTestId("card-line")).getByText("Kallio")).toBeTruthy();
      expect(
        screen.queryAllByTestId("card-line-dot", { includeHiddenElements: true }),
      ).toHaveLength(0);
    });

    it("has no line at all when there is nothing to say on it", async () => {
      await renderWithTheme(<ProfileCardView card={bare} />);
      expect(screen.queryByTestId("card-line")).toBeNull();
    });

    it.each([
      ["en-US", ["Nearby", "Close", "Around", "Far"]],
      ["fi-FI", ["Lähellä", "Melko lähellä", "Samoilla seuduilla", "Kauempana"]],
      ["sv-FI", ["I närheten", "Ganska nära", "I trakten", "Längre bort"]],
    ])("says each band in words, for a %s reader", async (tag, words) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        for (const [at, band] of DISTANCE_BANDS.entries()) {
          await renderWithTheme(<ProfileCardView card={bare} distance={band} />);
          expect(screen.getByText(words[at] as string)).toBeTruthy();
        }
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it.each([
      ["no band on a card from outside a queue", undefined],
      ["no band on an entry from before distance", null],
    ])("says %s", async (_what, distance) => {
      await renderWithTheme(<ProfileCardView card={{ ...bare, place }} distance={distance} />);
      expect(texts(screen.toJSON())).toEqual(["Aino, 36", "Kallio"]);
    });

    it("says no place for somebody without a home, and a band all the same", async () => {
      await renderWithTheme(<ProfileCardView card={bare} distance="far" />);
      expect(texts(screen.toJSON())).toEqual(["Aino, 36", "Far"]);
    });

    it.each([
      ["en-US", "Kallio"],
      ["fi-FI", "Kallio"],
      ["sv-FI", "Berghäll"],
    ])("reads the place as the list has it, for a %s reader", async (tag, name) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        await renderWithTheme(<ProfileCardView card={{ ...bare, place }} />);
        expect(screen.getByText(name)).toBeTruthy();
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it("says it in words alone: no digits, no kilometres, no colour of its own", async () => {
      await renderWithTheme(<ProfileCardView card={{ ...bare, place }} distance="nearby" />);
      for (const line of texts(screen.toJSON())) {
        expect(line).not.toMatch(/\d{5}|\bkm\b/);
      }
      // The muted line of every fact on the card, like the gender's: the word is the meaning.
      expect(screen.getByText("Nearby").props.className).toBe(
        screen.getByText("Kallio").props.className,
      );
    });
  });

  it("shows the bio the person wrote rather than a placeholder", async () => {
    await renderWithTheme(
      <ProfileCardView card={{ ...bare, bio: "Long walks.", bioPreset: "photos_speak" }} />,
    );
    expect(screen.getByText("Long walks.")).toBeTruthy();
    expect(screen.queryByText("The photos say it. The rest over coffee.")).toBeNull();
  });

  it("says a number in its unit, a choice in words, and each of several answers as a chip of its own", async () => {
    await renderWithTheme(
      <ProfileCardView
        card={{ ...bare, fields: { height: 171, intent: "casual", languages: ["fi", "en"] } }}
      />,
    );
    expect(screen.getByText("171 cm")).toBeTruthy();
    expect(screen.getByText("Something casual")).toBeTruthy();
    expect(screen.getByText("Finnish")).toBeTruthy();
    expect(screen.getByText("English")).toBeTruthy();
  });

  it("says a dance partner as what the person is looking for (#175)", async () => {
    await renderWithTheme(
      <ProfileCardView card={{ ...bare, fields: { intent: "dance_partner" } }} />,
    );
    // The question is heard, not drawn: the compass says it to the eye (#644).
    expect(texts(screen.toJSON())).toEqual(["Aino, 36", "A dance partner"]);
    expect(screen.getByLabelText("Looking for: A dance partner")).toBeTruthy();
  });

  it("names the photos by position and hands a refused one to the screen", async () => {
    globalThis.fetch = jest.fn(async () =>
      json({ error: { code: "photo_budget_exceeded", message: "x", requestId: "r" } }, 429),
    ) as unknown as typeof fetch;
    const refused = jest.fn();
    await renderWithTheme(
      <ProfileCardView
        card={{
          ...bare,
          photos: [
            {
              id: PHOTO,
              blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
              width: 1200,
              height: 1600,
              caption: null,
              description: null,
            },
          ],
        }}
        onRefused={refused}
      />,
    );
    await layOut();
    await settle();
    expect(screen.getByLabelText("Photo 1 of 1")).toBeTruthy();
    expect(refused).toHaveBeenCalledWith("photo_budget_exceeded");
  });

  it("shows the owner's caption under a photo for the eye, and says it once, with the photo, to a screen reader (#296)", async () => {
    await renderWithTheme(
      <ProfileCardView
        card={{
          ...bare,
          photos: [photoAt(1, "summer_day"), photoAt(2), photoAt(3, "four_legged")],
        }}
      />,
    );
    await settle();
    // Each photo with its line under it: visible, hidden from the accessibility
    // tree, since the label carries it, whether or not the photo has come yet.
    expect(screen.getAllByRole("image").map((image) => image.props.accessibilityLabel)).toEqual([
      "Photo 1 of 3. A summer day",
      "Photo 2 of 3",
      "Photo 3 of 3. With a four-legged friend",
    ]);
    for (const line of ["A summer day", "With a four-legged friend"]) {
      expect(screen.getAllByText(line, { includeHiddenElements: true })).toHaveLength(1);
      expect(screen.queryByText(line)).toBeNull();
    }
  });

  it("reads the check's description after the caption on every photo, and shows it under the photo when the setting asks (#296)", async () => {
    const lakeside = {
      people: 1,
      setting: "outdoors" as const,
      scene: ["lake" as const],
      objects: ["hiking" as const, "dog" as const],
      smile: true,
      glasses: false,
      sunglasses: true,
      facialHair: false,
    };
    const sauna = {
      ...lakeside,
      setting: "indoors" as const,
      scene: ["sauna" as const],
      objects: [],
    };
    const card = {
      ...bare,
      photos: [photoAt(1, "summer_day", lakeside), photoAt(2, null, sauna), photoAt(3)],
    };
    const lakesideWords =
      "Automatic description: One person, outdoors, by a lake. Smiling, sunglasses. Hiking, with a dog.";
    const saunaWords =
      "Automatic description: One person, indoors, in a sauna. Smiling, sunglasses.";
    await renderWithTheme(<ProfileCardView card={card} />);
    await settle();
    // The caption first, then the machine's words, named as such; a photo without a description says nothing more.
    expect(screen.getByLabelText(`Photo 1 of 3. A summer day. ${lakesideWords}`)).toBeTruthy();
    expect(screen.getByLabelText(`Photo 2 of 3. ${saunaWords}`)).toBeTruthy();
    expect(screen.getByLabelText("Photo 3 of 3")).toBeTruthy();
    expect(screen.queryByText(lakesideWords, { includeHiddenElements: true })).toBeNull();

    // Shown under the photos, hidden from the accessibility tree, with the face left out everywhere.
    store.set(
      "kuutti.preference.photoDescriptions",
      JSON.stringify({ shown: true, people: true, face: false, objects: true }),
    );
    await renderWithTheme(<ProfileCardView card={card} />);
    await settle();
    const lakesideNoFace =
      "Automatic description: One person, outdoors, by a lake. Hiking, with a dog.";
    const saunaNoFace = "Automatic description: One person, indoors, in a sauna.";
    expect(
      await screen.findByLabelText(`Photo 1 of 3. A summer day. ${lakesideNoFace}`),
    ).toBeTruthy();
    expect(screen.getByText(lakesideNoFace, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(lakesideNoFace)).toBeNull();
    expect(screen.getByLabelText(`Photo 2 of 3. ${saunaNoFace}`)).toBeTruthy();
    // Each under its own photo, in the card's order, and none under a photo without one.
    expect(
      texts(screen.toJSON()).filter((line) => line.startsWith("Automatic description")),
    ).toEqual([lakesideNoFace, saunaNoFace]);
    expect(screen.getByText(saunaNoFace, { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText(saunaNoFace)).toBeNull();
  });
  it("has no block or report on the owner's own card", async () => {
    await renderWithTheme(<ProfileCardView card={bare} />);
    expect(screen.queryByRole("button", { name: "Block or report" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Aino, 36" }).props.accessibilityActions).toBe(
      undefined,
    );
  });

  it("offers block or report on someone else's card, as a button beside the name and as an action on it, and hands the card back after a block (#84)", async () => {
    globalThis.fetch = jest.fn(async (input: Request | string) => {
      const request = input instanceof Request ? input : new Request(input);
      return new URL(request.url).pathname === "/blocks"
        ? new Response(null, { status: 204 })
        : json({ error: { code: "not_found", message: "x", requestId: "r" } }, 404);
    }) as unknown as typeof fetch;
    const gone = jest.fn();
    await renderWithTheme(<ProfileCardView card={bare} onGone={gone} />);
    expect(screen.getByRole("button", { name: "Block or report" })).toBeTruthy();
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );
    const name = screen.getByRole("heading", { name: "Aino, 36" });
    expect(name.props.accessibilityActions).toEqual([
      { name: "blockOrReport", label: "Block or report" },
    ]);
    // Another action reaching the name opens nothing.
    await act(async () => {
      fireEvent(name, "accessibilityAction", { nativeEvent: { actionName: "activate" } });
    });
    expect(screen.queryByRole("button", { name: "Report and block" })).toBeNull();
    await act(async () => {
      fireEvent(name, "accessibilityAction", { nativeEvent: { actionName: "blockOrReport" } });
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Block" }));
    });
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Block" }));
    });
    await screen.findByText("Blocked.");
    await act(async () => {
      fireEvent.press(screen.getByRole("button", { name: "Done" }));
    });
    await waitFor(() => expect(gone).toHaveBeenCalledWith(bare.accountId));
  });

  it("offers the card's own photos in its report, named as the card names them and drawn from the phone's cache, signs nothing more, and reports the one chosen (#476)", async () => {
    const asked: string[] = [];
    const sent: unknown[] = [];
    globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      const path = new URL(request.url).pathname;
      asked.push(path);
      if (request.method === "POST" && path === "/reports") {
        sent.push(JSON.parse(await request.text()));
        return new Response(null, { status: 204 });
      }
      return json({ error: { code: "not_found", message: "x", requestId: "r" } }, 404);
    }) as unknown as typeof fetch;
    const cache = jest.spyOn(Image, "readFromCacheAsync");
    const sauna = {
      people: 1,
      setting: "indoors" as const,
      scene: ["sauna" as const],
      objects: [],
      smile: false,
      glasses: false,
      sunglasses: false,
      facialHair: false,
    };
    const card = { ...bare, photos: [photoAt(1), photoAt(2, "summer_day", sauna)] };
    await renderWithTheme(
      <InScroll>
        <ProfileCardView card={card} onGone={jest.fn()} />
      </InScroll>,
    );
    await layOut();
    await settle();
    const signed = () => asked.filter((path) => path.startsWith("/photos/"));
    // The main photo's card variant, and the other's once it came into sight.
    expect(signed()).toEqual([`/photos/${photoAt(1).id}/card`]);
    await scrollTo(2);
    expect(signed()).toEqual([`/photos/${photoAt(1).id}/card`, `/photos/${photoAt(2).id}/card`]);
    const press = (name: string, role: "button" | "radio" = "button") =>
      act(async () => {
        fireEvent.press(screen.getByRole(role, { name }));
        await new Promise<void>((resolve) => setTimeout(resolve, 10));
      });
    await press("Block or report");
    await press("Report and block");
    const heard =
      "Photo 2 of 2. A summer day. Automatic description: One person, indoors, in a sauna.";
    expect(
      within(screen.getByLabelText("Is it about one photo?"))
        .getAllByRole("radio")
        .map((radio) => radio.props.accessibilityLabel),
    ).toEqual(["✓ Not one photo", "Photo 1 of 2", heard]);
    // Seen beside its picture: the place and the caption, as under the photo.
    expect(screen.getByText("Photo 2 of 2. A summer day")).toBeTruthy();
    // Under the keys the card painted them by, and no URL signed again.
    expect(cache.mock.calls).toEqual([[`${photoAt(1).id}/card`], [`${photoAt(2).id}/card`]]);
    expect(signed()).toHaveLength(2);
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );
    await press(heard, "radio");
    await press("Something else", "radio");
    await press("Send report");
    await waitFor(() =>
      expect(sent).toEqual([
        { accountId: bare.accountId, reason: "other", photoId: photoAt(2).id },
      ]),
    );
    cache.mockRestore();
  });

  it("shows every photo down one scroll, each heard with its place, and asks for each once, only when it first comes into sight (ADR-008)", async () => {
    const asked: string[] = [];
    globalThis.fetch = jest.fn(async (input: Request | string) => {
      asked.push(new URL(input instanceof Request ? input.url : input).pathname);
      return json({ error: { code: "not_found", message: "x", requestId: "r" } }, 404);
    }) as unknown as typeof fetch;
    const card = { ...bare, photos: [photoAt(1), photoAt(2, "summer_day"), photoAt(3)] };
    await renderWithTheme(
      <InScroll>
        <ProfileCardView card={card} onGone={jest.fn()} />
      </InScroll>,
    );
    await settle();
    // Nothing before the card is laid out on the screen.
    expect(asked).toEqual([]);
    await layOut();
    await settle();
    // Every photo is on the card and heard, the ones further down as their blurhash.
    expect(screen.getAllByRole("image").map((image) => image.props.accessibilityLabel)).toEqual([
      "Photo 1 of 3",
      "Photo 2 of 3. A summer day",
      "Photo 3 of 3",
    ]);
    // Nothing beyond what is in sight asked for (prefetch counts as exposure).
    expect(asked).toEqual([`/photos/${photoAt(1).id}/card`]);
    await scrollTo(2);
    expect(asked).toEqual([1, 2].map((n) => `/photos/${photoAt(n).id}/card`));
    await scrollTo(3);
    await scrollTo(1);
    await scrollTo(3);
    // Each signed once, in the card size, however often it came back into sight.
    expect(asked).toEqual([1, 2, 3].map((n) => `/photos/${photoAt(n).id}/card`));
    // Nothing to tap through: no Previous, no Next, no Show the whole card.
    expect(screen.getAllByRole("button").map((button) => button.props.accessibilityLabel)).toEqual([
      "Block or report",
    ]);
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );
  });

  describe("one scroll, the way Hinge has it (the maintainer, 26/11/2026)", () => {
    /** What each chip says to a screen reader, in reading order. */
    const heardChips = () =>
      screen.queryAllByTestId(/^chip-/).map((chip) => chip.props.accessibilityLabel as string);
    const sunday: ProfileCard["prompts"][number] = { key: "sunday", answer: "A long breakfast." };
    const prompts: ProfileCard["prompts"] = [
      sunday,
      { key: "hidden_talent", answer: "I can whistle with my mouth full." },
    ];
    const full: ProfileCard = {
      ...bare,
      fields: {
        intent: "long_term",
        smoking: "never",
        exercise: "weekly",
        hobbies: ["yoga", "hiking"],
        politics: ["kesk"],
        religion: "non_religious",
        occupationTitle: "Architect",
      },
      bio: "Long walks.",
      prompts,
    };

    it("shows the key facts as chips in the person's own words, in the registry's order, each field's first chip heard with its question", async () => {
      await renderWithTheme(
        <ProfileCardView
          card={{
            ...bare,
            fields: {
              height: 171,
              languages: ["fi", "en"],
              smoking: "never",
              wantsKids: "want",
              hasKids: "no",
              monogamy: "monogamous",
              intent: "long_term",
              exercise: "weekly",
            },
          }}
        />,
      );
      expect(heardChips()).toEqual([
        "Looking for: Something long-term",
        "Relationship structure: Monogamous",
        "Kids: No kids",
        "Kids in the future: Want kids",
        "Smoking: Never",
        "Languages: Finnish",
        "English",
        "Height: 171 cm",
        // Exercise is no key fact: it comes with the rest of the answers, under its section.
        "Exercise: Weekly",
      ]);
      // The eye reads the answer after its icon, and no label line: a cigarette before "Never".
      expect(screen.getByText("Never")).toBeTruthy();
      expect(screen.queryByText("Smoking")).toBeNull();
      expect(
        within(screen.getByTestId("chip-smoking.never")).getByTestId("field-icon-smoking", {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId("chip-exercise.weekly")).getByTestId("field-icon-exercise", {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Lifestyle" })).toBeTruthy();
    });

    it("reads down one scroll: the first photo, the key facts, then photos and the person's own words in turn, and the rest of the answers at the end", async () => {
      const card = { ...full, photos: [photoAt(1), photoAt(2), photoAt(3), photoAt(4)] };
      await renderWithTheme(<ProfileCardView card={card} />);
      expect(reading(card)).toEqual([
        "Aino, 36",
        "[photo 1]",
        "Something long-term",
        "Never",
        "[photo 2]",
        "My ideal Sunday",
        "A long breakfast.",
        "[photo 3]",
        "Long walks.",
        "[photo 4]",
        "My hidden talent",
        "I can whistle with my mouth full.",
        "Work and education",
        "Architect",
        "Lifestyle",
        "Weekly",
        "Hobbies",
        "Yoga",
        "Hiking",
        "Beliefs",
        "Centre Party",
        "Non-religious",
      ]);
      // The profile's own section titles, as headings, each answer heard with its question.
      for (const title of ["Work and education", "Lifestyle", "Hobbies", "Beliefs"]) {
        expect(screen.getByRole("heading", { name: title })).toBeTruthy();
      }
      expect(heardChips()).toEqual([
        "Looking for: Something long-term",
        "Smoking: Never",
        "Job title: Architect",
        "Exercise: Weekly",
        "Hobbies: Yoga",
        "Hiking",
        "Parties you could vote for: Centre Party",
        "Religion: Non-religious",
      ]);
      // A hobby carries its group's icon, a party its own mark, a religion without one the field's.
      expect(
        within(screen.getByTestId("chip-hobbies.hiking")).getByTestId("hobby-group-icon-outdoors", {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId("chip-hobbies.yoga")).getByTestId("hobby-group-icon-sports", {
          includeHiddenElements: true,
        }),
      ).toBeTruthy();
      expect(
        within(screen.getByTestId("chip-politics.kesk")).queryByTestId("field-icon-politics", {
          includeHiddenElements: true,
        }),
      ).toBeNull();
      expect(
        within(screen.getByTestId("chip-religion.non_religious")).getByTestId(
          "field-icon-religion",
          { includeHiddenElements: true },
        ),
      ).toBeTruthy();
      // Nothing folded away, nothing to tap open.
      expect(screen.queryByRole("button")).toBeNull();
      expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
        [],
      );
    });

    it("puts the person's words after the key facts on a card with one photo or none, the first prompt, the bio and the other prompts", async () => {
      const one = { ...full, photos: [photoAt(1)] };
      await renderWithTheme(<ProfileCardView card={one} />);
      expect(reading(one).slice(0, 10)).toEqual([
        "Aino, 36",
        "[photo 1]",
        "Something long-term",
        "Never",
        "My ideal Sunday",
        "A long breakfast.",
        "Long walks.",
        "My hidden talent",
        "I can whistle with my mouth full.",
        "Work and education",
      ]);
      await renderWithTheme(<ProfileCardView card={{ ...bare, bio: "Long walks.", prompts }} />);
      expect(texts(screen.toJSON())).toEqual([
        "Aino, 36",
        "My ideal Sunday",
        "A long breakfast.",
        "Long walks.",
        "My hidden talent",
        "I can whistle with my mouth full.",
      ]);
    });

    it("goes on with the photos when the words run out", async () => {
      const card = { ...bare, prompts: [sunday], photos: [1, 2, 3, 4].map((n) => photoAt(n)) };
      await renderWithTheme(<ProfileCardView card={card} />);
      expect(reading(card)).toEqual([
        "Aino, 36",
        "[photo 1]",
        "[photo 2]",
        "My ideal Sunday",
        "A long breakfast.",
        "[photo 3]",
        "[photo 4]",
      ]);
    });

    it("gives the bio when there is no prompt, or the ready line when there is no bio", async () => {
      await renderWithTheme(<ProfileCardView card={{ ...bare, bio: "Long walks." }} />);
      expect(texts(screen.toJSON())).toEqual(["Aino, 36", "Long walks."]);
      await renderWithTheme(<ProfileCardView card={{ ...bare, bioPreset: "photos_speak" }} />);
      expect(texts(screen.toJSON())).toEqual([
        "Aino, 36",
        "The photos say it. The rest over coffee.",
      ]);
    });

    it("puts the ready line after the first prompt", async () => {
      await renderWithTheme(
        <ProfileCardView card={{ ...bare, bioPreset: "photos_speak", prompts: [sunday] }} />,
      );
      expect(texts(screen.toJSON())).toEqual([
        "Aino, 36",
        "My ideal Sunday",
        "A long breakfast.",
        "The photos say it. The rest over coffee.",
      ]);
    });

    describe("the school and the guild (#677)", () => {
      const studied: ProfileCard = {
        ...bare,
        fields: {
          intent: "long_term",
          occupationTitle: "Architect",
          university: ["aalto", "hanken"],
          guild: ["aalto_fyysikkokilta", "aalto_other", "hanken_shs", "hanken_other"],
        },
      };

      it("shows them with the rest of the answers, after the job title and not among the key facts, a chip a school and a chip a guild by its own name, and another guild once however many schools have it", async () => {
        await renderWithTheme(<ProfileCardView card={studied} />);
        expect(heardChips()).toEqual([
          "Looking for: Something long-term",
          "Job title: Architect",
          "University: Aalto University",
          "Hanken School of Economics",
          "Guild or student association: Fyysikkokilta (FK)",
          "Another guild",
          "Svenska Handelshögskolans Studentkår",
        ]);
        expect(screen.getAllByText("Another guild")).toHaveLength(1);
        for (const [chip, icon] of [
          ["chip-university.aalto", "field-icon-university"],
          ["chip-guild.aalto_fyysikkokilta", "field-icon-guild"],
        ] as const) {
          expect(
            within(screen.getByTestId(chip)).getByTestId(icon, { includeHiddenElements: true }),
          ).toBeTruthy();
        }
      });

      it("marks a school and a guild both named as any shared answer, and another guild never", async () => {
        await renderWithTheme(
          <ProfileCardView
            card={{
              ...studied,
              shared: { ...bare.shared, university: ["hanken"], guild: ["aalto_fyysikkokilta"] },
            }}
          />,
        );
        expect(heardChips().slice(2)).toEqual([
          "University: Aalto University",
          "Hanken School of Economics, shared",
          "Guild or student association: Fyysikkokilta (FK), shared",
          "Another guild",
          "Svenska Handelshögskolans Studentkår",
        ]);
      });

      it("shows a guild alone when the school is hidden, and a school alone when no guild was given", async () => {
        await renderWithTheme(
          <ProfileCardView card={{ ...bare, fields: { guild: ["helsinki_tko_aly"] } }} />,
        );
        expect(heardChips()).toEqual(["Guild or student association: TKO-äly ry"]);
        await renderWithTheme(
          <ProfileCardView card={{ ...bare, fields: { university: ["metropolia"] } }} />,
        );
        expect(heardChips()).toEqual(["University: Metropolia University of Applied Sciences"]);
      });

      it.each([
        [
          "fi-FI",
          [
            "Korkeakoulu: Aalto-yliopisto",
            "Kilta tai ainejärjestö: Fyysikkokilta (FK)",
            "Muu kilta",
          ],
        ],
        [
          "sv-FI",
          [
            "Högskola: Aalto-universitetet",
            "Gille eller ämnesförening: Fyysikkokilta (FK)",
            "Annat gille",
          ],
        ],
      ])(
        "names the guild the same in %s, and the rest in the reader's language",
        async (tag, heard) => {
          (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
          try {
            await renderWithTheme(
              <ProfileCardView
                card={{
                  ...bare,
                  fields: { university: ["aalto"], guild: ["aalto_fyysikkokilta", "aalto_other"] },
                }}
              />,
            );
            expect(heardChips()).toEqual(heard);
          } finally {
            (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
          }
        },
      );
    });

    it("draws a field and a work that read the same as one chip with both icons, heard as both, and keeps a pair that differs apart", async () => {
      await renderWithTheme(
        <ProfileCardView
          card={{
            ...bare,
            fields: {
              field: ["arts", "science"],
              occupation: ["science", "arts_culture"],
              occupationTitle: "Architect",
            },
          }}
        />,
      );
      // Science and Science and research read apart, so each keeps its chip and its question.
      expect(heardChips()).toEqual([
        "Field and work: Arts and culture",
        "Field: Science",
        "Work: Science and research",
        "Job title: Architect",
      ]);
      expect(screen.getAllByText("Arts and culture")).toHaveLength(1);
      const both = screen.getByTestId("chip-field.arts");
      for (const icon of ["field-icon-field", "field-icon-occupation"]) {
        expect(within(both).getByTestId(icon, { includeHiddenElements: true })).toBeTruthy();
      }
    });

    it.each([
      ["en-US", "Field and work: Arts and culture"],
      ["fi-FI", "Ala ja työ: Taide ja kulttuuri"],
      ["sv-FI", "Bransch och arbete: Konst och kultur"],
    ])("says a field that reads as the work as both, for a %s reader", async (tag, heard) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        await renderWithTheme(
          <ProfileCardView
            card={{ ...bare, fields: { field: ["arts"], occupation: ["arts_culture"] } }}
          />,
        );
        expect(heardChips()).toEqual([heard]);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it("marks an answer both gave by a filled chip in bold, heard as shared, in the order given, and never says 'you too'", async () => {
      await renderWithTheme(
        <ProfileCardView
          card={{
            ...bare,
            fields: { languages: ["fi", "en"], hobbies: ["yoga", "hiking"] },
            shared: { ...bare.shared, languages: ["fi"], hobbies: ["hiking"] },
          }}
        />,
      );
      expect(heardChips()).toEqual([
        "Languages: Finnish, shared",
        "English",
        "Hobbies: Yoga",
        "Hiking, shared",
      ]);
      // Every chip keeps its outline: the high-contrast sets' fill is their background,
      // where a shared chip is told by its bold alone and still drawn as a chip.
      const look = (id: string, words: string) => ({
        outlined: screen.getByTestId(id).props.className.includes("border-border"),
        filled: screen.getByTestId(id).props.className.includes("bg-secondary"),
        bold: screen.getByText(words).props.className.includes("font-semibold"),
      });
      const shared = { outlined: true, filled: true, bold: true };
      const own = { outlined: true, filled: false, bold: false };
      expect(look("chip-languages.fi", "Finnish")).toEqual(shared);
      expect(look("chip-hobbies.hiking", "Hiking")).toEqual(shared);
      expect(look("chip-languages.en", "English")).toEqual(own);
      expect(look("chip-hobbies.yoga", "Yoga")).toEqual(own);
      for (const line of texts(screen.toJSON())) expect(line).not.toMatch(/you too/i);
    });

    it.each([
      ["en-US", "Photo 1 of 1", "Smoking: Never", "Languages: Finnish, shared", "My ideal Sunday"],
      [
        "fi-FI",
        "Kuva 1 / 1",
        "Tupakointi: En koskaan",
        "Kielet: Suomi, yhteinen",
        "Täydellinen sunnuntaini",
      ],
      ["sv-FI", "Foto 1 av 1", "Rökning: Aldrig", "Språk: Finska, gemensam", "Min perfekta söndag"],
    ])(
      "says a photo's place, a question, a shared answer and a prompt for a %s reader",
      async (tag, photo, fact, shared, prompt) => {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
        try {
          const card = {
            ...bare,
            fields: { smoking: "never" as const, languages: ["fi" as const] },
            shared: { ...bare.shared, languages: ["fi"] },
            prompts: [sunday],
            photos: [photoAt(1)],
          };
          await renderWithTheme(<ProfileCardView card={card} />);
          expect(screen.getByRole("image").props.accessibilityLabel).toBe(photo);
          expect(heardChips()).toEqual([fact, shared]);
          // The prompt's question in the reader's language, the answer in the person's words.
          expect(reading(card).slice(-2)).toEqual([prompt, "A long breakfast."]);
        } finally {
          (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
        }
      },
    );
  });
});
