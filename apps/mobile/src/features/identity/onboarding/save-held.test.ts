import { CONSENT_VERSIONS } from "@kuutti/i18n";
import { clearSession, saveSession } from "@/lib/session";
import type { HeldAnswers } from "../held-answers";
import { saveHeldAnswers, takeSavedHome } from "./save-held";

const TERMS = String(CONSENT_VERSIONS.terms);
const PRIVACY = String(CONSENT_VERSIONS.privacy);
const SPECIAL = String(CONSENT_VERSIONS.special_category);
const KALLIO = {
  town: { fi: "Helsinki", sv: "Helsingfors" },
  area: { fi: "Kallio", sv: "Berghäll" },
  showArea: false,
};
const NOW = Date.parse("2026-11-19T10:00:00.000Z");
const ALL: HeldAnswers = {
  name: "Aino",
  gender: "woman",
  seeks: ["man"],
  specialCategory: { version: SPECIAL, locale: "fi" },
  postalCode: "00530",
  at: NOW,
};
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refused = () =>
  json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500);

type Account = {
  name: string | null;
  gender: string | null;
  seeks: string[] | null;
  specialCategory: boolean;
  home: typeof KALLIO | null;
  /** The versions of the terms and the privacy notice the account has accepted. */
  terms: string | null;
  privacy: string | null;
};

/**
 * The API as the account stands just after the exchange, `account`'s way,
 * each route answering as `refuse` says. Every call is kept in order with what
 * it carried.
 */
function serve(account: Partial<Account> = {}, refuse: (line: string) => boolean = () => false) {
  const state: Account = {
    name: null,
    gender: null,
    seeks: null,
    specialCategory: false,
    home: null,
    terms: TERMS,
    privacy: PRIVACY,
    ...account,
  };
  const calls: { line: string; body?: Record<string, unknown> }[] = [];
  globalThis.fetch = jest.fn(async (input: Request) => {
    const path = new URL(input.url).pathname;
    const text = input.method === "GET" ? "" : await input.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    const line = `${input.method} ${path}${path === "/consents" ? ` ${String(body?.kind)}` : ""}`;
    calls.push({ line, body });
    if (refuse(line)) return refused();
    if (path === "/onboarding") {
      return json({
        state: "registered",
        age: 30,
        gender: state.gender,
        home: state.home,
        preferences: { seeks: state.seeks, ageWindow: null },
        consents: {
          terms: state.terms,
          privacy: state.privacy,
          specialCategory: state.specialCategory ? SPECIAL : null,
        },
        currentVersions: { terms: TERMS, privacy: PRIVACY, special_category: SPECIAL },
        nextChange: { gender: null },
        missing: [
          ...(state.name ? [] : ["name"]),
          ...(state.gender ? [] : ["gender"]),
          ...(state.seeks ? [] : ["seeks"]),
          ...(state.home ? [] : ["home"]),
          "age_window",
          "intent",
          "photos",
        ],
        complete: false,
      });
    }
    const document = (displayName: string, fields: unknown) => ({
      displayName,
      bio: null,
      bioPreset: null,
      fields,
      prompts: [],
      specialCategoryConsent: null,
      updatedAt: "2026-11-19T10:00:00.000Z",
    });
    if (line === "GET /profile") {
      return json({
        profile: state.name ? document(state.name, {}) : null,
        completeness: { complete: false, missing: [] },
        home: state.home,
      });
    }
    if (line === "PUT /profile") {
      state.name = String(body?.displayName);
      return json({
        profile: document(state.name, body?.fields),
        completeness: { complete: false, missing: [] },
        home: state.home,
      });
    }
    if (line === "PUT /account/gender") return new Response(null, { status: 204 });
    if (line === "POST /consents special_category") {
      return json({
        consents: [],
        currentVersions: { terms: TERMS, privacy: PRIVACY, special_category: SPECIAL },
      });
    }
    if (line === "PUT /preferences") return json({ seeks: body?.seeks, ageWindow: null });
    if (line === "PUT /account/home") return json(KALLIO);
    return json({ error: { code: "not_found", message: "no", requestId: "r" } }, 404);
  }) as unknown as typeof fetch;
  return calls;
}
const lines = (calls: ReturnType<typeof serve>) => calls.map((call) => call.line);
const sent = (calls: ReturnType<typeof serve>, line: string) =>
  calls.find((call) => call.line === line)?.body;

beforeEach(async () => {
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
  takeSavedHome();
});
afterEach(async () => {
  await clearSession();
  jest.restoreAllMocks();
});

describe("saveHeldAnswers (#681, ADR-010 §22)", () => {
  it("saves each answer an account lacks through its own route, the consent before whom one seeks", async () => {
    const calls = serve();
    await saveHeldAnswers(ALL);
    expect(lines(calls)).toEqual([
      "GET /onboarding",
      "GET /profile",
      "PUT /profile",
      "PUT /account/gender",
      "POST /consents special_category",
      "PUT /preferences",
      "PUT /account/home",
    ]);
    expect(sent(calls, "PUT /profile")).toMatchObject({ displayName: "Aino", fields: {} });
    expect(sent(calls, "PUT /account/gender")).toEqual({ gender: "woman" });
    // The version read and the language it was read in, as the seeks screen held them.
    expect(sent(calls, "POST /consents special_category")).toEqual({
      kind: "special_category",
      version: SPECIAL,
      locale: "fi",
    });
    expect(sent(calls, "PUT /preferences")).toEqual({ seeks: ["man"] });
    // The digits go in the home's body alone.
    expect(sent(calls, "PUT /account/home")).toEqual({ postalCode: "00530" });
    // What the card shows of the home, for onboarding to show once.
    expect(takeSavedHome()).toEqual(KALLIO);
    expect(takeSavedHome()).toBeNull();
  });

  it("saves the word after a non-binary gender with the name", async () => {
    const calls = serve();
    await saveHeldAnswers({ ...ALL, gender: "non_binary", identityLabel: "two_spirit" });
    expect(sent(calls, "PUT /profile")).toMatchObject({
      displayName: "Aino",
      fields: { identityLabel: "two_spirit" },
    });
    expect(sent(calls, "PUT /account/gender")).toEqual({ gender: "non_binary" });
  });

  it("saves the word alone when the account has a name, with its gender", async () => {
    const calls = serve({ name: "Iida" });
    await saveHeldAnswers({ ...ALL, gender: "non_binary", identityLabel: "agender" });
    const profile = sent(calls, "PUT /profile");
    expect(profile).toMatchObject({ displayName: "Iida", fields: { identityLabel: "agender" } });
  });

  it("leaves what the account has: a name, a gender and its word, whom one seeks, a home", async () => {
    const calls = serve({
      name: "Iida",
      gender: "man",
      seeks: ["woman"],
      specialCategory: true,
      home: KALLIO,
    });
    // A gender changes once in 30 days (#147): the held one never overwrites it, nor its word.
    await saveHeldAnswers({ ...ALL, gender: "non_binary", identityLabel: "agender" });
    expect(lines(calls)).toEqual(["GET /onboarding"]);
    expect(takeSavedHome()).toBeNull();
  });

  it.each([
    ["a name of spaces", { name: "   " }],
    ["no name", { name: undefined }],
  ])("saves no name for %s", async (_, change) => {
    const calls = serve();
    await saveHeldAnswers({ ...ALL, ...change });
    expect(lines(calls)).not.toContain("PUT /profile");
    expect(lines(calls)).toContain("PUT /account/gender");
  });

  it("trims the name it saves", async () => {
    const calls = serve();
    await saveHeldAnswers({ ...ALL, name: "  Aino " });
    expect(sent(calls, "PUT /profile")).toMatchObject({ displayName: "Aino" });
  });

  it("offers no word with a gender that is not non-binary", async () => {
    const calls = serve({ name: "Iida" });
    await saveHeldAnswers({ ...ALL, gender: "woman", identityLabel: "agender" });
    expect(lines(calls)).not.toContain("PUT /profile");
  });

  it("asks no consent again when the current one is given, and saves whom one seeks", async () => {
    const calls = serve({ specialCategory: true });
    await saveHeldAnswers(ALL);
    expect(lines(calls)).not.toContain("POST /consents special_category");
    expect(sent(calls, "PUT /preferences")).toEqual({ seeks: ["man"] });
  });

  it("saves nobody sought without the consent held with it, nor when the consent is refused", async () => {
    let calls = serve();
    await saveHeldAnswers({ ...ALL, specialCategory: undefined });
    expect(lines(calls)).not.toContain("PUT /preferences");
    expect(lines(calls)).not.toContain("POST /consents special_category");

    // The API refuses whom one seeks without the consent (ADR-010 §16): it is not asked.
    calls = serve({}, (line) => line === "POST /consents special_category");
    await saveHeldAnswers(ALL);
    expect(lines(calls)).toContain("POST /consents special_category");
    expect(lines(calls)).not.toContain("PUT /preferences");
    expect(lines(calls)).toContain("PUT /account/home");
  });

  it("saves nobody sought and no home when none is held", async () => {
    const calls = serve();
    await saveHeldAnswers({ at: NOW, name: "Aino" });
    expect(lines(calls)).toEqual(["GET /onboarding", "GET /profile", "PUT /profile"]);
  });

  it("goes on past a save that fails, leaving it to onboarding", async () => {
    const calls = serve({}, (line) => line === "PUT /profile" || line === "PUT /account/gender");
    await saveHeldAnswers(ALL);
    expect(lines(calls)).toEqual([
      "GET /onboarding",
      "GET /profile",
      "PUT /profile",
      "PUT /account/gender",
      "POST /consents special_category",
      "PUT /preferences",
      "PUT /account/home",
    ]);
  });

  it("keeps no home to show when the home's save fails", async () => {
    serve({}, (line) => line === "PUT /account/home");
    await saveHeldAnswers(ALL);
    expect(takeSavedHome()).toBeNull();
  });

  it.each([
    ["the terms", { terms: null }],
    ["the terms in force", { terms: "2026-01-1" }],
    ["the privacy notice", { privacy: null }],
    ["the privacy notice in force", { privacy: "2026-01-1" }],
  ])("saves nothing before the account has accepted %s", async (_, account) => {
    // An acceptance that did not land: onboarding's welcome step asks it first, then the rest.
    const calls = serve(account);
    await saveHeldAnswers(ALL);
    expect(lines(calls)).toEqual(["GET /onboarding"]);
    expect(takeSavedHome()).toBeNull();
  });

  it("with nothing held saves nothing, and forgets the home saved for whoever signed in before", async () => {
    const calls = serve();
    await saveHeldAnswers(ALL);
    const before = calls.length;
    await saveHeldAnswers(null);
    expect(calls).toHaveLength(before);
    expect(takeSavedHome()).toBeNull();
  });

  it.each([
    ["refused", () => refused()],
    [
      "unreachable",
      () => {
        throw new TypeError("Network request failed");
      },
    ],
  ])("saves nothing and never throws when the account's status is %s", async (_, answer) => {
    const fetchMock = jest.fn(async () => answer());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(saveHeldAnswers(ALL)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(takeSavedHome()).toBeNull();
  });
});
