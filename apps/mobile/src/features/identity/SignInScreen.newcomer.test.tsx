import { CONSENT_VERSIONS } from "@kuutti/i18n";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { AppState, BackHandler, Linking, Platform } from "react-native";
import { clearSession, currentSession, markLoginStarted } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme, underProviders } from "@/test/render";
import { dropAgreements } from "./agreements";
import { dropHeldAnswers, HELD_ANSWERS_FOR_MS, holdAnswers, readHeldAnswers } from "./held-answers";
import { SignInScreen } from "./SignInScreen";

/**
 * The newcomer's way in (#681, ADR-010 §22): what Kumpa is, the four
 * questions held on the phone, the terms, then the bank, whose login saves
 * the answers. The bank's half itself and the terms are SignInScreen.test.tsx's.
 */

const { __router: router, __focus: focus } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; replace: jest.Mock; setParams: jest.Mock };
  __focus: () => void;
};
const { __store: store } = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};
const HELD = "kuutti.heldAnswers";
const AGREED = "kuutti.preference.agreedVersions";
const TERMS = String(CONSENT_VERSIONS.terms);
const PRIVACY = String(CONSENT_VERSIONS.privacy);
const SPECIAL = String(CONSENT_VERSIONS.special_category);

const CODE = "c".repeat(43);
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const tokens = {
  sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
  accessToken: token("access"),
  accessExpiresAt: "2030-01-01T00:15:00.000Z",
  refreshToken: `${token("family")}.${token("refresh")}`,
  refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  outcome: "created",
};
const KALLIO = {
  town: { fi: "Helsinki", sv: "Helsingfors" },
  area: { fi: "Kallio", sv: "Berghäll" },
  showArea: false,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = jest.fn<Promise<Response>, [Request | string]>();

/** Every text on the screen, in order. */
const drawn = () => screen.queryAllByText(/./).map((node) => node.props.children as unknown);
const held = (): Record<string, unknown> | null => {
  const raw = store.get(HELD);
  return raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);
};
const noProblems = () =>
  expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual([]);
const press = async (name: string | RegExp) =>
  fireEvent.press(await screen.findByRole("button", { name }));
/** An answer that is a whole-width row (#581) by its word, chosen or not. */
const row = (name: string) =>
  screen.getByRole(/^(radio|checkbox)$/, { name: new RegExp(`^(✓ )?${name}$`) });
const checked = (name: string) => row(name).props.accessibilityState?.checked;
const onwardDisabled = () =>
  screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled;

type Call = { line: string; body?: unknown; auth?: string };

/**
 * The API of a whole first sign-in: the exchange as `exchange` answers, then
 * an account that has nothing yet, which the saves fill. Each call is kept in
 * order, beside the moment the screen goes home.
 */
function serve(options: { exchange?: () => Response; name?: string } = {}) {
  const calls: Call[] = [];
  const order: string[] = [];
  const account = {
    name: options.name ?? null,
    gender: null as string | null,
    seeks: null as string[] | null,
    consents: [] as string[],
    home: null as typeof KALLIO | null,
  };
  const status = () => {
    const missing = [
      ...(account.name ? [] : ["name"]),
      ...(account.gender ? [] : ["gender"]),
      ...(account.seeks ? [] : ["seeks"]),
      ...(account.home ? [] : ["home"]),
      ...(account.consents.includes("terms") ? [] : ["terms"]),
      ...(account.consents.includes("privacy") ? [] : ["privacy"]),
      "age_window",
      "intent",
      "photos",
    ];
    return {
      state: "registered",
      age: 30,
      gender: account.gender,
      home: account.home,
      preferences: { seeks: account.seeks, ageWindow: null },
      consents: {
        terms: account.consents.includes("terms") ? TERMS : null,
        privacy: account.consents.includes("privacy") ? PRIVACY : null,
        specialCategory: account.consents.includes("special_category") ? SPECIAL : null,
      },
      currentVersions: { terms: TERMS, privacy: PRIVACY, special_category: SPECIAL },
      nextChange: { gender: null },
      missing,
      complete: false,
    };
  };
  const profile = (displayName: string | null, fields: unknown = {}) => ({
    profile:
      displayName === null
        ? null
        : {
            displayName,
            bio: null,
            bioPreset: null,
            fields,
            prompts: [],
            specialCategoryConsent: null,
            updatedAt: "2026-11-19T10:00:00.000Z",
          },
    completeness: { complete: false, missing: [] },
    home: account.home,
  });
  fetchMock.mockImplementation(async (input) => {
    const request = input as Request;
    const path = new URL(request.url).pathname;
    const text = request.method === "GET" ? "" : await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    const line =
      path === "/consents" ? `POST /consents ${String(body?.kind)}` : `${request.method} ${path}`;
    calls.push({ line, body, auth: request.headers.get("authorization") ?? undefined });
    order.push(line);
    if (path === "/auth/exchange") return (options.exchange ?? (() => json(tokens)))();
    if (path === "/onboarding") return json(status());
    if (path === "/profile" && request.method === "GET") return json(profile(account.name));
    if (path === "/profile") {
      account.name = String(body?.displayName);
      return json(profile(account.name, body?.fields));
    }
    if (path === "/account/gender") {
      account.gender = String(body?.gender);
      return new Response(null, { status: 204 });
    }
    if (path === "/consents") {
      account.consents.push(String(body?.kind));
      return json({ consents: [], currentVersions: status().currentVersions });
    }
    if (path === "/preferences") {
      account.seeks = body?.seeks as string[];
      return json({ seeks: account.seeks, ageWindow: null });
    }
    if (path === "/account/home") {
      account.home = KALLIO;
      return json(KALLIO);
    }
    return json({ error: { code: "not_found", message: "no", requestId: "r" } }, 404);
  });
  router.replace.mockImplementation((to: string) => order.push(`replace ${to}`));
  return { calls, order, account };
}

/** The four questions answered as a woman who seeks men and lives in Kallio. */
async function walkTheQuestions() {
  await press(/^(Get started|Continue where you left off)$/);
  fireEvent.changeText(await screen.findByLabelText("Name on your card"), "Aino");
  await press("Continue");
  await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
  await fireEvent.press(row("Woman"));
  await press("Continue");
  await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
  await fireEvent.press(row("Men"));
  await fireEvent.press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
  await press("Continue");
  fireEvent.changeText(await screen.findByLabelText("Postal code"), "00530");
  await press("0 0 5 3 0, Kallio");
  await screen.findByRole("heading", { name: "Accept terms of use" });
}

/** From the terms to the bank's browser: the attempt this phone started; its challenge. */
async function toTheBrowser(): Promise<string> {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const before = openURL.mock.calls.length;
  await press("Agree and continue");
  await press("Sign in with your bank");
  await waitFor(() => expect(openURL).toHaveBeenCalledTimes(before + 1));
  return String(openURL.mock.calls.at(-1)?.[0]).split("&code_challenge=")[1] ?? "";
}

/** The answers the walk holds, as the store keeps them: the consent is never there. */
const WALKED = {
  name: "Aino",
  gender: "woman" as const,
  seeks: ["man"] as const,
  postalCode: "00530",
};
/** The consent the walk gives, held in memory for this run. */
const CONSENTED = { version: SPECIAL, locale: "en" } as const;
/** All four answered in this run, the consent with them, as the walk leaves them. */
const answeredInThisRun = (more: Partial<Parameters<typeof holdAnswers>[0]> = {}) =>
  holdAnswers({ ...WALKED, seeks: ["man"], specialCategory: CONSENTED, ...more });

/** The app's own changes of state, as the screens listen to them. */
function appStates() {
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener) => {
    const one = listener as (state: string) => void;
    if (event === "change") listeners.push(one);
    return { remove: () => void listeners.splice(listeners.indexOf(one), 1) } as never;
  });
  return async (state: string) => {
    await act(async () => {
      for (const listener of [...listeners]) listener(state);
    });
  };
}

/** The saves after the exchange, in order, each with what it carried, bound to the new account. */
const SAVED = [
  "GET /onboarding",
  "GET /profile",
  "PUT /profile",
  "PUT /account/gender",
  "POST /consents special_category",
  "PUT /preferences",
  "PUT /account/home",
];

beforeEach(async () => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  router.replace.mockReset();
  router.setParams.mockReset();
  await clearSession();
  store.delete(AGREED);
  await dropHeldAnswers();
  dropAgreements();
  jest.spyOn(Linking, "openURL").mockClear();
});
afterEach(() => jest.restoreAllMocks());

describe("SignInScreen: the questions before the bank (#681, ADR-010 §22)", () => {
  it("The first screen says what Kumpa is before anything is asked", async () => {
    await renderWithTheme(<SignInScreen />);
    expect(
      await screen.findByRole("heading", { name: "A more confident start to dating" }),
    ).toBeTruthy();
    expect(drawn()).toEqual([
      "A more confident start to dating",
      "Kumpa is a dating community of people whose real-world identities have been verified.",
      "Verify your identity with a Finnish bank ID.",
      "Free dating for adults in Finland. Run by a registered association.",
      "Your answers stay on this phone until you make an account.",
      "Get started",
      "I already have an account",
    ]);
    // No legal text, no link, nothing asked and nothing sent.
    expect(screen.queryByRole("link")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pressables(screen.toJSON() as HostNode)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "I already have an account" })).toBeTruthy();
    noProblems();
  });

  it.each([
    ["fi-FI", "Varmempi alku deittailuun", "Aloita", "Minulla on jo tili"],
    ["sv-FI", "En mer självsäker start på dejtandet", "Kom igång", "Jag har redan ett konto"],
  ])("says what Kumpa is on a %s phone in its language", async (languageTag, ...words) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    try {
      await renderWithTheme(<SignInScreen />);
      expect(await screen.findByRole("heading", { name: words[0] })).toBeTruthy();
      expect(drawn()[0]).toBe(words[0]);
      expect(drawn().slice(-2)).toEqual(words.slice(1));
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it("The questions before the bank are held on the phone and sent nowhere", async () => {
    const before = Date.now();
    await renderWithTheme(<SignInScreen />);
    await press("Get started");
    expect(await screen.findByText("Step 1 of 4")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "What should we call you?" })).toBeTruthy();
    // Nothing moves on without an answer.
    expect(onwardDisabled()).toBe(true);
    noProblems();
    fireEvent.changeText(screen.getByLabelText("Name on your card"), "  Aino ");
    await press("Continue");
    await screen.findByText("Step 2 of 4");
    expect(held()).toMatchObject({ name: "Aino" });
    expect(onwardDisabled()).toBe(true);
    await fireEvent.press(row("Woman"));
    await press("Continue");
    await screen.findByText("Step 3 of 4");
    expect(held()).toMatchObject({ name: "Aino", gender: "woman" });
    // The consent for sensitive answers is on the screen that asks for them (ADR-019 §4).
    expect(screen.getByText("Sensitive answers")).toBeTruthy();
    await fireEvent.press(row("Men"));
    expect(onwardDisabled()).toBe(true);
    await fireEvent.press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
    expect(onwardDisabled()).toBe(false);
    noProblems();
    await press("Continue");
    await screen.findByText("Step 4 of 4");
    expect(screen.getByRole("heading", { name: "Where do you live?" })).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText("Postal code"), "00530");
    noProblems();
    await press("0 0 5 3 0, Kallio");
    // The terms next, saying why the bank is asked.
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
    expect(
      screen.getByText(
        "To keep your answers, make an account: accept the terms and identify with your bank.",
      ),
    ).toBeTruthy();
    // Held in this phone's keychain only, with the time of the last answer, and sent nowhere;
    // the consent in memory for this run alone.
    expect(held()).toEqual({ ...WALKED, at: expect.any(Number) });
    expect(Number(held()?.at)).toBeGreaterThanOrEqual(before);
    expect((await readHeldAnswers())?.specialCategory).toEqual(CONSENTED);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentSession()).toBeNull();
  });

  it("asks for a word after a non-binary gender, and holds it with the gender", async () => {
    await renderWithTheme(<SignInScreen />);
    await press("Get started");
    fireEvent.changeText(await screen.findByLabelText("Name on your card"), "Sam");
    await press("Continue");
    await waitFor(() => expect(row("Non-binary")).toBeTruthy());
    await fireEvent.press(row("Non-binary"));
    await press("Continue");
    expect(await screen.findByText("A word for it, if you like")).toBeTruthy();
    // It shares the gender's number: four questions, however many screens.
    expect(screen.getByText("Step 2 of 4")).toBeTruthy();
    await fireEvent.press(row("Genderqueer"));
    await press("Continue");
    await screen.findByText("Step 3 of 4");
    expect(held()).toMatchObject({ gender: "non_binary", identityLabel: "genderqueer" });
    // Back from whom one seeks is the word's screen, with the word chosen.
    await press("Back");
    expect(await screen.findByText("A word for it, if you like")).toBeTruthy();
    expect(checked("Genderqueer")).toBe(true);
    // Skipped, the word goes; and a gender that is not non-binary takes it away too.
    await press("Skip");
    await screen.findByText("Step 3 of 4");
    expect(held()).not.toHaveProperty("identityLabel");
  });

  it("takes the word away when the gender changes from non-binary", async () => {
    await renderWithTheme(<SignInScreen />);
    await press("Get started");
    fireEvent.changeText(await screen.findByLabelText("Name on your card"), "Sam");
    await press("Continue");
    await waitFor(() => expect(row("Non-binary")).toBeTruthy());
    await fireEvent.press(row("Non-binary"));
    await press("Continue");
    await fireEvent.press(await waitFor(() => row("Agender")));
    await press("Continue");
    await screen.findByText("Step 3 of 4");
    await press("Back");
    await press("Back");
    await waitFor(() => expect(checked("Non-binary")).toBe(true));
    await fireEvent.press(row("Man"));
    await press("Continue");
    await screen.findByText("Step 3 of 4");
    expect(held()).toMatchObject({ gender: "man" });
    expect(held()).not.toHaveProperty("identityLabel");
    // Back from whom one seeks is the gender now: no word is offered a man.
    await press("Back");
    expect(await screen.findByText("How do you describe yourself?")).toBeTruthy();
  });

  it("steps back through the questions to the first screen, and from the terms and the bank to the last question", async () => {
    await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await press("Agree and continue");
    expect(await screen.findByRole("heading", { name: "Identification" })).toBeTruthy();
    await press("Back");
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
    await press("Back");
    expect(await screen.findByText("Where do you live?")).toBeTruthy();
    expect(screen.getByText("Step 4 of 4")).toBeTruthy();
    await press("Back");
    await screen.findByText("Step 3 of 4");
    expect(checked("Men")).toBe(true);
    await press("Back");
    await screen.findByText("Step 2 of 4");
    expect(checked("Woman")).toBe(true);
    await press("Back");
    await screen.findByText("Step 1 of 4");
    expect(screen.getByLabelText("Name on your card").props.value).toBe("Aino");
    await press("Back");
    // The first screen, now offering to go on where they were.
    expect(await screen.findByRole("button", { name: "Continue where you left off" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start over" })).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("steps back by Android's back key as by the arrow, and leaves the app from the first screen", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    // Android asks the newest listener first, and the next only while each declines.
    const listeners: (() => boolean | null | undefined)[] = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, listener) => {
      listeners.push(listener as () => boolean);
      return {
        remove: () => void listeners.splice(listeners.indexOf(listener as () => boolean), 1),
      };
    });
    const backKey = async () => {
      let handled = false;
      await act(async () => {
        handled = [...listeners].reverse().some((listener) => listener() === true);
      });
      return handled;
    };
    await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await press("Agree and continue");
    await screen.findByRole("heading", { name: "Identification" });
    expect(await backKey()).toBe(true);
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
    expect(await backKey()).toBe(true);
    expect(await screen.findByText("Step 4 of 4")).toBeTruthy();
    for (const step of [3, 2, 1]) {
      expect(await backKey()).toBe(true);
      expect(await screen.findByText(`Step ${step} of 4`)).toBeTruthy();
    }
    expect(await backKey()).toBe(true);
    expect(await screen.findByRole("button", { name: "Continue where you left off" })).toBeTruthy();
    // Nothing of the screen holds the key on the first screen: Android leaves the app.
    expect(await backKey()).toBe(false);
  });

  it("listens for no back key on a phone without one", async () => {
    const listen = jest.spyOn(BackHandler, "addEventListener");
    await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await press("Agree and continue");
    await screen.findByRole("heading", { name: "Identification" });
    await press("Back");
    await press("Back");
    await screen.findByText("Step 4 of 4");
    expect(listen).not.toHaveBeenCalled();
  });

  it("goes on where the answers stop, and to the terms when all four are held", async () => {
    store.set(HELD, JSON.stringify({ name: "Aino", gender: "woman", at: Date.now() }));
    const view = await renderWithTheme(<SignInScreen />);
    await press("Continue where you left off");
    expect(await screen.findByText("Step 3 of 4")).toBeTruthy();
    expect(screen.getByText("Whom are you looking for?")).toBeTruthy();
    await view.unmount();

    await answeredInThisRun();
    await renderWithTheme(<SignInScreen />);
    await press("Continue where you left off");
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
  });

  it("asks the consent again once the app was closed, with whom one seeks still chosen", async () => {
    store.set(HELD, JSON.stringify({ ...WALKED, at: Date.now() }));
    await renderWithTheme(<SignInScreen />);
    await press("Continue where you left off");
    expect(await screen.findByText("Step 3 of 4")).toBeTruthy();
    expect(checked("Men")).toBe(true);
    expect(
      screen.getByLabelText("I consent to Kuutti ry storing whom I seek").props.accessibilityState
        ?.checked,
    ).toBe(false);
    expect(onwardDisabled()).toBe(true);
  });

  it("The consent for sensitive answers is asked of whoever is at the phone", async () => {
    // Given to the screen: the app leaves it before Continue, and the switch is off on the way back.
    const appState = appStates();
    await renderWithTheme(<SignInScreen />);
    await press("Get started");
    fireEvent.changeText(await screen.findByLabelText("Name on your card"), "Aino");
    await press("Continue");
    await waitFor(() => expect(row("Woman")).toBeTruthy());
    await fireEvent.press(row("Woman"));
    await press("Continue");
    await waitFor(() => expect(row("Men")).toBeTruthy());
    await fireEvent.press(row("Men"));
    const consent = () => screen.getByLabelText("I consent to Kuutti ry storing whom I seek");
    await fireEvent.press(consent());
    expect(onwardDisabled()).toBe(false);
    await appState("inactive");
    expect(consent().props.accessibilityState?.checked).toBe(true);
    await appState("background");
    await appState("active");
    expect(consent().props.accessibilityState?.checked).toBe(false);
    expect(onwardDisabled()).toBe(true);
  });

  it("drops the consent held when the app leaves the terms, and saves whom one seeks once it is given again", async () => {
    const { order } = serve();
    const appState = appStates();
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await appState("background");
    await appState("active");
    expect(await readHeldAnswers()).toEqual({ ...WALKED, at: expect.any(Number) });
    // Back on the question it was asked with, off, and nothing goes on without it.
    await press("Back");
    await press("Back");
    await screen.findByText("Step 3 of 4");
    const consent = () => screen.getByLabelText("I consent to Kuutti ry storing whom I seek");
    expect(consent().props.accessibilityState?.checked).toBe(false);
    expect(onwardDisabled()).toBe(true);
    // Given again by whoever is at the phone now, it goes with the bank attempt.
    await fireEvent.press(consent());
    await press("Continue");
    fireEvent.changeText(await screen.findByLabelText("Postal code"), "00530");
    await press("0 0 5 3 0, Kallio");
    await toTheBrowser();
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order.slice(-SAVED.length - 1, -1)).toEqual(SAVED);
  });

  it("withdraws the consent held when the switch is turned off", async () => {
    await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await press("Back");
    await press("Back");
    await screen.findByText("Step 3 of 4");
    const consent = () => screen.getByLabelText("I consent to Kuutti ry storing whom I seek");
    expect(consent().props.accessibilityState?.checked).toBe(true);
    await fireEvent.press(consent());
    await waitFor(async () =>
      expect(await readHeldAnswers()).toEqual({ ...WALKED, at: expect.any(Number) }),
    );
    expect(onwardDisabled()).toBe(true);
    // Whom one seeks stays held; the next walk asks the consent with it.
    expect(held()).toMatchObject({ seeks: ["man"] });
  });

  describe("shows nothing of answers that went from under the screen", () => {
    it.each([
      ["when it has the focus back", async () => act(async () => focus())],
      [
        "when the app comes back",
        async (appState: (state: string) => Promise<void>) => appState("active"),
      ],
    ])("%s", async (_, back) => {
      const appState = appStates();
      await renderWithTheme(<SignInScreen />);
      await press("Get started");
      fireEvent.changeText(await screen.findByLabelText("Name on your card"), "Aino");
      await press("Continue");
      await screen.findByText("Step 2 of 4");
      // Still held: the screen stays where it is.
      await back(appState);
      expect(screen.getByText("Step 2 of 4")).toBeTruthy();
      // The bank's screen over this one removed them, or their hour ran out.
      store.delete(HELD);
      await back(appState);
      expect(await screen.findByRole("button", { name: "Get started" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    });

    it("stays on the terms and the bank, which ask nothing of the answers", async () => {
      await renderWithTheme(<SignInScreen />);
      await walkTheQuestions();
      store.delete(HELD);
      await act(async () => focus());
      expect(screen.getByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
    });
  });

  it("starts over from an empty name, the answers held before removed", async () => {
    store.set(HELD, JSON.stringify({ ...WALKED, at: Date.now() }));
    await renderWithTheme(<SignInScreen />);
    await press("Start over");
    expect(await screen.findByText("Step 1 of 4")).toBeTruthy();
    expect(screen.getByLabelText("Name on your card").props.value).toBe("");
    await waitFor(() => expect(store.has(HELD)).toBe(false));
  });

  it("starts over with nothing of the last person's: the terms are asked again", async () => {
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await press("Agree and continue");
    await screen.findByRole("heading", { name: "Identification" });
    await view.unmount();
    // The next person on the phone.
    await renderWithTheme(<SignInScreen />);
    await press("Start over");
    await screen.findByText("Step 1 of 4");
    expect(await readHeldAnswers()).toBeNull();
    await press("Back");
    await press("I already have an account");
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
  });

  it("begins afresh on answers held longer than an hour", async () => {
    store.set(HELD, JSON.stringify({ ...WALKED, at: Date.now() - HELD_ANSWERS_FOR_MS - 1 }));
    await renderWithTheme(<SignInScreen />);
    expect(await screen.findByRole("button", { name: "Get started" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
    expect(store.has(HELD)).toBe(false);
  });

  it("The bank login saves the held answers right after the exchange", async () => {
    const { calls, order } = serve();
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    const challenge = await toTheBrowser();
    // Bound to this attempt, so only its exchange saves them.
    expect(held()).toMatchObject({ ...WALKED, attempt: challenge });
    expect(held()).not.toHaveProperty("specialCategory");
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    // All before the screen goes home: onboarding then finds them saved and asks the rest.
    expect(order).toEqual([
      "POST /auth/exchange",
      "POST /consents terms",
      "POST /consents privacy",
      ...SAVED,
      "replace /",
    ]);
    const sent = (line: string) => calls.find((call) => call.line === line);
    expect(sent("PUT /profile")?.body).toMatchObject({ displayName: "Aino", fields: {} });
    expect(sent("PUT /account/gender")?.body).toEqual({ gender: "woman" });
    expect(sent("POST /consents special_category")?.body).toEqual({
      kind: "special_category",
      version: SPECIAL,
      locale: "en",
    });
    expect(sent("PUT /preferences")?.body).toEqual({ seeks: ["man"] });
    expect(sent("PUT /account/home")?.body).toEqual({ postalCode: "00530" });
    // Each in the new account's name.
    for (const call of calls.filter((c) => c.line !== "POST /auth/exchange")) {
      expect(call.auth).toBe(`Bearer ${tokens.accessToken}`);
    }
    // Saved, they are gone from the phone.
    expect(store.has(HELD)).toBe(false);
  });

  it("saves the word given after a non-binary gender with the name", async () => {
    const { calls } = serve();
    await answeredInThisRun({ gender: "non_binary", identityLabel: "agender" });
    const again = await renderWithTheme(<SignInScreen />);
    await press("Continue where you left off");
    await toTheBrowser();
    await again.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const sent = (line: string) => calls.find((call) => call.line === line);
    expect(sent("PUT /profile")?.body).toMatchObject({
      displayName: "Aino",
      fields: { identityLabel: "agender" },
    });
    expect(sent("PUT /account/gender")?.body).toEqual({ gender: "non_binary" });
  });

  it("Answers held for another attempt are saved in nobody's account", async () => {
    const { order } = serve();
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    // Another attempt's mark, as if started elsewhere since: its code is exchanged, the answers are not its.
    await markLoginStarted("e".repeat(64));
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual(["POST /auth/exchange", "replace /"]);
    // And they are gone: the phone has an account signed in now.
    expect(store.has(HELD)).toBe(false);
  });

  it("saves nothing held when somebody with an account signs in on this phone", async () => {
    store.set(AGREED, JSON.stringify({ terms: TERMS, privacy: PRIVACY }));
    store.set(HELD, JSON.stringify({ ...WALKED, at: Date.now() }));
    const { order } = serve();
    const view = await renderWithTheme(<SignInScreen />);
    await press("I already have an account");
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await press("Sign in with your bank");
    await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
    // Not carried into this attempt: they are somebody's who never signed in.
    expect(held()).not.toHaveProperty("attempt");
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual(["POST /auth/exchange", "replace /"]);
    expect(store.has(HELD)).toBe(false);
  });

  it("fills only what the account lacks when somebody with one answered the questions anyway", async () => {
    // A name on the account already: the one held is not written over it.
    const { order } = serve({ name: "Iida" });
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).not.toContain("PUT /profile");
    expect(order).toContain("PUT /account/gender");
  });

  it("signs in and goes home when the saves fail, leaving to onboarding what did not land", async () => {
    const { order } = serve();
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    // Every route after the exchange refuses, or cannot be reached.
    const answer = fetchMock.getMockImplementation();
    let refusals = 0;
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      if (new URL(request.url).pathname === "/auth/exchange") return answer?.(input) as never;
      refusals += 1;
      if (refusals % 2 === 0) throw new TypeError("Network request failed");
      return json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500);
    });
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toContain("POST /auth/exchange");
    expect(currentSession()?.sessionId).toBe(tokens.sessionId);
    expect(screen.queryByText("Sign-in did not complete")).toBeNull();
    expect(store.has(HELD)).toBe(false);
  });

  describe("A refusal that lasts removes the held answers", () => {
    it.each([["auth_under_18"], ["auth_banned"], ["auth_suspended"], ["auth_cooldown"]])(
      "%s",
      async (error) => {
        const view = await renderWithTheme(<SignInScreen />);
        await walkTheQuestions();
        await toTheBrowser();
        await view.unmount();
        // The bank's answer opens a screen of its own (`/auth`).
        await renderWithTheme(<SignInScreen error={error} />);
        expect(await screen.findByText("Sign-in did not complete")).toBeTruthy();
        await waitFor(() => expect(store.has(HELD)).toBe(false));
        // Back on the first screen nothing is offered to go on with.
        await press("Back");
        expect(await screen.findByRole("button", { name: "Get started" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Start over" })).toBeNull();
      },
    );
  });

  it("removes the held answers at a refusal that lasts on the screen that opened the bank", async () => {
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    await view.rerender(underProviders(<SignInScreen error="auth_under_18" />));
    expect(await screen.findByText(/Kumpa is for adults/)).toBeTruthy();
    await waitFor(() => expect(store.has(HELD)).toBe(false));
  });

  it("A cancelled bank login keeps the held answers", async () => {
    const { order } = serve();
    const first = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    await first.unmount();
    // The bank's answer opens a screen of its own (`/auth`).
    const view = await renderWithTheme(<SignInScreen error="auth_cancelled" />);
    expect(await screen.findByText("Nothing was saved.")).toBeTruthy();
    expect(held()).toMatchObject(WALKED);
    // Another try asks for the terms again, as a newcomer's, and carries the answers.
    await press("Try again");
    expect(
      await screen.findByText(
        "To keep your answers, make an account: accept the terms and identify with your bank.",
      ),
    ).toBeTruthy();
    const challenge = await toTheBrowser();
    expect(held()).toMatchObject({ ...WALKED, attempt: challenge });
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order.slice(-SAVED.length - 1, -1)).toEqual(SAVED);
  });

  it("asks the consent after the bank when the attempt it went with was left without an answer", async () => {
    const { order } = serve();
    const view = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    // Back from a browser closed without a link: whoever taps now may be somebody else.
    await press("Sign in with your bank");
    expect(await screen.findByRole("heading", { name: "Accept terms of use" })).toBeTruthy();
    await toTheBrowser();
    expect((await readHeldAnswers())?.specialCategory).toBeUndefined();
    // The screen shows so: back on its question the switch is off.
    await press("Back");
    await press("Back");
    await press("Back");
    await screen.findByText("Step 3 of 4");
    expect(
      screen.getByLabelText("I consent to Kuutti ry storing whom I seek").props.accessibilityState
        ?.checked,
    ).toBe(false);
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).not.toContain("POST /consents special_category");
    expect(order).not.toContain("PUT /preferences");
    expect(order).toContain("PUT /account/home");
  });

  it("keeps the held answers past a refused exchange, for the next try", async () => {
    let exchanges = 0;
    const { order } = serve({
      exchange: () => {
        exchanges += 1;
        return exchanges === 1
          ? json({ error: { code: "auth_code_used", message: "x", requestId: "r" } }, 401)
          : json(tokens);
      },
    });
    const first = await renderWithTheme(<SignInScreen />);
    await walkTheQuestions();
    await toTheBrowser();
    await first.unmount();
    const view = await renderWithTheme(<SignInScreen code={CODE} />);
    await press("Try again");
    await toTheBrowser();
    await view.rerender(underProviders(<SignInScreen code={"d".repeat(43)} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order.filter((line) => line === "POST /auth/exchange")).toHaveLength(2);
    expect(order.slice(-SAVED.length - 1, -1)).toEqual(SAVED);
  });
});
