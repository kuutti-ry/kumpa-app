import { createHash } from "node:crypto";
import { CONSENT_VERSIONS } from "@kuutti/i18n";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import * as React from "react";
import { AppState, Linking, Platform } from "react-native";
import { apiBaseUrl } from "@/lib/api";
import { LocaleProvider } from "@/lib/locale";
import { clearSession, currentSession, markLoginStarted, saveSession } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme, underProviders } from "@/test/render";
import { dropAgreements, heldAgreements, holdAgreements } from "./agreements";
import { SignInScreen } from "./SignInScreen";
import { SessionProvider, useSession } from "./session";

const { __router: router } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; replace: jest.Mock; setParams: jest.Mock };
};

/** Every text on the screen, in order. */
const drawn = () => screen.queryAllByText(/./).map((node) => node.props.children as unknown);
/** The bank's screen before anything happens: its title and why the bank is asked (#681). */
const IDENTIFY = [
  "Identification",
  "Use your Finnish bank ID to confirm your identity and age.",
  "This is an identity check, not a payment.",
  "Kumpa does not keep your name or your identity code from the bank. Others see the name you choose.",
];
const IDENTIFY_FI = [
  "Tunnistautuminen",
  "Vahvista henkilöllisyytesi ja ikäsi suomalaisilla pankkitunnuksilla.",
  "Tämä on henkilöllisyyden tarkistus, ei maksu.",
  "Kumpa ei tallenna pankilta saatua nimeäsi eikä henkilötunnustasi. Muut näkevät valitsemasi nimen.",
];
const IDENTIFY_SV = [
  "Identifiering",
  "Bekräfta din identitet och ålder med finskt bank-ID.",
  "Det här är en identitetskontroll, inte en betalning.",
  "Kumpa sparar inte ditt namn eller din personbeteckning från banken. Andra ser namnet du väljer.",
];
/** The bank's screen with nothing more to say: those lines and its button (#581, #681). */
const READY = [...IDENTIFY, "Sign in with your bank"];
/** The card of a refusal with no fact of its own: its title and Try again say it all (#581). */
const REFUSED = "Sign-in did not complete";
const BARE_REFUSAL = [...IDENTIFY, REFUSED, "Try again"];
const NOT_REQUESTED = "This sign-in link was not requested from this phone.";
const UNDER_18 = "Kumpa is for adults. You are welcome once you are 18.";
/** The heading of the terms' screen before the bank (#681). */
const TERMS_TITLE = "Accept terms of use";
const AGREE = "Agree and continue";
const HAVE_ACCOUNT = "I already have an account";

const CODE = "c".repeat(43);
// Any well-formed verifier of the attempt (ADR-027): 64 lowercase hex characters.
const VERIFIER = "5a1e".repeat(16);
const HEX_64 = /^[0-9a-f]{64}$/;
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const tokens = {
  sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
  accessToken: token("access"),
  accessExpiresAt: "2030-01-01T00:15:00.000Z",
  refreshToken: `${token("family")}.${token("refresh")}`,
  refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  outcome: "created",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchMock = jest.fn<Promise<Response>, [Request | string]>();

/** The /auth/start URL the button opened last, with its challenge taken apart (ADR-027). */
function lastStart(openURL: jest.SpyInstance): { url: string; challenge: string | undefined } {
  const [url = "", challenge] = String(openURL.mock.calls.at(-1)?.[0]).split("&code_challenge=");
  return { url, challenge };
}

/** Presses the sign-in button and answers the challenge of the start it opened. */
async function pressStart(openURL: jest.SpyInstance): Promise<string | undefined> {
  const before = openURL.mock.calls.length;
  await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
  await waitFor(() => expect(openURL).toHaveBeenCalledTimes(before + 1));
  return lastStart(openURL).challenge;
}

const { __store: store } = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};
const AGREED = "kuutti.preference.agreedVersions";
const TERMS = String(CONSENT_VERSIONS.terms);
const PRIVACY = String(CONSENT_VERSIONS.privacy);
/** This phone recorded the wordings it carries after an earlier bank login (#418): straight to the bank. */
const remember = () => store.set(AGREED, JSON.stringify({ terms: TERMS, privacy: PRIVACY }));

beforeEach(async () => {
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockReset();
  router.replace.mockReset();
  router.setParams.mockReset();
  await clearSession();
  // A phone that never answered the screens before the bank, with nothing held from this run.
  store.delete(AGREED);
  dropAgreements();
  // Both are jest's own mocks already (react-native's setup, jest.setup.js), which
  // restoreAllMocks leaves alone: their calls are counted per test from here.
  jest.spyOn(Linking, "openURL").mockClear();
  (SecureStore.getItemAsync as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

/**
 * Somebody with an account on the first screen (#681): its way past the
 * questions, to the bank's screen on a phone that recorded the terms.
 */
async function toTheBank(haveAccount = HAVE_ACCOUNT): Promise<void> {
  await fireEvent.press(await screen.findByRole("button", { name: haveAccount }));
  await waitFor(() => expect(screen.queryByRole("button", { name: haveAccount })).toBeNull());
}

/** Renders the screen and goes to the bank as somebody with an account. */
async function atTheBank(ui: React.ReactElement, haveAccount?: string) {
  const view = await renderWithTheme(ui);
  await toTheBank(haveAccount);
  return view;
}

/** The screen as the provider shows it once the lock's way out was taken (#418). */
function Leaving() {
  const { status, signOut } = useSession();
  React.useEffect(() => {
    if (status === "signed-in") void signOut("lock");
  }, [status, signOut]);
  return <SignInScreen />;
}

describe("SignInScreen", () => {
  // The bank half of the sign-in, on a phone past the screens before it.
  beforeEach(remember);

  it("has a heading, why the bank is asked, the way back and one labelled button, with no accessibility problems (#581, #681)", async () => {
    await atTheBank(<SignInScreen />);
    expect(await screen.findByRole("heading", { name: "Identification" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(drawn()).toEqual(READY);
    const found = pressables(screen.toJSON() as HostNode);
    expect(found.map((node) => node.props.accessibilityLabel)).toEqual([
      "Back",
      "Sign in with your bank",
    ]);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
  });

  it("says the account is on a break right after this device paused it, the card's title alone, and the way back (#581)", async () => {
    await saveSession(tokens);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // The screen as the provider shows it once the break began on this device (#170).
    function Pausing() {
      const session = useSession();
      const { status, pauseAccount } = session;
      React.useEffect(() => {
        if (status === "signed-in") void pauseAccount();
      }, [status, pauseAccount]);
      return <SignInScreen />;
    }
    await renderWithTheme(<Pausing />);
    expect(await screen.findByText("Your account is on a break")).toBeTruthy();
    expect(
      within(screen.getByLabelText("Your account is on a break"))
        .getAllByText(/./)
        .map((node) => node.props.children),
    ).toEqual(["Your account is on a break"]);
    expect(currentSession()).toBeNull();
    // The way back is the same button as always.
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );
  });

  it("says nothing of a break or of the lock to a device that was simply signed out", async () => {
    await saveSession(tokens);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    function LoggingOut() {
      const { status, signOut } = useSession();
      React.useEffect(() => {
        if (status === "signed-in") void signOut();
      }, [status, signOut]);
      return <SignInScreen />;
    }
    await renderWithTheme(<LoggingOut />);
    await waitFor(() => expect(currentSession()).toBeNull());
    // No notice: the first screen, as for anybody signed out (#681).
    expect(
      await screen.findByRole("heading", { name: "A more confident start to dating" }),
    ).toBeTruthy();
    await toTheBank();
    expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(drawn()).toEqual(READY);
  });

  it("says the lock signed this phone out, that the lock is off now, and the way back", async () => {
    await saveSession(tokens);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await renderWithTheme(<Leaving />);
    expect(await screen.findByText("Signed out by the lock")).toBeTruthy();
    expect(screen.getByLabelText("Signed out by the lock")).toBeTruthy();
    expect(
      screen.getByText(
        "Nothing on your account changed. The lock is off until you turn it on again in Settings.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Your account is on a break")).toBeNull();
    expect(currentSession()).toBeNull();
    // The way back is the same button as always.
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );
  });

  it.each([
    [
      "fi-FI",
      "Lukitus kirjasi sinut ulos",
      "Tilillesi ei muuttunut mitään. Lukitus on pois päältä, kunnes otat sen taas käyttöön asetuksista.",
    ],
    [
      "sv-FI",
      "Låset loggade ut dig",
      "Ingenting ändrades på ditt konto. Låset är av tills du slår på det igen i inställningarna.",
    ],
  ])("says what the lock left behind on a %s phone (#581)", async (languageTag, title, body) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    try {
      await saveSession(tokens);
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await renderWithTheme(<Leaving />);
      expect(await screen.findByText(title)).toBeTruthy();
      expect(screen.getByText(body)).toBeTruthy();
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it("opens the system browser at the API's /auth/start for this platform", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await atTheBank(<SignInScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    expect(lastStart(openURL)).toEqual({
      url: `${apiBaseUrl()}/auth/start?platform=ios&locale=en`,
      challenge: expect.stringMatching(HEX_64),
    });
    // The browser covers the screen as it opens: no line goes stale under it, and the button is there on the way back (#581).
    expect(drawn()).toEqual(READY);
  });

  it("starts with the SHA-256 of a fresh verifier each time, and exchanges the code with the latest one", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    fetchMock.mockResolvedValueOnce(json(tokens));
    const view = await atTheBank(<SignInScreen />);
    const first = await pressStart(openURL);
    // A second tap, as when the first browser tab was lost: a new attempt.
    const second = await pressStart(openURL);
    expect(first).toMatch(HEX_64);
    expect(second).toMatch(HEX_64);
    expect(second).not.toBe(first);

    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const sent = fetchMock.mock.calls[0]?.[0] as Request;
    const body = JSON.parse(await sent.text());
    expect(body).toEqual({ code: CODE, verifier: expect.stringMatching(HEX_64) });
    // The verifier is the one whose hash the latest start carried; the deep link never had it.
    expect(sha256(body.verifier)).toBe(second);
    expect(currentSession()?.sessionId).toBe(tokens.sessionId);
  });

  it("says the sign-in did not complete when the API refuses the code for its verifier", async () => {
    // The API binds each code to its attempt's challenge: here the code came
    // back from the first of two starts, so the latest verifier does not fit.
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const view = await atTheBank(<SignInScreen />);
    const first = await pressStart(openURL);
    expect(first).toMatch(HEX_64);
    await pressStart(openURL);
    fetchMock.mockImplementationOnce(async (request) => {
      const { verifier } = JSON.parse(await (request as Request).text());
      return sha256(verifier) === first
        ? json(tokens)
        : json({ error: { code: "auth_code_used", message: "x", requestId: "r" } }, 401);
    });

    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(drawn()).toEqual(BARE_REFUSAL);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(currentSession()).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("exchanges the code the deep link carried, keeps the session and goes home", async () => {
    await markLoginStarted(VERIFIER);
    fetchMock.mockResolvedValueOnce(json(tokens));
    await renderWithTheme(<SignInScreen code={CODE} />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    const sent = fetchMock.mock.calls[0]?.[0] as Request;
    expect(sent.url).toBe(`${apiBaseUrl()}/auth/exchange`);
    expect(JSON.parse(await sent.text())).toEqual({ code: CODE, verifier: VERIFIER });
    expect(currentSession()?.sessionId).toBe(tokens.sessionId);
    expect(screen.queryByRole("button")).toBeNull();
    // What stands until home takes over, and a screen reader hears it: nothing says it is done (#581).
    expect(drawn()).toEqual([...IDENTIFY, "Signing you in…"]);
    expect(screen.getByText("Signing you in…").props.accessibilityLiveRegion).toBe("polite");
  });

  it("refuses a code for a login this phone did not start", async () => {
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(await screen.findByText(NOT_REQUESTED)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a code that arrives while the phone is signed in", async () => {
    await markLoginStarted(VERIFIER);
    const { outcome: _outcome, ...stored } = tokens;
    await saveSession(stored);
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(await screen.findByText(NOT_REQUESTED)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(currentSession()?.sessionId).toBe(tokens.sessionId); // untouched
  });

  it("forgets a login it started after ten minutes", async () => {
    await markLoginStarted(VERIFIER, Date.now() - 11 * 60 * 1000);
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(await screen.findByText(NOT_REQUESTED)).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says a used code did not complete the sign-in, the card's title alone, and offers to start again (#581)", async () => {
    await markLoginStarted(VERIFIER);
    fetchMock.mockResolvedValueOnce(
      json({ error: { code: "auth_code_used", message: "x", requestId: "r" } }, 401),
    );
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(drawn()).toEqual(BARE_REFUSAL);
    expect(currentSession()).toBeNull();
  });

  it.each([
    ["en-US", "Too many sign-ins were started just now. Wait a minute and try again."],
    [
      "fi-FI",
      "Kirjautumisia on juuri nyt aloitettu liian monta. Odota minuutti ja yritä uudelleen.",
    ],
    ["sv-FI", "Just nu har för många inloggningar påbörjats. Vänta en minut och försök igen."],
  ])(
    "says a start refused for the sign-in's rate in words on a %s phone (ADR-026 §4)",
    async (languageTag, text) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
      try {
        await renderWithTheme(<SignInScreen error="auth_rate_limited" />);
        expect(await screen.findByText(text)).toBeTruthy();
        // The way back and the one button.
        expect(screen.getAllByRole("button")).toHaveLength(2);
        // The code itself is never shown.
        expect(screen.queryByText(/auth_rate_limited/)).toBeNull();
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    },
  );

  it("says the same wait when the exchange is refused for the rate, and keeps no session", async () => {
    await markLoginStarted(VERIFIER);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: "rate_limited", message: "x", requestId: "r" } }),
        { status: 429, headers: { "content-type": "application/json", "retry-after": "42" } },
      ),
    );
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(
      await screen.findByText(
        "Too many sign-ins were started just now. Wait a minute and try again.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(currentSession()).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the refusal the deep link carried", async () => {
    await renderWithTheme(<SignInScreen error="auth_under_18" />);
    expect(await screen.findByText(UNDER_18)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
  });

  it("shows a refusal that arrives while the screen is shown, after another try", async () => {
    jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    const view = await renderWithTheme(<SignInScreen error="auth_under_18" />);
    expect(await screen.findByText(UNDER_18)).toBeTruthy();

    // Another try: the bank opens, the refusal goes with it, and what the last link said is put away.
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    await waitFor(() => expect(drawn()).toEqual(READY));
    expect(router.setParams).toHaveBeenCalledWith({
      code: undefined,
      error: undefined,
      until: undefined,
      reason: undefined,
    });
    await view.rerender(underProviders(<SignInScreen />));
    expect(drawn()).toEqual(READY);

    // The link comes back to the same screen with another refusal.
    await view.rerender(underProviders(<SignInScreen error="auth_banned" />));
    expect(await screen.findByText("This person may not use Kumpa.")).toBeTruthy();

    // And with the same one again, after one more try.
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    await view.rerender(underProviders(<SignInScreen />));
    await waitFor(() => expect(drawn()).toEqual(READY));
    await view.rerender(underProviders(<SignInScreen error="auth_banned" />));
    expect(await screen.findByText("This person may not use Kumpa.")).toBeTruthy();
  });

  describe("the refusals with no fact of their own (#581)", () => {
    it.each([
      ["auth_code_used"],
      ["auth_state_mismatch"],
      ["auth_provider_error"],
      ["generic"],
      ["something_else"],
      // A crafted link: a prototype member is a code like any other, and finds nothing.
      ["toString"],
      ["constructor"],
      ["__proto__"],
    ])("draws the card's title alone over Try again for %s", async (error) => {
      await renderWithTheme(<SignInScreen error={error} />);
      expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
      expect(drawn()).toEqual(BARE_REFUSAL);
      // Its label is the card's, for a screen reader to land on, and no code is ever said.
      expect(screen.getByLabelText(REFUSED)).toBeTruthy();
      const found = pressables(screen.toJSON() as HostNode);
      expect(found).toHaveLength(2);
      expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
    });

    it.each([
      ["fi-FI", IDENTIFY_FI, "Kirjautuminen ei onnistunut", "Yritä uudelleen"],
      ["sv-FI", IDENTIFY_SV, "Inloggningen slutfördes inte", "Försök igen"],
    ])("says it in the language of a %s phone", async (languageTag, lines, title, retry) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
      try {
        await renderWithTheme(<SignInScreen error="auth_code_used" />);
        expect(await screen.findByRole("button", { name: retry })).toBeTruthy();
        expect(drawn()).toEqual([...lines, title, retry]);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });
  });

  describe("the refusals that keep a line, cut to the fact (#581)", () => {
    it.each([
      ["auth_cancelled", "en-US", "Nothing was saved."],
      ["auth_cancelled", "fi-FI", "Mitään ei tallennettu."],
      ["auth_cancelled", "sv-FI", "Inget sparades."],
      ["unexpected_link", "en-US", NOT_REQUESTED],
      ["unexpected_link", "fi-FI", "Tätä kirjautumislinkkiä ei pyydetty tältä puhelimelta."],
      [
        "unexpected_link",
        "sv-FI",
        "Den här inloggningslänken begärdes inte från den här telefonen.",
      ],
      // The API refused the exchange for want of Apple's word on the app (ADR-069).
      ["attestation_refused", "en-US", "Apple could not confirm the app on this iPhone."],
      ["attestation_refused", "fi-FI", "Apple ei voinut varmistaa sovellusta tällä iPhonella."],
      ["attestation_refused", "sv-FI", "Apple kunde inte bekräfta appen på den här iPhonen."],
    ])("says %s on a %s phone in the one line, under the title", async (error, tag, line) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        await renderWithTheme(<SignInScreen error={error} />);
        expect(await screen.findByText(line)).toBeTruthy();
        // The screen's lines, the card's title, that line, and Try again: the second sentence was the button's.
        expect(drawn()).toHaveLength(IDENTIFY.length + 3);
        expect(drawn()[IDENTIFY.length + 1]).toBe(line);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });
  });

  it("shows the cooldown with its date in the app's locale", async () => {
    await renderWithTheme(<SignInScreen error="auth_cooldown" until="2026-10-22T10:00:00.000Z" />);
    expect(await screen.findByText(/The earliest day for a new one: 22.10.2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  describe("the button under a refusal (#466)", () => {
    it.each([["auth_under_18"], ["auth_banned"], ["auth_suspended"], ["auth_cooldown"]])(
      "offers the sign-in, not another try, under %s, a refusal that lasts",
      async (error) => {
        await renderWithTheme(<SignInScreen error={error} />);
        const button = await screen.findByRole("button", { name: "Sign in with your bank" });
        // The label a screen reader says and the words on the button, each on its own.
        expect(button.props.accessibilityLabel).toBe("Sign in with your bank");
        expect(screen.getByText("Sign in with your bank")).toBeTruthy();
        expect(screen.queryByText("Try again")).toBeNull();
        const found = pressables(screen.toJSON() as HostNode);
        expect(found).toHaveLength(2);
        expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
      },
    );

    it.each([
      ["auth_code_used"],
      ["auth_state_mismatch"],
      ["auth_provider_error"],
      ["auth_cancelled"],
      ["auth_rate_limited"],
      ["rate_limited"],
      ["unexpected_link"],
      ["attestation_refused"],
      ["something_else"],
      ["toString"],
    ])("keeps Try again under %s, a refusal that may pass", async (error) => {
      await renderWithTheme(<SignInScreen error={error} />);
      const button = await screen.findByRole("button", { name: "Try again" });
      expect(button.props.accessibilityLabel).toBe("Try again");
      expect(screen.getByText("Try again")).toBeTruthy();
      expect(screen.queryByText("Sign in with your bank")).toBeNull();
    });

    it("follows the refusal on the screen when the next one is of the other kind", async () => {
      const view = await renderWithTheme(<SignInScreen error="auth_cooldown" />);
      expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
      await view.rerender(underProviders(<SignInScreen error="auth_cancelled" />));
      expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sign in with your bank" })).toBeNull();
      await view.rerender(underProviders(<SignInScreen error="auth_suspended" />));
      expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    });

    it("keeps the bank one press away after a cooldown: the phone may be somebody else's", async () => {
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
      await renderWithTheme(
        <SignInScreen error="auth_cooldown" until="2026-10-22T10:00:00.000Z" />,
      );
      expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
      await pressStart(openURL);
      expect(lastStart(openURL).url).toBe(`${apiBaseUrl()}/auth/start?platform=ios&locale=en`);
      await waitFor(() => expect(drawn()).toEqual(READY));
    });

    it.each([
      ["fi-FI", "Kirjaudu pankkitunnuksilla", "Yritä uudelleen"],
      ["sv-FI", "Logga in med din bank", "Försök igen"],
    ])("says each button in the language of a %s phone", async (languageTag, signIn, tryAgain) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
      try {
        const view = await renderWithTheme(<SignInScreen error="auth_banned" />);
        expect(await screen.findByRole("button", { name: signIn })).toBeTruthy();
        await view.rerender(underProviders(<SignInScreen error="auth_cancelled" />));
        expect(await screen.findByRole("button", { name: tryAgain })).toBeTruthy();
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });
  });

  it("names the day a suspension ends, the start of that day in Finland", async () => {
    // Midnight in Finland in summer time (ADR-024 §5), as the API sends it.
    await renderWithTheme(<SignInScreen error="auth_suspended" until="2026-10-21T21:00:00.000Z" />);
    expect(
      await screen.findByText("This account is suspended. You can sign in again from: 22.10.2026"),
    ).toBeTruthy();
    expect(screen.queryByText("This account is suspended for now.")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
  });

  it("reads the suspension's day in Finland's zone, whatever the phone's", async () => {
    // The test process keeps the machine's zone (UTC on CI). Just after
    // midnight in Finland is still the day before in UTC and anywhere west;
    // just before midnight is already the next day anywhere east.
    const view = await renderWithTheme(
      <SignInScreen error="auth_suspended" until="2026-10-21T21:30:00.000Z" />,
    );
    expect(await screen.findByText(/You can sign in again from: 22\.10\.2026$/)).toBeTruthy();
    // Winter time: midnight is 22:00 UTC.
    await view.rerender(
      underProviders(<SignInScreen error="auth_suspended" until="2026-11-08T22:00:00.000Z" />),
    );
    expect(await screen.findByText(/You can sign in again from: 9\.11\.2026$/)).toBeTruthy();
    await view.rerender(
      underProviders(<SignInScreen error="auth_suspended" until="2026-11-08T21:59:59.999Z" />),
    );
    expect(await screen.findByText(/You can sign in again from: 8\.11\.2026$/)).toBeTruthy();
  });

  it.each([
    ["fi-FI", "Tämä tili on jäädytetty. Voit kirjautua taas sisään alkaen: 9.11.2026"],
    ["sv-FI", "Det här kontot är avstängt. Du kan logga in igen från och med: 9.11.2026"],
  ])("names the suspension's day on a %s phone in its language", async (languageTag, text) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    try {
      await renderWithTheme(
        <SignInScreen error="auth_suspended" until="2026-11-08T22:00:00.000Z" />,
      );
      expect(await screen.findByText(text)).toBeTruthy();
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it("says the plain sentence for a suspension whose link carries no day, or one that is not a date", async () => {
    const view = await renderWithTheme(<SignInScreen error="auth_suspended" />);
    expect(await screen.findByText("This account is suspended for now.")).toBeTruthy();
    await view.rerender(
      underProviders(<SignInScreen error="auth_suspended" until="2026-10-21T21:00:00.000Z" />),
    );
    expect(await screen.findByText(/You can sign in again from: 22\.10\.2026$/)).toBeTruthy();
    await view.rerender(underProviders(<SignInScreen error="auth_suspended" until="not a date" />));
    expect(await screen.findByText("This account is suspended for now.")).toBeTruthy();
    await view.rerender(underProviders(<SignInScreen error="auth_suspended" until="" />));
    expect(await screen.findByText("This account is suspended for now.")).toBeTruthy();
    expect(screen.queryByText(/You can sign in again from/)).toBeNull();
  });

  it("names no day for a ban, whatever day its link carries", async () => {
    await renderWithTheme(<SignInScreen error="auth_banned" until="2026-10-21T21:00:00.000Z" />);
    expect(await screen.findByText("This person may not use Kumpa.")).toBeTruthy();
    expect(screen.queryByText(/22\.10\.2026/)).toBeNull();
  });

  describe("the reason of a suspension or a ban (#715, ADR-073 §1)", () => {
    const BANNED = "This person may not use Kumpa.";
    const SUSPENDED = "This account is suspended. You can sign in again from: 22.10.2026";
    const CONTEST =
      "If you think we got this wrong, write to hello@kumpa.fi. Someone other than the person who decided will look at it again.";
    const HARASSMENT = [
      "Why: Harassment.",
      "The terms of use, section 4: you must not threaten, harass or pressure anyone, or ask anyone for money.",
      "A moderator decided this.",
      CONTEST,
    ];
    const SCRAPING = [
      "Why: Copying or collecting other people's profiles.",
      "The terms of use, section 4: you must not use Kumpa by automated means, or copy, store or pass on another user's photos or profile.",
      "A moderator decided this.",
      CONTEST,
    ];
    const lines = (fact: string, statement: readonly string[] = []) => [
      ...IDENTIFY,
      REFUSED,
      fact,
      ...statement,
      "Sign in with your bank",
    ];

    it.each([
      ["auth_banned", undefined, BANNED],
      ["auth_suspended", "2026-10-21T21:00:00.000Z", SUSPENDED],
    ])(
      "says why under %s, the terms' rule, that a moderator decided, and how to contest it",
      async (error, until, fact) => {
        await renderWithTheme(<SignInScreen error={error} until={until} reason="harassment" />);
        expect(await screen.findByText("Why: Harassment.")).toBeTruthy();
        expect(drawn()).toEqual(lines(fact, HARASSMENT));
        const found = pressables(screen.toJSON() as HostNode);
        expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
      },
    );

    it.each([
      [
        "fi-FI",
        [
          ...IDENTIFY_FI,
          "Kirjautuminen ei onnistunut",
          "Tämä tili on jäädytetty. Voit kirjautua taas sisään alkaen: 22.10.2026",
          "Syy: Muiden profiilien kopiointi tai kerääminen.",
          "Käyttöehdot, kohta 4: et saa käyttää Kumpa-sovellusta automaattisin keinoin etkä kopioida, tallentaa tai välittää toisen käyttäjän kuvia tai profiilia.",
          "Tämän päätti moderaattori.",
          "Jos olemme mielestäsi erehtyneet, kirjoita osoitteeseen hello@kumpa.fi. Asian katsoo uudelleen joku muu kuin päätöksen tehnyt.",
        ],
      ],
      [
        "sv-FI",
        [
          ...IDENTIFY_SV,
          "Inloggningen slutfördes inte",
          "Det här kontot är avstängt. Du kan logga in igen från och med: 22.10.2026",
          "Skäl: Kopiering eller insamling av andras profiler.",
          "Användarvillkoren, punkt 4: du får inte använda Kumpa automatiserat eller kopiera, spara eller sprida en annan användares bilder eller profil.",
          "Det här beslutade en moderator.",
          "Om du tycker att vi har gjort fel, skriv till hello@kumpa.fi. Någon annan än den som beslutade går igenom det på nytt.",
        ],
      ],
    ])("says a suspension's reason on a %s phone in its language", async (languageTag, words) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
      try {
        await renderWithTheme(
          <SignInScreen
            error="auth_suspended"
            until="2026-10-21T21:00:00.000Z"
            reason="scraping"
          />,
        );
        expect(await screen.findByText(words.at(-4) as string)).toBeTruthy();
        // The screen's own button follows, in the phone's language.
        expect(drawn().slice(0, words.length)).toEqual(words);
        expect(drawn()).toHaveLength(words.length + 1);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it.each([
      // A crafted link: only a reason of the closed list says anything.
      ["a word of none", "nope"],
      ["a reason's words, not its key", "Harassment"],
      ["an empty one", ""],
      ["a prototype member", "toString"],
      ["the prototype", "__proto__"],
      ["a reason with more after it", `harassment${"x".repeat(500)}`],
    ])("says nothing more than the ban for a reason off the list: %s", async (_, reason) => {
      await renderWithTheme(<SignInScreen error="auth_banned" reason={reason} />);
      expect(await screen.findByText(BANNED)).toBeTruthy();
      expect(drawn()).toEqual(lines(BANNED));
    });

    it.each([
      ["auth_under_18", UNDER_18, "Sign in with your bank"],
      ["auth_code_used", null, "Try again"],
    ])("says no reason under %s, which no sanction explains", async (error, fact, button) => {
      await renderWithTheme(<SignInScreen error={error} reason="harassment" />);
      expect(await screen.findByRole("button", { name: button })).toBeTruthy();
      expect(drawn()).toEqual([...IDENTIFY, REFUSED, ...(fact ? [fact] : []), button]);
    });

    it("says no reason under a cooldown, which no sanction explains", async () => {
      await renderWithTheme(
        <SignInScreen error="auth_cooldown" until="2026-10-22T10:00:00.000Z" reason="harassment" />,
      );
      expect(await screen.findByText(/The earliest day for a new one/)).toBeTruthy();
      expect(screen.queryByText(/Harassment|hello@kumpa\.fi/)).toBeNull();
    });

    it("follows a new link's reason, and the plain ban once a link carries none", async () => {
      const view = await renderWithTheme(<SignInScreen error="auth_banned" reason="harassment" />);
      expect(await screen.findByText("Why: Harassment.")).toBeTruthy();
      await view.rerender(underProviders(<SignInScreen error="auth_banned" reason="scraping" />));
      await waitFor(() => expect(drawn()).toEqual(lines(BANNED, SCRAPING)));
      await view.rerender(underProviders(<SignInScreen error="auth_banned" />));
      await waitFor(() => expect(drawn()).toEqual(lines(BANNED)));
    });
  });

  it("on the web, says there is no bank sign-in instead of offering a button", async () => {
    // Without ThemeProvider: its web path sets the colour scheme on a DOM
    // that jest-expo's iOS preset does not have.
    const os = jest.replaceProperty(Platform, "OS", "web");
    try {
      await render(
        <LocaleProvider>
          <SessionProvider>
            <SignInScreen error="auth_cancelled" />
          </SessionProvider>
        </LocaleProvider>,
      );
      expect(await screen.findByText(/There is no bank sign-in in the web version/)).toBeTruthy();
      // The way back alone: the screens before the bank are walked on the web
      // target as on a phone (#681), and only the bank is out of its reach.
      expect(screen.getAllByRole("button").map((node) => node.props.accessibilityLabel)).toEqual([
        "Back",
      ]);
      expect(screen.queryByText("Sign in with your bank")).toBeNull();
      expect(screen.queryByText("Try again")).toBeNull();
    } finally {
      os.restore();
    }
  });

  it("marks the login as started, with its verifier, when the button is pressed", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await atTheBank(<SignInScreen />);
    await fireEvent.press(await screen.findByRole("button", { name: "Sign in with your bank" }));
    // The mark is written before the browser opens.
    await waitFor(() => expect(openURL).toHaveBeenCalled());
    const { takeLoginStarted } = jest.requireActual(
      "@/lib/session",
    ) as typeof import("@/lib/session");
    const verifier = await takeLoginStarted();
    expect(verifier).toMatch(HEX_64);
    expect(sha256(String(verifier))).toBe(lastStart(openURL).challenge);
    expect(await takeLoginStarted()).toBeNull(); // once
  });

  it("says the sign-in did not complete when the exchange fails without a word from the API", async () => {
    await markLoginStarted(VERIFIER);
    fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
    await renderWithTheme(<SignInScreen code={CODE} />);
    expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(drawn()).toEqual(BARE_REFUSAL);
    expect(currentSession()).toBeNull();
  });

  it("asks for the bank's chooser in the app's language", async () => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag: "sv-FI" }]);
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    try {
      await atTheBank(<SignInScreen />, "Jag har redan ett konto");
      await fireEvent.press(await screen.findByRole("button", { name: "Logga in med din bank" }));
      expect(lastStart(openURL)).toEqual({
        url: `${apiBaseUrl()}/auth/start?platform=ios&locale=sv`,
        challenge: expect.stringMatching(HEX_64),
      });
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      openURL.mockRestore();
    }
  });

  it("asks for the bank's chooser in Finnish in Stadi, which no bank speaks (#521)", async () => {
    store.set("kuutti.preference.locale", "fi-x-stadi");
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    try {
      await atTheBank(<SignInScreen />, "Minulla on jo tili");
      await fireEvent.press(
        await screen.findByRole("button", { name: "Kirjaudu pankkitunnuksilla" }),
      );
      expect(lastStart(openURL).url).toBe(`${apiBaseUrl()}/auth/start?platform=ios&locale=fi`);
    } finally {
      store.delete("kuutti.preference.locale");
      openURL.mockRestore();
    }
  });

  it("says the sign-in did not complete when the browser cannot be opened, and offers to try again", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no browser"));
    try {
      await atTheBank(<SignInScreen />);
      await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
      expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
      expect(drawn()).toEqual(BARE_REFUSAL);
    } finally {
      openURL.mockRestore();
    }
  });

  it("names no day for a cooldown whose link carries none, or one that is not a date", async () => {
    const view = await renderWithTheme(<SignInScreen error="auth_cooldown" />);
    expect(
      await screen.findByText(
        "You deleted your account recently. The earliest day for a new one: ",
      ),
    ).toBeTruthy();
    await view.rerender(underProviders(<SignInScreen error="auth_cooldown" until="not a date" />));
    expect(
      await screen.findByText(
        "You deleted your account recently. The earliest day for a new one: ",
      ),
    ).toBeTruthy();
  });
});

describe("SignInScreen: the terms before the bank (#418, #681, ADR-010 §15)", () => {
  const consentsAnswer = () =>
    json({
      consents: [],
      currentVersions: {
        terms: TERMS,
        privacy: PRIVACY,
        special_category: String(CONSENT_VERSIONS.special_category),
      },
    });
  type Call = { path: string; kind?: string; version?: string; locale?: string; auth?: string };
  /**
   * The API of a whole sign-in: the exchange as `exchange` answers, every
   * consent as `consent` answers its kind. Each call is kept in order, beside
   * the moment the screen goes home, with what it carried.
   */
  function serve(
    options: { exchange?: () => Response; consent?: (kind: string) => Response } = {},
  ) {
    const calls: Call[] = [];
    const order: string[] = [];
    fetchMock.mockImplementation(async (input) => {
      const request = input as Request;
      const path = new URL(request.url).pathname;
      if (path === "/auth/exchange") {
        calls.push({ path });
        order.push("exchange");
        return (options.exchange ?? (() => json(tokens)))();
      }
      const body = JSON.parse(await request.text()) as Call;
      calls.push({ ...body, path, auth: request.headers.get("authorization") ?? undefined });
      order.push(`consent ${body.kind}`);
      return (options.consent ?? consentsAnswer)(String(body.kind));
    });
    router.replace.mockImplementation((to: string) => order.push(`replace ${to}`));
    return { calls, order };
  }
  const posted = (calls: Call[]) => calls.filter((call) => call.path === "/consents");

  /** Through the terms' screen, to the bank's (#681). */
  async function agree(button = AGREE) {
    await fireEvent.press(await screen.findByRole("button", { name: button }));
    return screen.findByRole("button", { name: "Sign in with your bank" });
  }

  /** From the bank button to the deep link's code: the attempt this phone started. */
  async function throughTheBank(view: Awaited<ReturnType<typeof renderWithTheme>>, code = CODE) {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await pressStart(openURL);
    await view.rerender(underProviders(<SignInScreen code={code} />));
  }

  /** The phone's answer to whether it agreed before, held until `answer` gives it. */
  function holdTheRead() {
    const getItem = SecureStore.getItemAsync as jest.Mock;
    const original = getItem.getMockImplementation() as (key: string) => Promise<string | null>;
    let answer: (stored: string | null) => void = () => undefined;
    getItem.mockImplementation((key: string) =>
      key === AGREED
        ? new Promise<string | null>((resolve) => {
            answer = resolve;
          })
        : original(key),
    );
    return {
      answer: (stored: string | null) => act(async () => answer(stored)),
      restore: () => getItem.mockImplementation(original),
    };
  }

  it("The bank button is reached only after the terms and the privacy summary are accepted", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await renderWithTheme(<SignInScreen />);
    // The first screen says what Kumpa is, with nothing to accept (#681).
    expect(screen.queryByRole("link")).toBeNull();
    await toTheBank();
    expect(await screen.findByRole("heading", { name: TERMS_TITLE })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Identification" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign in with your bank" })).toBeNull();
    // The rules in three lines, and the two texts as links, each by its own name.
    expect(drawn()).toEqual([
      TERMS_TITLE,
      "Be respectful. Use photos of yourself. Don't copy or collect other members' photos or profiles.",
      "We may remove accounts that break these rules.",
      "By tapping Agree and continue, you accept our Terms of Use and our Privacy Notice.",
      "Read the Terms of Use",
      "Read the Privacy Notice",
      AGREE,
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(pressables(screen.toJSON() as HostNode).flatMap((node) => a11yProblems(node))).toEqual(
      [],
    );

    await fireEvent.press(screen.getByRole("button", { name: AGREE }));
    expect(await screen.findByRole("heading", { name: "Identification" })).toBeTruthy();
    expect(heldAgreements()).toEqual({ terms: TERMS, privacy: PRIVACY, locale: "en" });
    const found = pressables(screen.toJSON() as HostNode);
    expect(found).toHaveLength(2);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
    await pressStart(openURL);
    expect(lastStart(openURL).url).toBe(`${apiBaseUrl()}/auth/start?platform=ios&locale=en`);
    // Nothing is sent before there is an account to bind it to.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stays on the first screen while the phone is asked whether it agreed before, then shows the terms", async () => {
    const read = holdTheRead();
    try {
      await renderWithTheme(<SignInScreen />);
      await fireEvent.press(await screen.findByRole("button", { name: HAVE_ACCOUNT }));
      expect(
        screen.getByRole("heading", { name: "A more confident start to dating" }),
      ).toBeTruthy();
      expect(screen.queryByRole("heading", { name: TERMS_TITLE })).toBeNull();
      await read.answer(null);
      expect(await screen.findByRole("heading", { name: TERMS_TITLE })).toBeTruthy();
    } finally {
      read.restore();
    }
  });

  it("shows the bank button once the phone answers that it agreed to the current wordings", async () => {
    const read = holdTheRead();
    try {
      await renderWithTheme(<SignInScreen />);
      await fireEvent.press(await screen.findByRole("button", { name: HAVE_ACCOUNT }));
      expect(screen.queryByRole("button", { name: "Sign in with your bank" })).toBeNull();
      await read.answer(JSON.stringify({ terms: TERMS, privacy: PRIVACY }));
      expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
      expect(screen.queryByText(TERMS_TITLE)).toBeNull();
    } finally {
      read.restore();
    }
  });

  it("drops the phone's answer that arrives after the screen has gone", async () => {
    const read = holdTheRead();
    const error = jest.spyOn(console, "error");
    try {
      const view = await renderWithTheme(<SignInScreen />);
      await fireEvent.press(await screen.findByRole("button", { name: HAVE_ACCOUNT }));
      await view.unmount();
      await read.answer(null);
      expect(error).not.toHaveBeenCalled();
    } finally {
      read.restore();
    }
  });

  it("A phone that recorded the current wordings goes straight to the bank", async () => {
    remember();
    const { calls, order } = serve();
    await markLoginStarted(VERIFIER);
    const view = await atTheBank(<SignInScreen />);
    expect(await screen.findByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(screen.queryByText(TERMS_TITLE)).toBeNull();
    await throughTheBank(view);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    // The held answers are what becomes rows, not the phone's memory: none were given here.
    expect(order).toEqual(["exchange", "replace /"]);
    expect(posted(calls)).toEqual([]);
  });

  it("sees the screens before the bank again on a phone that recorded an older wording", async () => {
    store.set(AGREED, JSON.stringify({ terms: "2025-01-draft-1", privacy: PRIVACY }));
    await atTheBank(<SignInScreen />);
    expect(await screen.findByRole("heading", { name: TERMS_TITLE })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in with your bank" })).toBeNull();
  });

  it("goes straight to the bank with the answers held from this run, without asking the phone", async () => {
    holdAgreements({ terms: TERMS, privacy: PRIVACY, locale: "en" });
    await atTheBank(<SignInScreen />);
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    expect(
      (SecureStore.getItemAsync as jest.Mock).mock.calls.filter(([key]) => key === AGREED),
    ).toEqual([]);
  });

  it("The answers given before the bank become consent rows right after the exchange", async () => {
    const { calls, order } = serve();
    const view = await atTheBank(<SignInScreen />);
    await agree();
    await throughTheBank(view);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    // In order, all before the screen goes home: onboarding then finds them given.
    expect(order).toEqual(["exchange", "consent terms", "consent privacy", "replace /"]);
    // Bound to the account the exchange made, in the language the texts were shown in.
    expect(posted(calls)).toEqual(
      [
        ["terms", TERMS],
        ["privacy", PRIVACY],
      ].map(([kind, version]) => ({
        path: "/consents",
        kind,
        version,
        locale: "en",
        auth: `Bearer ${tokens.accessToken}`,
      })),
    );
    expect(currentSession()?.sessionId).toBe(tokens.sessionId);
    // This phone has them now, and the answers are spent.
    expect(JSON.parse(String(store.get(AGREED)))).toEqual({ terms: TERMS, privacy: PRIVACY });
    expect(heldAgreements()).toBeNull();
  });

  it("names the language the texts were shown in on a Finnish phone", async () => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag: "fi-FI" }]);
    try {
      const { calls } = serve();
      const view = await atTheBank(<SignInScreen />, "Minulla on jo tili");
      await fireEvent.press(await screen.findByRole("button", { name: "Hyväksy ja jatka" }));
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
      await fireEvent.press(
        await screen.findByRole("button", { name: "Kirjaudu pankkitunnuksilla" }),
      );
      await waitFor(() => expect(openURL).toHaveBeenCalledTimes(1));
      expect(lastStart(openURL).url).toBe(`${apiBaseUrl()}/auth/start?platform=ios&locale=fi`);
      await view.rerender(underProviders(<SignInScreen code={CODE} />));
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(posted(calls).map((call) => [call.kind, call.locale])).toEqual([
        ["terms", "fi"],
        ["privacy", "fi"],
      ]);
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it.each([
    [
      "refused",
      () => json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500),
    ],
    [
      "unreachable",
      () => {
        throw new TypeError("Network request failed");
      },
    ],
  ])(
    "signs in and goes home when the consents are %s, leaving them to the welcome step",
    async (_how, failing) => {
      const { calls, order } = serve({ consent: failing });
      const view = await atTheBank(<SignInScreen />);
      await agree();
      await throughTheBank(view);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      // The terms did not land, so the privacy summary waits.
      expect(order).toEqual(["exchange", "consent terms", "replace /"]);
      expect(posted(calls)).toHaveLength(1);
      expect(currentSession()?.sessionId).toBe(tokens.sessionId);
      expect(screen.queryByText(REFUSED)).toBeNull();
      // Not remembered: the next sign-in on this phone asks again, as the welcome step does now.
      expect(store.has(AGREED)).toBe(false);
      expect(heldAgreements()).toBeNull();
    },
  );

  it("remembers the phone only when both the terms and the privacy summary landed", async () => {
    const { order } = serve({
      consent: (kind) =>
        kind === "privacy"
          ? json({ error: { code: "rate_limited", message: "x", requestId: "r" } }, 429)
          : consentsAnswer(),
    });
    const view = await atTheBank(<SignInScreen />);
    await agree();
    await throughTheBank(view);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual(["exchange", "consent terms", "consent privacy", "replace /"]);
    expect(store.has(AGREED)).toBe(false);
  });

  it("drops the answers at a refused exchange: Try again asks them again, and posts only the new ones", async () => {
    let exchanges = 0;
    const { calls, order } = serve({
      exchange: () => {
        exchanges += 1;
        return exchanges === 1
          ? json({ error: { code: "auth_code_used", message: "x", requestId: "r" } }, 401)
          : json(tokens);
      },
    });
    const view = await atTheBank(<SignInScreen />);
    await agree();
    await throughTheBank(view);
    expect(await screen.findByText(REFUSED)).toBeTruthy();
    expect(posted(calls)).toEqual([]);
    // Whoever tries again answers again: nobody inherits a refused attempt's answers.
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText(TERMS_TITLE)).toBeTruthy();
    await agree();
    await throughTheBank(view, "d".repeat(43));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual([
      "exchange",
      "exchange",
      "consent terms",
      "consent privacy",
      "replace /",
    ]);
  });

  it("asks again when a second bank attempt starts on answers carried into the first", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await atTheBank(<SignInScreen />);
    await agree();
    await pressStart(openURL);
    // Back from a browser left without an answer; whoever taps now may be somebody else.
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    expect(await screen.findByText(TERMS_TITLE)).toBeTruthy();
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(heldAgreements()).toBeNull();
  });

  it("drops answers not yet carried to the bank when the app leaves the screen", async () => {
    const listeners: Array<(state: string) => void> = [];
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener) => {
      if (event === "change") listeners.push(listener as (state: string) => void);
      return { remove: jest.fn() } as never;
    });
    await atTheBank(<SignInScreen />);
    await agree();
    await act(async () => {
      for (const listener of listeners) listener("inactive");
    });
    expect(screen.getByRole("button", { name: "Sign in with your bank" })).toBeTruthy();
    await act(async () => {
      for (const listener of listeners) listener("background");
    });
    expect(heldAgreements()).toBeNull();
    // Back in the app, the bank's button leads to the terms again, and opens no bank.
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    expect(await screen.findByText(TERMS_TITLE)).toBeTruthy();
    expect(openURL).not.toHaveBeenCalled();
  });

  it("goes back to the screens before the bank when the answers grew stale before the bank was opened", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await atTheBank(<SignInScreen />);
    const now = Date.now();
    await agree();
    jest.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
    await fireEvent.press(screen.getByRole("button", { name: "Sign in with your bank" }));
    expect(await screen.findByText(TERMS_TITLE)).toBeTruthy();
    expect(openURL).not.toHaveBeenCalled();
  });

  it("posts nothing for an exchange of another attempt than the one the answers went with", async () => {
    const { calls } = serve();
    const view = await atTheBank(<SignInScreen />);
    await agree();
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
    await pressStart(openURL);
    // Another attempt's mark, as if started elsewhere since: its code is exchanged, the answers are not its.
    await markLoginStarted("e".repeat(64));
    await view.rerender(underProviders(<SignInScreen code={CODE} />));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(posted(calls)).toEqual([]);
  });

  it("drops the answers when a refusal comes back through the link", async () => {
    const view = await atTheBank(<SignInScreen />);
    await agree();
    await view.rerender(underProviders(<SignInScreen error="auth_cancelled" />));
    expect(await screen.findByText("Sign-in did not complete")).toBeTruthy();
    await fireEvent.press(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findByText(TERMS_TITLE)).toBeTruthy();
  });

  it.each([
    ["Try again", "auth_cancelled"],
    ["Sign in with your bank", "auth_cooldown"],
  ])(
    "leads a refusal's %s back to the screens before the bank on a phone that never answered them",
    async (name, error) => {
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
      await renderWithTheme(<SignInScreen error={error} />);
      expect(await screen.findByText("Sign-in did not complete")).toBeTruthy();
      const button = await screen.findByRole("button", { name });
      // The way back and the button.
      expect(pressables(screen.toJSON() as HostNode)).toHaveLength(2);
      await fireEvent.press(button);
      expect(await screen.findByRole("heading", { name: TERMS_TITLE })).toBeTruthy();
      expect(openURL).not.toHaveBeenCalled();
      // Answered, the bank is one press away, with the refusal put behind.
      await agree();
      expect(screen.queryByText("Sign-in did not complete")).toBeNull();
      await pressStart(openURL);
    },
  );

  it("signs in a code that returns to a process which lost its answers, posting nothing", async () => {
    // Android may end the app while the browser is open: the answers went with it,
    // and onboarding's welcome step asks for the terms and the privacy summary instead.
    const { calls, order } = serve();
    await markLoginStarted(VERIFIER);
    await renderWithTheme(<SignInScreen code={CODE} />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(order).toEqual(["exchange", "replace /"]);
    expect(posted(calls)).toEqual([]);
    expect(screen.queryByText(TERMS_TITLE)).toBeNull();
    expect(store.has(AGREED)).toBe(false);
  });
});
