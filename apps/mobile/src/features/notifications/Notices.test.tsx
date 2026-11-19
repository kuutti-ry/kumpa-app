import { act, fireEvent, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { AccessibilityInfo, Platform } from "react-native";
import { clearSession, saveSession } from "@/lib/session";
import { noProblems } from "@/test/a11y";
import { textsInOrder as said } from "@/test/layout";
import { renderWithTheme } from "@/test/render";
import { Notices } from "./Notices";

// The home screen's notices (#176, ADR-032): the unread ones under a heading,
// a warning and a moderator's shadow ban with their statements (#715, ADR-073
// §1), the reason, the terms' rule, who decided and how to contest it, an
// invitation that counted with what it
// earned and never who, the inviter's (#107) and the friend's who used it
// (#503), Got it marking it read and taking it off, a failure said and the
// notice kept, nothing at all without one.

const { __focus: focus } = jest.requireMock("expo-router") as { __focus: () => void };
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));
const notice = (n: number, readAt: string | null = null) => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  kind: "warning",
  at: "2026-10-18T09:00:00.000Z",
  readAt,
  reason: "harassment",
});
const BODY = "A warning by itself changes nothing in how you use the app.";
/** How to contest what staff decided (ADR-073 §3). */
const CONTEST =
  "If you think we got this wrong, write to hello@kuutti.app. Someone other than the person who decided will look at it again.";
/** A moderator's sanction for harassment, in its statement's words. */
const HARASSMENT = [
  "Why: Harassment.",
  "The terms of use, section 4: you must not threaten, harass or pressure anyone, or ask anyone for money.",
  "A moderator decided this.",
  CONTEST,
];
/** A moderator's shadow ban (#715); a rule's is never told. */
const shadowBanned = (n: number, reason = "harassment") => ({
  id: `00000000-0000-4000-8000-00000000004${n}`,
  kind: "shadow_ban",
  at: "2026-11-17T09:00:00.000Z",
  readAt: null,
  reason,
});
const HIDDEN = "Others don't see your profile for now";
const HIDDEN_BODY =
  "For now your profile is not shown to other people, and your likes and messages do not reach them.";
const counted = (n: number, reward: { fish: number }) => ({
  id: `00000000-0000-4000-8000-00000000001${n}`,
  kind: "invitation_counted",
  at: "2026-10-22T03:00:00.000Z",
  readAt: null,
  reward,
});
const used = (n: number, reward: { fish: number }) => ({
  id: `00000000-0000-4000-8000-00000000002${n}`,
  kind: "invitation_friend",
  at: "2026-10-22T03:00:00.000Z",
  readAt: null,
  reward,
});
/** An announcement to everybody (#573), in the words the API gave it for the reader. */
const announced = (n: number) => ({
  id: `00000000-0000-4000-8000-00000000003${n}`,
  kind: "announcement",
  at: "2026-11-07T10:00:00.000Z",
  readAt: null,
  title: "A short break on Sunday",
  body: "Kuutti is closed from 10 to 12 for maintenance.",
});
/** The screen's own words around a notice, by language. */
const AROUND = {
  en: ["Notices", "Got it"],
  fi: ["Tiedotteet", "Selvä"],
  sv: ["Notiser", "Uppfattat"],
} as const;

function api(notices: unknown[], read: () => Response = () => new Response(null, { status: 204 })) {
  const seen: string[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    seen.push(`${request.method} ${path}`);
    return request.method === "POST" ? read() : json({ notices });
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(async () => {
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
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

describe("Notices", () => {
  it("shows an unread warning with its reason, and Got it marks it read and takes it off", async () => {
    const seen = api([notice(1), notice(2, "2026-10-18T10:00:00.000Z")]);
    await renderWithTheme(<Notices />);
    expect(await screen.findByRole("heading", { name: "Notices" })).toBeTruthy();
    expect(screen.getAllByText("A warning from a moderator")).toHaveLength(1);
    expect(said()).toEqual([
      "Notices",
      "A warning from a moderator",
      BODY,
      ...HARASSMENT,
      "Got it",
    ]);
    noProblems();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Got it" })));
    await settle();
    expect(seen).toContain(`POST /notices/${notice(1).id}/read`);
    expect(screen.queryByText("A warning from a moderator")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Notices" })).toBeNull();
  });

  it("shows an invitation that counted with what it earned, never who, beside a warning", async () => {
    const seen = api([counted(1, { fish: 1 }), notice(1)]);
    await renderWithTheme(<Notices />);
    expect(await screen.findByText("An invitation of yours counted")).toBeTruthy();
    expect(
      screen.getByText("Somebody you invited has finished their profile. You earned a flower."),
    ).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    // The invitation's notice first, as the API ordered them.
    const flat = JSON.stringify(screen.toJSON());
    expect(flat.indexOf("An invitation of yours counted")).toBeLessThan(
      flat.indexOf("A warning from a moderator"),
    );
    noProblems();
    const first = screen.getAllByRole("button", { name: "Got it" })[0];
    await act(async () => fireEvent.press(first as ReturnType<typeof screen.getByRole>));
    await settle();
    expect(seen).toContain(`POST /notices/${counted(1, { fish: 1 }).id}/read`);
    expect(screen.queryByText("An invitation of yours counted")).toBeNull();
    expect(screen.getByText(BODY)).toBeTruthy();
  });

  it("shows the invitation the person used beside one of their own, and Got it takes off its own", async () => {
    const seen = api([used(1, { fish: 1 }), counted(1, { fish: 2 })]);
    await renderWithTheme(<Notices />);
    expect(await screen.findByText("The invitation you used counted")).toBeTruthy();
    expect(screen.getByText("An invitation of yours counted")).toBeTruthy();
    expect(
      screen.getByText("Somebody you invited has finished their profile. You earned 2 flowers."),
    ).toBeTruthy();
    noProblems();
    const first = screen.getAllByRole("button", { name: "Got it" })[0];
    await act(async () => fireEvent.press(first as ReturnType<typeof screen.getByRole>));
    await settle();
    expect(seen).toContain(`POST /notices/${used(1, { fish: 1 }).id}/read`);
    expect(screen.queryByText("The invitation you used counted")).toBeNull();
    expect(screen.getByText("An invitation of yours counted")).toBeTruthy();
  });

  it.each([
    [
      "en",
      0,
      "An invitation of yours counted",
      "Somebody you invited has finished their profile. Thank you for inviting them.",
    ],
    [
      "en",
      1,
      "An invitation of yours counted",
      "Somebody you invited has finished their profile. You earned a flower.",
    ],
    [
      "en",
      2,
      "An invitation of yours counted",
      "Somebody you invited has finished their profile. You earned 2 flowers.",
    ],
    [
      "fi",
      0,
      "Yksi kutsuistasi laskettiin",
      "Joku kutsumasi on saanut profiilinsa valmiiksi. Kiitos, että kutsuit hänet.",
    ],
    [
      "fi",
      1,
      "Yksi kutsuistasi laskettiin",
      "Joku kutsumasi on saanut profiilinsa valmiiksi. Ansaitsit kukan.",
    ],
    [
      "fi",
      2,
      "Yksi kutsuistasi laskettiin",
      "Joku kutsumasi on saanut profiilinsa valmiiksi. Ansaitsit 2 kukkaa.",
    ],
    [
      "sv",
      0,
      "En av dina inbjudningar räknades",
      "Någon du bjöd in har gjort klart sin profil. Tack för att du bjöd in.",
    ],
    [
      "sv",
      1,
      "En av dina inbjudningar räknades",
      "Någon du bjöd in har gjort klart sin profil. Du fick en blomma.",
    ],
    [
      "sv",
      2,
      "En av dina inbjudningar räknades",
      "Någon du bjöd in har gjort klart sin profil. Du fick 2 blommor.",
    ],
  ] as const)(
    "says in %s what a counted invitation earned its inviter, %i fish, and nothing of who",
    async (locale, fish, title, body) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: locale }]);
      api([counted(2, { fish })]);
      await renderWithTheme(<Notices />);
      expect(await screen.findByText(body)).toBeTruthy();
      const [heading, gotIt] = AROUND[locale];
      expect(said()).toEqual([heading, title, body, gotIt]);
      noProblems();
    },
  );

  it.each([
    ["en", 1, "The invitation you used counted", "The invitation earned you a flower."],
    ["en", 2, "The invitation you used counted", "The invitation earned you 2 flowers."],
    ["fi", 1, "Käyttämäsi kutsu laskettiin", "Kutsu toi sinulle kukan."],
    ["fi", 2, "Käyttämäsi kutsu laskettiin", "Kutsu toi sinulle 2 kukkaa."],
    ["sv", 1, "Inbjudan du använde räknades", "Inbjudan gav dig en blomma."],
    ["sv", 2, "Inbjudan du använde räknades", "Inbjudan gav dig 2 blommor."],
  ] as const)(
    "says in %s what the invitation earned the friend who used it, %i fish, and nothing of who or of how a fish is spent",
    async (locale, fish, title, body) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: locale }]);
      api([used(2, { fish })]);
      await renderWithTheme(<Notices />);
      expect(await screen.findByText(body)).toBeTruthy();
      const [heading, gotIt] = AROUND[locale];
      expect(said()).toEqual([heading, title, body, gotIt]);
      noProblems();
    },
  );

  it("shows a moderator's shadow ban with its statement, and Got it marks it read (#715)", async () => {
    const seen = api([shadowBanned(1)]);
    await renderWithTheme(<Notices />);
    expect(await screen.findByText(HIDDEN)).toBeTruthy();
    expect(said()).toEqual(["Notices", HIDDEN, HIDDEN_BODY, ...HARASSMENT, "Got it"]);
    noProblems();
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Got it" })));
    await settle();
    expect(seen).toContain(`POST /notices/${shadowBanned(1).id}/read`);
    expect(screen.queryByText(HIDDEN)).toBeNull();
  });

  it.each([
    [
      "fi",
      [
        "Muut eivät toistaiseksi näe profiiliasi",
        "Profiiliasi ei toistaiseksi näytetä muille, eivätkä tykkäyksesi ja viestisi tavoita heitä.",
        "Syy: Muu syy.",
        "Käyttöehdot, kohta 6: jos ehtoja rikotaan, Kuutti ry voi rajoittaa tiliä.",
        "Tämän päätti moderaattori.",
        "Jos olemme mielestäsi erehtyneet, kirjoita osoitteeseen hello@kuutti.app. Asian katsoo uudelleen joku muu kuin päätöksen tehnyt.",
      ],
    ],
    [
      "sv",
      [
        "Andra ser inte din profil för tillfället",
        "Din profil visas för tillfället inte för andra, och dina gillanden och meddelanden når dem inte.",
        "Skäl: Annat skäl.",
        "Användarvillkoren, punkt 6: om villkoren bryts kan Kuutti ry begränsa ett konto.",
        "Det här beslutade en moderator.",
        "Om du tycker att vi har gjort fel, skriv till hello@kuutti.app. Någon annan än den som beslutade går igenom det på nytt.",
      ],
    ],
  ] as const)(
    "says in %s why a moderator hid the person, the terms' section and how to contest it",
    async (locale, words) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: locale }]);
      api([shadowBanned(2, "other")]);
      await renderWithTheme(<Notices />);
      expect(await screen.findByText(words[0])).toBeTruthy();
      const [heading, gotIt] = AROUND[locale];
      expect(said()).toEqual([heading, ...words, gotIt]);
      noProblems();
    },
  );

  it("shows an announcement in its own words beside a warning, and Got it takes it off (#573)", async () => {
    const seen = api([announced(1), notice(1)]);
    await renderWithTheme(<Notices />);
    expect(await screen.findByText("A short break on Sunday")).toBeTruthy();
    // Its title and body are all it says: the screen adds nothing of its own to them.
    expect(said()).toEqual([
      "Notices",
      "A short break on Sunday",
      "Kuutti is closed from 10 to 12 for maintenance.",
      "Got it",
      "A warning from a moderator",
      BODY,
      ...HARASSMENT,
      "Got it",
    ]);
    noProblems();
    const first = screen.getAllByRole("button", { name: "Got it" })[0];
    await act(async () => fireEvent.press(first as ReturnType<typeof screen.getByRole>));
    await settle();
    expect(seen).toContain(`POST /notices/${announced(1).id}/read`);
    expect(screen.queryByText("A short break on Sunday")).toBeNull();
    expect(screen.getByText(BODY)).toBeTruthy();
  });

  it("keeps a notice whose mark failed, says so, and tells VoiceOver", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    api([notice(1)], () =>
      json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500),
    );
    await renderWithTheme(<Notices />);
    await screen.findByText(BODY);
    await act(async () => fireEvent.press(screen.getByRole("button", { name: "Got it" })));
    await settle();
    const words = "That did not go through. Try again.";
    expect(screen.getByText(words)).toBeTruthy();
    expect(screen.getByText(BODY)).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(words);
  });

  it("shows nothing when there is nothing unread, or the notices cannot be read, and reads again on focus", async () => {
    api([notice(1, "2026-10-18T10:00:00.000Z")]);
    await renderWithTheme(<Notices />);
    await settle();
    const nothing = () => {
      expect(screen.queryByRole("heading", { name: "Notices" })).toBeNull();
      expect(screen.queryByText("A warning from a moderator")).toBeNull();
    };
    nothing();
    globalThis.fetch = jest.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    await act(async () => focus());
    await settle();
    nothing();
    api([notice(3)]);
    await act(async () => focus());
    expect(await screen.findByText(BODY)).toBeTruthy();
  });
});
