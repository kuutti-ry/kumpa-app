import { CONSENT_VERSIONS } from "@kuutti/i18n";
import { DISPLAY_NAME_MAX, type HomeSummary, PHOTOS_FOR_COMPLETENESS } from "@kuutti/schema";
import { act, fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as ImagePicker from "expo-image-picker";
import { useLocales } from "expo-localization";
import type * as React from "react";
import { AccessibilityInfo, PixelRatio, Platform, StyleSheet } from "react-native";
import { saveSession } from "@/lib/session";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { FAILED_TO_LOAD } from "@/test/failed";
import { hasCutText } from "@/test/layout";
import { renderWithTheme } from "@/test/render";
import { FakeXhr } from "@/test/xhr";
import { MAX_FONT_SCALE } from "@/theme/a11y";
import { defaultAgeWindow, OnboardingScreen } from "./OnboardingScreen";
import { saveHeldAnswers, takeSavedHome } from "./save-held";

/** The names of the radio groups on the screen, each a plain view that a role query would leave out. */
const radioGroups = () =>
  screen.container
    .queryAll(
      (node) => typeof node.type === "string" && node.props.accessibilityRole === "radiogroup",
    )
    .map((node) => String(node.props.accessibilityLabel));

const { __router: router, __focus: focus } = jest.requireMock("expo-router") as {
  __router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
  __focus: () => void;
};
// Long enough for a step's call and the status reads that follow it: an
// update that lands outside an act scope is never flushed in this runtime.
const settle = (ms = 40) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const flush = () => act(() => settle(120));
const show = (ui: React.ReactElement) =>
  act(async () => {
    renderWithTheme(ui);
    await settle();
  });
const press = (element: ReturnType<typeof screen.getByRole>) =>
  act(async () => {
    fireEvent.press(element);
    await settle();
  });
const type = (element: ReturnType<typeof screen.getByLabelText>, text: string) =>
  act(async () => {
    fireEvent.changeText(element, text);
    await settle();
  });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
// The versions this build carries, each kind its own since the privacy
// summary moved on alone (#102): what the welcome step shows and records.
const versionOf = (kind: string): string => {
  const version = CONSENT_VERSIONS[kind];
  if (!version) throw new Error(`this build carries no version of ${kind}`);
  return version;
};
const TERMS = versionOf("terms");
const PRIVACY = versionOf("privacy");
const SPECIAL = versionOf("special_category");
/** The answers of the fake home route, by code: an area kept, and one too small to keep. */
const HOMES: Readonly<Record<string, HomeSummary>> = {
  "00530": {
    town: { fi: "Helsinki", sv: "Helsingfors" },
    area: { fi: "Kallio", sv: "Berghäll" },
    showArea: false,
  },
  "83960": { town: { fi: "Joensuu", sv: "Joensuu" }, area: null, showArea: false },
};
const IN_KALLIO = HOMES["00530"] as HomeSummary;
const ACTIVATION = ["gender", "seeks", "age_window", "home", "terms", "privacy"];
/** A photo as the API lists it: in review, unless the check refused it. */
const aPhoto = (position: number, state: "pending" | "rejected") => ({
  id: `0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a${position.toString(16).padStart(2, "0")}`,
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  width: 1600,
  height: 1200,
  state,
  rejectionReason: state === "rejected" ? "other" : null,
  appealable: false,
  position,
  createdAt: "2026-09-25T12:00:00.000Z",
  caption: null,
});

type Profile = {
  displayName: string;
  bio: string | null;
  bioPreset: string | null;
  fields: Record<string, unknown>;
  prompts: { key: string; answer: string }[];
};

/**
 * A tiny server: the status is computed from what the steps wrote, as the API
 * does (#146). It answers the invitations (#107) only when a test says whether
 * a code may be typed; otherwise their read is a 404, which onboarding passes
 * over without a word.
 */
function fakeApi(
  options: {
    version?: string;
    age?: number;
    redeemable?: boolean;
    reward?: unknown;
    redeem?: () => Response;
  } = {},
) {
  // A version the API holds as current that this build does not carry, for every kind but the sensitive answers'.
  const current = (version: string) => options.version ?? version;
  const server: {
    gender: string | null;
    seeks: string[] | null;
    ageWindow: { min: number; max: number } | null;
    /** Every row given; a withdrawn one keeps its row with the time (ADR-010 §4). */
    consents: { kind: string; version: string; locale: string; withdrawnAt?: string }[];
    profile: Profile | null;
    /** The photos that count, as the API counts them: any but a refused one. */
    photos: number;
    /** The photos the check refused, after those on the list: they count for nothing. */
    refusedPhotos: number;
    /** From when a gender change is possible again; set, the API refuses one with 429 (#147). */
    genderFrom: string | null;
    /** The API refuses whom one seeks: the consent went while the step was open (ADR-010 §16). */
    seeksRefused: boolean;
    /** The home as the API reads it back. */
    home: HomeSummary | null;
  } = {
    gender: null,
    seeks: null,
    ageWindow: null,
    consents: [],
    profile: null,
    photos: 0,
    refusedPhotos: 0,
    genderFrom: null,
    seeksRefused: false,
    home: null,
  };
  const calls: { method: string; path: string; body: unknown }[] = [];
  const has = (kind: string, version: string) =>
    server.consents.some((c) => c.kind === kind && c.version === version && !c.withdrawnAt);
  const status = () => {
    // In the API's order since #681: the questions asked before the bank, then
    // the terms, then what only an account can have. The words are no step.
    const missing = [
      ...(server.profile?.displayName ? [] : ["name"]),
      ...(server.gender ? [] : ["gender"]),
      ...(server.seeks && has("special_category", SPECIAL) ? [] : ["seeks"]),
      ...(server.home ? [] : ["home"]),
      ...(has("terms", TERMS) ? [] : ["terms"]),
      ...(has("privacy", PRIVACY) ? [] : ["privacy"]),
      ...(server.ageWindow ? [] : ["age_window"]),
      ...(server.profile?.fields.intent ? [] : ["intent"]),
      ...(server.photos >= PHOTOS_FOR_COMPLETENESS ? [] : ["photos"]),
    ];
    return {
      state: missing.some((step) => ACTIVATION.includes(step)) ? "registered" : "active",
      age: options.age ?? 36,
      gender: server.gender,
      home: server.home,
      preferences: { seeks: server.seeks, ageWindow: server.ageWindow },
      consents: {
        terms: has("terms", TERMS) ? TERMS : null,
        privacy: has("privacy", PRIVACY) ? PRIVACY : null,
        specialCategory: has("special_category", SPECIAL) ? SPECIAL : null,
      },
      currentVersions: {
        terms: current(TERMS),
        privacy: current(PRIVACY),
        special_category: SPECIAL,
      },
      nextChange: { gender: server.genderFrom },
      missing,
      complete: missing.length === 0,
    };
  };
  const profileResponse = () => ({
    profile: server.profile
      ? { ...server.profile, specialCategoryConsent: null, updatedAt: "2026-09-26T10:00:00.000Z" }
      : null,
    completeness: { complete: false, missing: [] },
    home: server.home,
  });
  globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const path = new URL(request.url).pathname;
    const body = request.method === "GET" ? undefined : await request.json();
    calls.push({ method: request.method, path, body });
    if (path === "/onboarding") return json(status());
    if (path === "/photos" && request.method === "GET") {
      const photos = Array.from({ length: server.photos + server.refusedPhotos }, (_, position) =>
        aPhoto(position, position < server.photos ? "pending" : "rejected"),
      );
      return json({ photos, maxPhotos: 6, tips: [] });
    }
    const thumb = /^\/photos\/([^/]+)\/thumb$/.exec(path);
    if (thumb) {
      return json({
        id: thumb[1],
        variant: "thumb",
        url: "https://media.test/media/k/thumb.webp?Signature=s",
        expiresAt: "2030-01-01T00:15:00.000Z",
      });
    }
    if (path === "/invitations" && options.redeemable !== undefined) {
      return json({
        canInvite: false,
        redeemable: options.redeemable,
        reward: options.reward ?? { inviterFish: 1, friendFish: 1 },
        open: [],
        counted: 0,
        earned: { fish: 0 },
      });
    }
    if (path === "/invitations/redeem") {
      return options.redeem?.() ?? new Response(null, { status: 204 });
    }
    if (path === "/profile" && request.method === "GET") return json(profileResponse());
    if (path === "/profile") {
      const b = body as Profile;
      server.profile = {
        displayName: b.displayName,
        bio: b.bio,
        bioPreset: b.bioPreset,
        fields: b.fields,
        prompts: b.prompts,
      };
      return json(profileResponse());
    }
    if (path === "/account/gender" && server.genderFrom) {
      const error = { code: "change_too_soon", message: "Changed recently", requestId: "r" };
      return json({ error }, 429);
    }
    if (path === "/account/gender") {
      server.gender = (body as { gender: string }).gender;
      return new Response(null, { status: 204 });
    }
    if (path === "/account/home") {
      const { postalCode, showArea } = body as { postalCode?: string; showArea?: boolean };
      if (postalCode !== undefined) {
        const found = HOMES[postalCode];
        if (!found) {
          const error = { code: "postal_code_unknown", message: "No such code", requestId: "r" };
          return json({ error }, 400);
        }
        server.home = found;
      }
      if (showArea !== undefined && server.home) server.home = { ...server.home, showArea };
      return json(server.home);
    }
    if (path === "/preferences" && server.seeksRefused) {
      const error = { code: "consent_required", message: "Consent first", requestId: "r" };
      return json({ error }, 403);
    }
    if (path === "/preferences") {
      // Either row or both, each replacing its own (ADR-010 §13).
      const b = body as { seeks?: string[]; ageWindow?: { min: number; max: number } };
      if (b.seeks) server.seeks = b.seeks;
      if (b.ageWindow) server.ageWindow = b.ageWindow;
      return json({ seeks: server.seeks, ageWindow: server.ageWindow });
    }
    if (path === "/consents") {
      if (request.method === "POST") {
        server.consents.push(body as { kind: string; version: string; locale: string });
      }
      return json({
        // The newest hundred, as the API lists them (ADR-010 §4).
        consents: server.consents.slice(-100).map((c) => ({
          ...c,
          givenAt: "2026-09-26T10:00:00.000Z",
          withdrawnAt: c.withdrawnAt ?? null,
        })),
        currentVersions: status().currentVersions,
      });
    }
    return json({ error: { code: "not_found", message: "no", requestId: "r" } }, 404);
  }) as unknown as typeof fetch;
  return { server, calls };
}

const checkA11y = () => {
  const found = pressables(screen.toJSON() as HostNode);
  expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
};
/** Every text on the screen, in order. */
const drawn = () => screen.queryAllByText(/./).map((node) => node.props.children as unknown);
/**
 * The question as the screen's one heading, heard as one and over everything
 * but the step's number, which goes first where the step has one (#581).
 */
const asked = (question: string, number?: string) => {
  const top = number === undefined ? [question] : [number, question];
  expect(drawn().slice(0, top.length)).toEqual(top);
  const heading = screen.getByRole("heading", { name: question });
  expect(heading.props.accessibilityRole).toBe("header");
  expect(heading.props["aria-level"]).toBe("1");
  const titles = screen.getAllByRole("heading").filter((h) => h.props["aria-level"] === "1");
  expect(titles).toHaveLength(1);
  if (number !== undefined) {
    expect(screen.getByText(number).props.accessibilityLiveRegion).toBe("polite");
  }
};
const onward = () => screen.getByRole("button", { name: "Continue" });
const readOnly = () => onward().props.accessibilityState?.disabled;
const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
/** A photo through the step's own button: the picker, the upload, and the API counting it. */
const addPhoto = async (server: ReturnType<typeof fakeApi>["server"]) => {
  launch.mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: "file:///a.heic", width: 4032, height: 3024 }],
  });
  const next = server.photos + server.refusedPhotos;
  FakeXhr.answers = [{ status: 201, body: JSON.stringify(aPhoto(next, "pending")) }];
  const tiles = screen.queryAllByRole("button", { name: /^Open photo/ }).length;
  server.photos += 1;
  await press(screen.getByRole("button", { name: "Add a photo" }));
  await flush();
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: /^Open photo/ })).toHaveLength(tiles + 1),
  );
};
/** An answer that is a whole-width row (#581) by its word, chosen or not: the chosen one's name carries its mark. */
const row = (name: string) =>
  screen.getByRole(/^(radio|checkbox)$/, { name: new RegExp(`^(✓ )?${name}$`) });
const checked = (name: string) => row(name).props.accessibilityState?.checked;
const consented = (kind: string) => ({
  kind,
  version: { terms: TERMS, privacy: PRIVACY, special_category: SPECIAL }[
    kind as "terms" | "privacy" | "special_category"
  ],
  locale: "en",
});

const { __store: store } = jest.requireMock("expo-secure-store") as {
  __store: Map<string, string>;
};
const AGREED = "kuutti.preference.agreedVersions";
const OFFERED = "kuutti.preference.profileOffered";
const OFFER = "Finish your profile";
const OFFER_BODY =
  "A fuller profile brings much better suggestions. Add a few words about yourself or answer a few questions, or go on as you are.";
const TERMS_TITLE = "Accept terms of use";
const AGREE = "Agree and continue";

afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  router.replace.mockReset();
  router.push.mockReset();
  launch.mockReset();
  FakeXhr.install();
  store.delete(AGREED);
  store.delete(OFFERED);
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

describe("OnboardingScreen", () => {
  it("walks a registered account through the steps with buttons, numbering none, and ends on the offer (#681)", async () => {
    // What a bank login finds when the answers held before it did not land:
    // the terms and the privacy notice are rows (#418), and the rest is asked
    // here in the API's order, with no step numbered after the bank (#681).
    const { server, calls } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
    expect(screen.queryByText(TERMS_TITLE)).toBeNull();
    asked("What should we call you?");
    checkA11y();
    await type(screen.getByLabelText("Name on your card"), "Aino");
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    expect(server.profile?.displayName).toBe("Aino");
    asked("How do you describe yourself?");
    checkA11y();
    await press(row("Woman"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    expect(server.gender).toBe("woman");
    checkA11y();
    await press(row("Men"));
    await press(row("Non-binary people"));
    // Nothing moves on without the article 9 consent, given on this screen.
    expect(
      screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled,
    ).toBe(true);
    expect(screen.getByText(/special categories of personal data/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: `Read the full text on the website (version ${SPECIAL})` }),
    ).toBeTruthy();
    await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
    await flush();
    expect(server.consents.at(-1)).toEqual(consented("special_category"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Where do you live?")).toBeTruthy());
    // Whom one seeks is saved on leaving its screen, before the ages (ADR-010 §13).
    expect(server.seeks).toEqual(["man", "non_binary"]);
    expect(server.ageWindow).toBeNull();
    asked("Where do you live?");
    checkA11y();
    await type(screen.getByLabelText("Postal code"), "00530");
    checkA11y();
    await press(screen.getByRole("button", { name: "0 0 5 3 0, Kallio" }));
    await flush();
    await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
    checkA11y();
    await press(row("Kallio"));
    await flush();
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    expect(server.home?.showArea).toBe(true);
    // The window starts around the person's own age (36): 31 to 41, moved by buttons.
    expect(screen.getByText("31")).toBeTruthy();
    expect(screen.getByText("41")).toBeTruthy();
    checkA11y();
    await press(screen.getByRole("button", { name: "Youngest, one year younger" }));
    await press(screen.getByRole("button", { name: "Oldest, one year older" }));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
    expect(server.ageWindow).toEqual({ min: 30, max: 42 });
    checkA11y();
    await press(row("Something casual"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
    expect(server.profile?.fields).toEqual({ intent: "casual" });
    await flush();
    checkA11y();
    // The step is the grid itself: two photos added on it, and on with its Continue (#581).
    await addPhoto(server);
    expect(readOnly()).toBe(true);
    await addPhoto(server);
    checkA11y();
    await press(onward());
    await flush();
    // Nothing is missing, and the profile has no words: the offer, once (#681).
    await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Step \d+ of \d+$/)).toBeNull();
    checkA11y();
    await press(screen.getByRole("button", { name: "Not now" }));
    expect(router.replace).toHaveBeenCalledWith("/");
    expect(server.consents.map((c) => c.kind)).toEqual(["terms", "privacy", "special_category"]);
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual([
      "/profile",
      "/account/gender",
      "/consents",
      "/preferences",
      "/account/home",
      "/account/home",
      "/preferences",
      "/profile",
    ]);
    expect(calls.filter((c) => c.path === "/preferences" && c.method === "PUT")).toEqual([
      { method: "PUT", path: "/preferences", body: { seeks: ["man", "non_binary"] } },
      { method: "PUT", path: "/preferences", body: { ageWindow: { min: 30, max: 42 } } },
    ]);
  });

  it("offers a friend's invitation code once, right after the welcome, and Skip goes on to the ages (#107, #418, #681)", async () => {
    // The answers held before the bank landed; the acceptances did not.
    const { server, calls } = fakeApi({ redeemable: true });
    heldLanded(server);
    await show(<OnboardingScreen />);
    await press(await screen.findByRole("button", { name: AGREE }));
    await flush();
    await waitFor(() => expect(screen.getByText("Did a friend invite you?")).toBeTruthy());
    asked("Did a friend invite you?");
    expect(screen.queryByText(/^Step \d+ of \d+$/)).toBeNull();
    expect(screen.getByLabelText("Invitation code")).toBeTruthy();
    // What it earns, the field and the way past it: nothing explains them, and nothing points to Settings (#581).
    expect(drawn()).toEqual([
      "Did a friend invite you?",
      "The code earns you a fish and your friend a fish once your profile is complete.",
      "Invitation code",
      "Use the code",
      "Skip",
    ]);
    checkA11y();
    await press(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    // Once a walk: the status read again on focus does not bring it back.
    await act(async () => {
      focus();
      await settle(120);
    });
    expect(screen.getByText("What ages?")).toBeTruthy();
    expect(calls.filter((c) => c.path === "/invitations")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "/invitations/redeem")).toEqual([]);
  });

  it("says one moment and nothing else while the invitations are read, and the step comes with their answer (#503, #581)", async () => {
    const { server } = fakeApi({ redeemable: true });
    server.consents.push(consented("terms"), consented("privacy"));
    // The server above, but the invitations wait for the test.
    const answered = globalThis.fetch;
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname === "/invitations") await held;
      return answered(request);
    }) as unknown as typeof fetch;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Loading…")).toBeTruthy());
    // Centred, as the status's own wait: no heading until there is an offer, and no number.
    expect(drawn()).toEqual(["Loading…"]);
    expect(screen.getByText("Loading…").props.accessibilityLiveRegion).toBe("polite");
    await act(async () => {
      release();
      await settle();
    });
    await waitFor(() => expect(screen.getByText("Did a friend invite you?")).toBeTruthy());
    asked("Did a friend invite you?");
    expect(screen.queryByText("Loading…")).toBeNull();
  });

  it.each([
    [
      { inviterFish: 1, friendFish: 1 },
      "The code earns you a fish and your friend a fish once your profile is complete.",
    ],
    [{ inviterFish: 0, friendFish: 2 }, "The code earns you 2 fish once your profile is complete."],
  ])(
    "says at the step what the reward %j read from the API earns (#503)",
    async (reward, words) => {
      const { server } = fakeApi({ redeemable: true, reward });
      server.consents.push(consented("terms"), consented("privacy"));
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText(words)).toBeTruthy());
      checkA11y();
    },
  );

  it("leaves the line out of the step when the reward read earns the person nothing (#503)", async () => {
    const { server } = fakeApi({ redeemable: true, reward: { inviterFish: 1, friendFish: 0 } });
    server.consents.push(consented("terms"), consented("privacy"));
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Did a friend invite you?")).toBeTruthy());
    expect(screen.getByLabelText("Invitation code")).toBeTruthy();
    expect(screen.queryByText(/^The code earns/)).toBeNull();
    checkA11y();
  });

  it("takes a code that works, says it is in, and Continue goes on to the name (#107)", async () => {
    const { server, calls } = fakeApi({ redeemable: true });
    server.consents.push(consented("terms"), consented("privacy"));
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Did a friend invite you?")).toBeTruthy());
    await type(screen.getByLabelText("Invitation code"), "abcde-fghjk");
    await press(screen.getByRole("button", { name: "Use the code" }));
    expect(calls.filter((c) => c.path === "/invitations/redeem")).toEqual([
      { method: "POST", path: "/invitations/redeem", body: { code: "abcde-fghjk" } },
    ]);
    expect(screen.getByText("The code is in.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
    checkA11y();
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
  });

  it("says a refused code in the API's words and stays at the step until it is skipped (#107)", async () => {
    const { server } = fakeApi({
      redeemable: true,
      redeem: () =>
        json({ error: { code: "invitation_unknown", message: "x", requestId: "r" } }, 404),
    });
    server.consents.push(consented("terms"), consented("privacy"));
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Did a friend invite you?")).toBeTruthy());
    await type(screen.getByLabelText("Invitation code"), "ABCDE FGHJK");
    await press(screen.getByRole("button", { name: "Use the code" }));
    expect(screen.getByText("That code does not work. Check it and try again.")).toBeTruthy();
    // The step's own words, not onboarding's: nothing in onboarding failed.
    expect(screen.queryByText("Something did not load. Try again.")).toBeNull();
    expect(screen.getByText("Did a friend invite you?")).toBeTruthy();
    await press(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
  });

  it.each([
    ["the API says no code may be typed", false, undefined],
    ["the invitations cannot be read", undefined, undefined],
    ["the answer is not the contract", true, { fish: 1, likes: 0 }],
  ])("goes straight on to the name when %s (#107)", async (_why, redeemable, reward) => {
    const { server, calls } = fakeApi({ redeemable, reward });
    server.consents.push(consented("terms"), consented("privacy"));
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
    expect(screen.queryByText("Did a friend invite you?")).toBeNull();
    expect(calls.filter((c) => c.path === "/invitations")).toHaveLength(1);
  });

  it("does not offer the code to a walk resumed past the ages, and asks nothing about it (#107)", async () => {
    const { server, calls } = fakeApi({ redeemable: true });
    heldLanded(server);
    server.consents.push(consented("terms"), consented("privacy"));
    server.ageWindow = { min: 30, max: 42 };
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
    expect(calls.filter((c) => c.path === "/invitations")).toEqual([]);
  });

  it("resumes at the ages with whom one seeks and the home kept, then asks what one is here for", async () => {
    // What a relaunch finds after the home: the answers and the consent stored, the
    // window and the intent not yet (ADR-010 §13). The screen's own memory is empty.
    const { server, calls } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"), consented("special_category"));
    server.profile = { displayName: "Onni", bio: null, bioPreset: null, fields: {}, prompts: [] };
    server.gender = "non_binary";
    server.seeks = ["woman", "man", "non_binary"];
    server.home = IN_KALLIO;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    expect(screen.queryByText("Whom are you looking for?")).toBeNull();
    expect(screen.queryByText("What should your card show?")).toBeNull();
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
    await press(row("Something long-term"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
    expect(server.seeks).toEqual(["woman", "man", "non_binary"]);
    expect(server.ageWindow).toEqual({ min: 31, max: 41 });
    expect(server.profile?.fields).toEqual({ intent: "long_term" });
    expect(calls.filter((c) => c.path === "/preferences" && c.method === "PUT")).toEqual([
      { method: "PUT", path: "/preferences", body: { ageWindow: { min: 31, max: 41 } } },
    ]);
  });

  it("offers a dance partner beside the other three intents, and saves it (#175)", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"), consented("special_category"));
    server.profile = { displayName: "Onni", bio: null, bioPreset: null, fields: {}, prompts: [] };
    server.gender = "man";
    server.seeks = ["woman"];
    server.home = IN_KALLIO;
    server.ageWindow = { min: 30, max: 42 };
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
    for (const name of [
      "Something long-term",
      "Something casual",
      "Open to either",
      "A dance partner",
    ]) {
      expect(checked(name)).toBe(false);
    }
    checkA11y();
    await press(row("A dance partner"));
    expect(checked("A dance partner")).toBe(true);
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
    expect(server.profile?.fields).toEqual({ intent: "dance_partner" });
  });

  /** What comes before a step answered, so that the step is next, in the order the app asks them (#681). */
  const answeredBefore = (server: ReturnType<typeof fakeApi>["server"], step: string) => {
    const order = ["name", "gender", "seeks", "home", "age", "intent", "photos"];
    const past = (answer: string) => order.indexOf(answer) < order.indexOf(step);
    server.consents.push(consented("terms"), consented("privacy"));
    if (past("name")) {
      server.profile = {
        displayName: "Onni",
        bio: null,
        bioPreset: null,
        fields: past("intent") ? { intent: "long_term" } : {},
        prompts: [],
      };
    }
    if (past("gender")) server.gender = "man";
    if (past("seeks")) {
      server.seeks = ["woman"];
      server.consents.push(consented("special_category"));
    }
    if (past("age")) server.ageWindow = { min: 30, max: 42 };
    if (past("home")) server.home = IN_KALLIO;
    if (past("photos")) server.photos = PHOTOS_FOR_COMPLETENESS;
  };

  describe("each question, the screen's one heading, numbered nowhere, with at most one line under it (#581, #681)", () => {
    it.each([
      ["en-US", "name", "What should we call you?", "Name on your card"],
      ["fi-FI", "name", "Miksi sinua kutsutaan?", "Nimi kortillasi"],
      ["sv-FI", "name", "Vad ska vi kalla dig?", "Namn på ditt kort"],
      [
        "en-US",
        "gender",
        "How do you describe yourself?",
        "Yours to choose, not the bank's. This is shown on your card.",
      ],
      [
        "fi-FI",
        "gender",
        "Miten kuvailet itseäsi?",
        "Sinun valintasi, ei pankin. Tämä näkyy kortillasi.",
      ],
      [
        "sv-FI",
        "gender",
        "Hur beskriver du dig själv?",
        "Ditt val, inte bankens. Det här visas på ditt kort.",
      ],
      [
        "en-US",
        "seeks",
        "Whom are you looking for?",
        "Nobody outside your choice is ever shown to you, and you are never shown to anyone who did not pick you.",
      ],
      [
        "fi-FI",
        "seeks",
        "Ketä etsit?",
        "Ketään valintasi ulkopuolelta ei koskaan näytetä sinulle, eikä sinua näytetä kenellekään, joka ei valinnut sinua.",
      ],
      [
        "sv-FI",
        "seeks",
        "Vem söker du?",
        "Ingen utanför ditt val visas någonsin för dig, och du visas aldrig för någon som inte valde dig.",
      ],
      [
        "en-US",
        "intent",
        "What are you here for?",
        "You're shown only to people who want the same thing.",
      ],
      [
        "fi-FI",
        "intent",
        "Mitä etsit täältä?",
        "Sinut näytetään vain niille, jotka haluavat samaa.",
      ],
      ["sv-FI", "intent", "Vad är du här för?", "Du visas bara för dem som vill samma sak."],
      // The ages' line is gone: the steppers' own names come right under the question.
      ["en-US", "age", "What ages?", "Youngest"],
      ["fi-FI", "age", "Minkä ikäisiä?", "Nuorin"],
      ["sv-FI", "age", "Vilka åldrar?", "Yngsta"],
      [
        "en-US",
        "home",
        "Where do you live?",
        "Your postal code tells Kumpa how far people are. Others see a town or your area by name, never the digits.",
      ],
      [
        "fi-FI",
        "home",
        "Missä asut?",
        "Postinumerostasi Kumpa tietää, kuinka kaukana ihmiset ovat. Muut näkevät kaupungin tai alueesi nimen, eivät koskaan numeroita.",
      ],
      [
        "sv-FI",
        "home",
        "Var bor du?",
        "Ditt postnummer berättar för Kumpa hur långt bort folk är. Andra ser en stad eller ditt område med namn, aldrig siffrorna.",
      ],
      ["en-US", "photos", "Two photos of you", "Profiles with a face photo get seen."],
      [
        "fi-FI",
        "photos",
        "Kaksi kuvaa sinusta",
        "Profiilit, joissa on kasvokuva, tulevat nähdyiksi.",
      ],
      ["sv-FI", "photos", "Två bilder på dig", "Profiler med en ansiktsbild blir sedda."],
    ])("on a %s phone, the %s step", async (tag, step, question, line) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        const { server } = fakeApi();
        answeredBefore(server, step);
        await show(<OnboardingScreen />);
        await waitFor(() => expect(screen.getByText(question)).toBeTruthy());
        asked(question);
        expect(drawn()[1]).toBe(line);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it.each([
      [
        "en-US",
        "Non-binary",
        "Continue",
        "A word for it, if you like",
        "Shown on your card, never used for matching.",
      ],
      [
        "fi-FI",
        "Muunsukupuolinen",
        "Jatka",
        "Sana sille, jos haluat",
        "Näytetään kortillasi, ei koskaan käytetä yhdistämiseen.",
      ],
      [
        "sv-FI",
        "Icke-binär",
        "Fortsätt",
        "Ett ord för det, om du vill",
        "Visas på ditt kort, används aldrig för matchning.",
      ],
    ])("on a %s phone, the word after %s", async (tag, gender, go, question, line) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        const { server } = fakeApi();
        answeredBefore(server, "gender");
        await show(<OnboardingScreen />);
        await press(await screen.findByRole("radio", { name: gender }));
        await press(screen.getByRole("button", { name: go }));
        await flush();
        await waitFor(() => expect(screen.getByText(question)).toBeTruthy());
        asked(question);
        expect(drawn()[1]).toBe(line);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });

    it("names the name's field over it, as The basics does, and says no more", async () => {
      const { server } = fakeApi();
      answeredBefore(server, "name");
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
      expect(drawn()).toEqual(["What should we call you?", "Name on your card", "Continue"]);
      const field = screen.getByLabelText("Name on your card");
      // Every step is what the card needs, so nothing is starred or said of it (#616).
      expect(field.props.accessibilityHint).toBeUndefined();
      expect(field.props.maxLength).toBe(DISPLAY_NAME_MAX);
      expect(field.props.autoCapitalize).toBe("words");
      expect(readOnly()).toBe(true);
      await type(field, "   ");
      expect(readOnly()).toBe(true);
      await type(screen.getByLabelText("Name on your card"), " Aino ");
      expect(readOnly()).toBe(false);
      checkA11y();
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
      expect(server.profile?.displayName).toBe("Aino");
    });
  });

  describe("the photos step, the grid itself (#581)", () => {
    const LEAD =
      "Hold a photo and drag it to change the order. A new photo is checked before anyone else sees it.";
    /** Everything but the photos answered, the profile with no words: the step is next, and the offer after it. */
    const atPhotos = async () => {
      const api = fakeApi();
      answeredBefore(api.server, "photos");
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText(LEAD)).toBeTruthy());
      return api;
    };
    const reads = (calls: ReturnType<typeof fakeApi>["calls"], path: string) =>
      calls.filter((c) => c.method === "GET" && c.path === path).length;
    const backFromAPhoto = () =>
      act(async () => {
        focus();
        await settle(120);
      });

    it("opens on the grid with nothing to press first, and no screen of its own to go to", async () => {
      await atPhotos();
      asked("Two photos of you");
      expect(drawn()).toEqual([
        "Two photos of you",
        "Profiles with a face photo get seen.",
        LEAD,
        "Add a photo",
        "Continue",
      ]);
      expect(router.push).not.toHaveBeenCalled();
      expect(readOnly()).toBe(true);
      checkA11y();
    });

    it("waits for two photos, and even then for its Continue, and does not come back after it", async () => {
      const { server } = await atPhotos();
      await addPhoto(server);
      expect(readOnly()).toBe(true);
      await addPhoto(server);
      expect(readOnly()).toBe(false);
      await flush();
      // Two photos answer the step to the API, and nothing has moved.
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
      asked(OFFER);
      await backFromAPhoto();
      expect(screen.getByText(OFFER)).toBeTruthy();
      expect(screen.queryByText("Two photos of you")).toBeNull();
    });

    it("stands while a photo is looked at full size and after, though the status read on the way back says two are enough", async () => {
      const { server } = await atPhotos();
      await addPhoto(server);
      await addPhoto(server);
      await press(screen.getByRole("button", { name: "Open photo 1" }));
      expect(router.push).toHaveBeenCalledWith(
        expect.objectContaining({ pathname: "/photos/[id]" }),
      );
      await backFromAPhoto();
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      expect(screen.getAllByRole("button", { name: /^Open photo/ })).toHaveLength(2);
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
    });

    it("reads both the list and the status again at its press", async () => {
      const { server, calls } = await atPhotos();
      await addPhoto(server);
      await addPhoto(server);
      const list = reads(calls, "/photos");
      const status = reads(calls, "/onboarding");
      await press(onward());
      await flush();
      expect(reads(calls, "/photos")).toBe(list + 1);
      expect(reads(calls, "/onboarding")).toBe(status + 1);
    });

    it("stays when a photo was refused since the list was read, says why on its tile, and goes on with another", async () => {
      const { server } = await atPhotos();
      await addPhoto(server);
      await addPhoto(server);
      expect(readOnly()).toBe(false);
      // The check's answer came after the last read: two on the phone, one to the API.
      server.photos = 1;
      server.refusedPhotos = 1;
      await press(onward());
      await flush();
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      expect(
        screen.getByText("Not accepted. This photo does not fit Kumpa; try another one."),
      ).toBeTruthy();
      expect(readOnly()).toBe(true);
      await addPhoto(server);
      expect(readOnly()).toBe(false);
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
    });

    it("shows the upload's words for a list that could not be read, reads it again at Continue, and stays while the API says so", async () => {
      const { server, calls } = fakeApi();
      answeredBefore(server, "photos");
      const api = failingUntilOk("/photos");
      await show(<OnboardingScreen />);
      await waitFor(() =>
        expect(screen.getByText("That did not go through. Try again.")).toBeTruthy(),
      );
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      expect(readOnly()).toBe(false);
      api.ok();
      const status = reads(calls, "/onboarding");
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(LEAD)).toBeTruthy());
      expect(reads(calls, "/onboarding")).toBe(status + 1);
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      expect(screen.queryByText("That did not go through. Try again.")).toBeNull();
      expect(readOnly()).toBe(true);
    });

    it("says a status that could not be read at Continue, and goes on once it can", async () => {
      const { server } = await atPhotos();
      await addPhoto(server);
      await addPhoto(server);
      const api = failingUntilOk("/onboarding");
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(FAILED_TO_LOAD)).toBeTruthy());
      api.ok();
      await press(screen.getByRole("button", { name: "Try again" }));
      await flush();
      // A read is no Continue: the step is still the person's to end.
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      await press(onward());
      await flush();
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
    });

    it("leaves for home, drawing nothing on the way, when the photos were all that was missing", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.photos = 1;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText(LEAD)).toBeTruthy());
      await addPhoto(server);
      await press(onward());
      await flush();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(drawn()).toEqual([]);
    });

    it("stands until its Continue after a refusal too, once another photo makes it two", async () => {
      const { server } = await atPhotos();
      await addPhoto(server);
      await addPhoto(server);
      server.photos = 1;
      server.refusedPhotos = 1;
      await press(onward());
      await flush();
      expect(readOnly()).toBe(true);
      await addPhoto(server);
      await backFromAPhoto();
      expect(screen.getByText("Two photos of you")).toBeTruthy();
    });
  });

  describe("the steps that ask one thing, as whole-width rows (#581)", () => {
    const atGender = async () => {
      const { server } = fakeApi();
      server.consents.push(consented("terms"), consented("privacy"));
      server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
      return server;
    };

    it("the gender as radios in a group, with nothing chosen until a press", async () => {
      await atGender();
      expect(screen.getByLabelText("Gender").props.accessibilityRole).toBe("radiogroup");
      expect(screen.getAllByRole("radio").map((r) => r.props.accessibilityLabel)).toEqual([
        "Woman",
        "Man",
        "Non-binary",
      ]);
      await press(row("Man"));
      expect(checked("Man")).toBe(true);
      expect(screen.getByText("✓ Man")).toBeTruthy();
      checkA11y();
    });

    it("the intent as radios in a group, a row each, one chosen at a time, and no way on until one is", async () => {
      const { server } = fakeApi();
      answeredBefore(server, "intent");
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
      const group = screen.getByLabelText("What are you here for?");
      expect(group.props.accessibilityRole).toBe("radiogroup");
      expect(group.props.className).not.toMatch(/\bflex-row\b/);
      expect(screen.getAllByRole("radio").map((r) => r.props.accessibilityLabel)).toEqual([
        "Something long-term",
        "Something casual",
        "Open to either",
        "A dance partner",
      ]);
      expect(row("Something casual").parent).toBe(group);
      expect(readOnly()).toBe(true);
      await press(row("Something casual"));
      expect(checked("Something casual")).toBe(true);
      expect(screen.getByText("✓ Something casual")).toBeTruthy();
      expect(readOnly()).toBe(false);
      await press(row("Open to either"));
      expect(checked("Open to either")).toBe(true);
      expect(checked("Something casual")).toBe(false);
      expect(screen.queryByText("✓ Something casual")).toBeNull();
      checkA11y();
    });

    it("the identity label as radios in a group of its own", async () => {
      await atGender();
      await press(row("Non-binary"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() => expect(screen.getByText("A word for it, if you like")).toBeTruthy());
      asked("A word for it, if you like");
      expect(drawn()[1]).toBe("Shown on your card, never used for matching.");
      const group = screen.getByLabelText("A word for it, if you like");
      expect(group.props.accessibilityRole).toBe("radiogroup");
      expect(screen.getAllByRole("radio")).toHaveLength(7);
      expect(row("Genderfluid").parent).toBe(group);
    });

    it("whom one seeks as checkboxes, in no group that says one goes", async () => {
      const server = await atGender();
      server.gender = "woman";
      await press(row("Woman"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
      expect(screen.getAllByRole("checkbox").map((r) => r.props.accessibilityLabel)).toEqual([
        "Women",
        "Men",
        "Non-binary people",
        "Anyone",
      ]);
      expect(radioGroups()).toEqual([]);
    });
  });

  it("offers the identity label after a non-binary gender only, and saves the one chosen", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    await press(row("Non-binary"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("A word for it, if you like")).toBeTruthy());
    checkA11y();
    await press(row("Genderfluid"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    expect(server.profile?.fields).toEqual({ identityLabel: "genderfluid" });
  });

  it("says from when a gender change is possible when one is refused for its cadence", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    server.genderFrom = "2026-11-08T10:00:00.000Z";
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    await press(row("Woman"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText(/You changed this recently/)).toBeTruthy());
    expect(screen.getByText("Next change possible: 8.11.2026.")).toBeTruthy();
  });

  it("skips the identity label on request and never offers it after another gender", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    await press(row("Non-binary"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("A word for it, if you like")).toBeTruthy());
    await press(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    expect(server.profile?.fields).toEqual({});
  });

  it("keeps the age window inside the bounds and the youngest at most the oldest", async () => {
    expect(defaultAgeWindow(36)).toEqual({ min: 31, max: 41 });
    expect(defaultAgeWindow(18)).toEqual({ min: 18, max: 23 });
    expect(defaultAgeWindow(99)).toEqual({ min: 94, max: 99 });
    const { server } = fakeApi({ age: 18 });
    server.consents.push(consented("terms"), consented("privacy"), consented("special_category"));
    server.profile = {
      displayName: "Onni",
      bio: null,
      bioPreset: null,
      fields: { intent: "long_term" },
      prompts: [],
    };
    server.gender = "man";
    server.home = IN_KALLIO;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(row("Anyone"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    const disabled = (name: string) =>
      screen.getByRole("button", { name }).props.accessibilityState?.disabled === true;
    expect(disabled("Youngest, one year younger")).toBe(true);
    for (let i = 0; i < 5; i += 1) {
      await press(screen.getByRole("button", { name: "Oldest, one year younger" }));
    }
    expect(screen.getAllByText("18")).toHaveLength(2);
    expect(disabled("Oldest, one year younger")).toBe(true);
    expect(disabled("Youngest, one year older")).toBe(true);
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    expect(server.ageWindow).toEqual({ min: 18, max: 18 });
    expect(server.seeks).toEqual(["woman", "man", "non_binary"]);
  });

  it("stands the two age steppers one above the other: side by side, a small phone overflows (#581)", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"), consented("special_category"));
    server.profile = {
      displayName: "Onni",
      bio: null,
      bioPreset: null,
      fields: { intent: "long_term" },
      prompts: [],
    };
    server.gender = "man";
    server.seeks = ["woman"];
    server.home = IN_KALLIO;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    const stepperOf = (name: string) => screen.getByText(name).parent;
    const column = stepperOf("Youngest")?.parent;
    expect(stepperOf("Oldest")?.parent).toBe(column);
    expect(column?.props.className).not.toMatch(/\bflex-row\b/);
    expect(stepperOf("Youngest")?.props.className).not.toMatch(/\bflex-1\b/);
    checkA11y();
  });

  it("asks only whom one seeks again after a withdrawal, and keeps the age window", async () => {
    // A withdrawal of the sensitive-answers consent removes whom one seeks (#204); the window
    // is no sensitive answer and stays, so the ages are not asked again (ADR-010 §13).
    const { server, calls } = fakeApi({ age: 43 });
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = {
      displayName: "Noa",
      bio: null,
      bioPreset: null,
      fields: { intent: "open_to_either" },
      prompts: [],
    };
    server.gender = "woman";
    server.ageWindow = { min: 35, max: 50 };
    server.home = IN_KALLIO;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(row("Anyone"));
    await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
    expect(screen.queryByText("What ages?")).toBeNull();
    expect(server.seeks).toEqual(["woman", "man", "non_binary"]);
    expect(server.ageWindow).toEqual({ min: 35, max: 50 });
    expect(calls.filter((c) => c.path === "/preferences" && c.method === "PUT")).toEqual([
      { method: "PUT", path: "/preferences", body: { seeks: ["woman", "man", "non_binary"] } },
    ]);
  });

  it("The welcome step asks for the terms and the privacy notice when they are missing after the sign-in", async () => {
    // The acceptances before the bank did not become rows (lost with the process, or a failed post).
    const { server, calls } = fakeApi();
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText(TERMS_TITLE)).toBeTruthy());
    // The one heading, the rules under it, and the two texts as links where their summaries were (#681).
    asked(TERMS_TITLE);
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
    // Nothing of keeping answers: after the bank there is an account to keep them.
    expect(screen.queryByText(/To keep your answers/)).toBeNull();
    // English is the binding text (#208): nothing calls it a translation.
    expect(screen.queryByText(/is the one that counts/)).toBeNull();
    expect(screen.queryByText(/^Step \d+ of \d+$/)).toBeNull();
    checkA11y();
    await press(screen.getByRole("button", { name: AGREE }));
    await flush();
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
    expect(server.consents.map((c) => [c.kind, c.version, c.locale])).toEqual([
      ["terms", TERMS, "en"],
      ["privacy", PRIVACY, "en"],
    ]);
    expect(calls.filter((c) => c.method !== "GET").map((c) => c.path)).toEqual([
      "/consents",
      "/consents",
    ]);
    // This phone has them now: its next sign-in goes straight to the bank.
    expect(JSON.parse(String(store.get(AGREED)))).toEqual({
      terms: CONSENT_VERSIONS.terms,
      privacy: CONSENT_VERSIONS.privacy,
    });
  });

  it("gives the welcome step's acceptances in Finnish on a Finnish phone", async () => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag: "fi-FI" }]);
    try {
      const { server } = fakeApi();
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Hyväksy käyttöehdot")).toBeTruthy());
      expect(screen.getByText("Lue käyttöehdot")).toBeTruthy();
      expect(screen.getByText("Lue tietosuojaseloste")).toBeTruthy();
      await press(screen.getByRole("button", { name: "Hyväksy ja jatka" }));
      await flush();
      expect(server.consents.map((c) => [c.kind, c.locale])).toEqual([
        ["terms", "fi"],
        ["privacy", "fi"],
      ]);
      expect(store.has(AGREED)).toBe(true);
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it("asks somebody who chose Stadi for the sensitive answers' consent as Finnish: the binding line in Finnish, and fi on the record (#521)", async () => {
    store.set("kuutti.preference.locale", "fi-x-stadi");
    try {
      const { server } = fakeApi();
      server.consents.push(consented("terms"), consented("privacy"));
      server.profile = { displayName: "Onni", bio: null, bioPreset: null, fields: {}, prompts: [] };
      server.gender = "non_binary";
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Ketä etsit?")).toBeTruthy());
      expect(screen.getByText("Arkaluonteiset tiedot")).toBeTruthy();
      expect(screen.getByText("Englanninkielinen teksti on sitova; tämä on käännös.")).toBeTruthy();
      await press(screen.getByLabelText("Annan Kuutti ry:lle luvan tallentaa, kenen seuraa etsin"));
      await flush();
      expect(server.consents.at(-1)).toEqual({ ...consented("special_category"), locale: "fi" });
    } finally {
      store.delete("kuutti.preference.locale");
    }
  });

  // The legal texts are written in English and Finnish: a Swedish phone reads
  // the English, which binds, so nothing there is a translation (#208).
  it.each([
    ["en-US", "Whom are you looking for?", "I consent to Kuutti ry storing whom I seek"],
    ["sv-FI", "Vem söker du?", "Jag samtycker till att Kuutti ry lagrar vem jag söker"],
  ])(
    "asks a %s phone for the sensitive answers' consent in the English text itself, and calls nothing a translation",
    async (tag, question, allow) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        const { server } = fakeApi();
        server.consents.push(consented("terms"), consented("privacy"));
        server.profile = {
          displayName: "Onni",
          bio: null,
          bioPreset: null,
          fields: {},
          prompts: [],
        };
        server.gender = "non_binary";
        await show(<OnboardingScreen />);
        await waitFor(() => expect(screen.getByText(question)).toBeTruthy());
        expect(screen.getByText("Sensitive answers")).toBeTruthy();
        expect(screen.getByText(/^Whom you seek, the political parties/)).toBeTruthy();
        expect(screen.queryByText(/one that counts|som gäller|on sitova/)).toBeNull();
        await press(screen.getByLabelText(allow));
        await flush();
        expect(server.consents.at(-1)).toMatchObject({
          kind: "special_category",
          version: SPECIAL,
        });
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    },
  );

  it("stays at the welcome step, remembering nothing, when a consent there is refused", async () => {
    const { server } = fakeApi();
    const api = failingUntilOk("/consents");
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText(TERMS_TITLE)).toBeTruthy());
    await press(screen.getByRole("button", { name: AGREE }));
    await flush();
    await waitFor(() =>
      expect(screen.getByText("Something did not load. Try again.")).toBeTruthy(),
    );
    expect(screen.getByText(TERMS_TITLE)).toBeTruthy();
    expect(server.consents).toEqual([]);
    expect(store.has(AGREED)).toBe(false);
    // Pressed again once the API takes it: both land, and only then is the phone remembered.
    api.ok();
    await press(screen.getByRole("button", { name: AGREE }));
    await flush();
    await waitFor(() => expect(screen.getByText("What should we call you?")).toBeTruthy());
    expect(store.has(AGREED)).toBe(true);
  });

  it("asks for an app update instead of recording a consent for a wording it did not show", async () => {
    const { server, calls } = fakeApi({ version: "2026-11-final-1" });
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText(TERMS_TITLE)).toBeTruthy());
    expect(screen.getByText(/Update the app to continue/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: AGREE })).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
    expect(server.consents).toEqual([]);
    expect(store.has(AGREED)).toBe(false);
  });

  /** What the bank login saved of the answers held before it (#681): the walk begins at the ages. */
  function heldLanded(server: ReturnType<typeof fakeApi>["server"]) {
    server.consents.push(consented("special_category"));
    server.profile = { displayName: "Aino", bio: null, bioPreset: null, fields: {}, prompts: [] };
    server.gender = "woman";
    server.seeks = ["man"];
    server.home = IN_KALLIO;
  }

  /** Everything answered: nothing is missing. */
  function allAnswered(server: ReturnType<typeof fakeApi>["server"]) {
    server.consents.push(consented("terms"), consented("privacy"), consented("special_category"));
    server.gender = "woman";
    server.seeks = ["man"];
    server.ageWindow = { min: 30, max: 40 };
    server.profile = {
      displayName: "Aino",
      bio: "x".repeat(50),
      bioPreset: null,
      fields: { intent: "casual" },
      prompts: [],
    };
    server.home = IN_KALLIO;
    server.photos = 3;
  }

  /** The API answers one path with a refusal until `ok()` is called. */
  function failingUntilOk(path: string, status = 500, code = "internal_error") {
    const answers = globalThis.fetch;
    let failing = true;
    globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (failing && new URL(request.url).pathname === path) {
        return json({ error: { code, message: "x", requestId: "r" } }, status);
      }
      return answers(input, init);
    }) as unknown as typeof fetch;
    return {
      ok: () => {
        failing = false;
      },
    };
  }

  it("leaves once whom one seeks is answered anew after a withdrawal, asking nothing else (#146)", async () => {
    // Onboarding walked once; then the sensitive-answers consent was withdrawn in
    // Settings, and whom one seeks with it. The withdrawn row stays (ADR-010 §4).
    const { server } = fakeApi();
    allAnswered(server);
    server.consents = server.consents.map((c) =>
      c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
    );
    server.seeks = null;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(row("Men"));
    await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(server.seeks).toEqual(["man"]);
  });

  it("says why whom one seeks was refused and offers the consent again when it went meanwhile", async () => {
    const { server } = fakeApi();
    allAnswered(server);
    server.seeks = null;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(row("Men"));
    // Taken back on another device while the step was open (ADR-010 §16).
    server.consents = server.consents.map((c) =>
      c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
    );
    server.seeksRefused = true;
    await press(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(screen.getByText("This field needs your explicit consent first.")).toBeTruthy(),
    );
    expect(server.seeks).toBeNull();
    // The status was read again, so the switch can be given once more.
    server.seeksRefused = false;
    await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    expect(server.seeks).toEqual(["man"]);
  });

  describe("the offer to finish the profile (#681)", () => {
    /** Everything answered but the intent, the profile with `words`: the intent ends the walk. */
    const atLastStep = async (words: Partial<Profile> = {}) => {
      const api = fakeApi();
      allAnswered(api.server);
      api.server.profile = {
        displayName: "Aino",
        bio: null,
        bioPreset: null,
        fields: {},
        prompts: [],
        ...words,
      };
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("What are you here for?")).toBeTruthy());
      await press(row("Something casual"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      return api;
    };

    it("The offer to finish the profile is shown once after the walk", async () => {
      await atLastStep();
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
      // The one heading, its reason, and the two ways on: nothing else (#681).
      asked(OFFER);
      expect(drawn()).toEqual([OFFER, OFFER_BODY, "Finish my profile", "Not now"]);
      checkA11y();
      expect(store.get(OFFERED)).toBe("shown");
      await press(screen.getByRole("button", { name: "Not now" }));
      expect(router.replace).toHaveBeenCalledWith("/");
      expect(router.push).not.toHaveBeenCalled();
    });

    it("is not offered again on a phone that showed it, the words still missing", async () => {
      store.set(OFFERED, "shown");
      await atLastStep();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(screen.queryByText(OFFER)).toBeNull();
    });

    it("opens the profile from home when the person chooses to finish it", async () => {
      await atLastStep();
      await press(await screen.findByRole("button", { name: "Finish my profile" }));
      // Home first, so that Back from the profile lands there and not on onboarding.
      expect(router.replace).toHaveBeenCalledWith("/");
      expect(router.push).toHaveBeenCalledWith("/profile");
      expect((router.replace as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        (router.push as jest.Mock).mock.invocationCallOrder[0] as number,
      );
    });

    it.each([
      ["a bio of fifty characters", { bio: "x".repeat(50) }],
      ["a ready line", { bioPreset: "photos_speak" }],
      [
        "two answered questions",
        {
          prompts: [
            { key: "sunday", answer: "Long walks" },
            { key: "teach_me", answer: "Bread" },
          ],
        },
      ],
    ])("is not offered to a profile with its words: %s", async (_, words) => {
      await atLastStep(words);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(screen.queryByText(OFFER)).toBeNull();
      expect(store.has(OFFERED)).toBe(false);
    });

    it.each([
      ["a bio of forty-nine characters", { bio: "x".repeat(49) }],
      ["a bio of fifty spaces", { bio: " ".repeat(50) }],
      ["one answered question", { prompts: [{ key: "sunday", answer: "Long walks" }] }],
    ])("is offered to a profile short of its words: %s", async (_, words) => {
      await atLastStep(words);
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
    });

    it("is not offered when the walk asked nothing, and home comes at once", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.profile = {
        displayName: "Aino",
        bio: null,
        bioPreset: null,
        fields: { intent: "casual" },
        prompts: [],
      };
      await show(<OnboardingScreen />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(screen.queryByText(OFFER)).toBeNull();
      expect(store.has(OFFERED)).toBe(false);
    });

    it("is offered in Finnish on a Finnish phone", async () => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "fi-FI" }]);
      try {
        const { server } = fakeApi();
        allAnswered(server);
        server.profile = {
          displayName: "Aino",
          bio: null,
          bioPreset: null,
          fields: {},
          prompts: [],
        };
        await show(<OnboardingScreen />);
        await press(await screen.findByRole("radio", { name: "Jotain rentoa" }));
        await press(screen.getByRole("button", { name: "Jatka" }));
        await flush();
        await waitFor(() => expect(screen.getByText("Viimeistele profiilisi")).toBeTruthy());
        await press(screen.getByRole("button", { name: "Ei nyt" }));
        expect(router.replace).toHaveBeenCalledWith("/");
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });
  });

  it("shows once what the card says of the home the bank login saved from the phone", async () => {
    // The bank login saved the answers held before it (save-held.ts); the walk
    // begins with the home's second question, what the card shows of it.
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    takeSavedHome();
    await saveHeldAnswers({
      name: "Aino",
      gender: "woman",
      seeks: ["man"],
      specialCategory: { version: SPECIAL, locale: "en" },
      postalCode: "00530",
      at: Date.now(),
    });
    expect(server.home).toEqual(IN_KALLIO);
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
    expect(checked("Helsinki")).toBe(true);
    await press(row("Kallio"));
    await flush();
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("What ages?")).toBeTruthy());
    expect(server.home?.showArea).toBe(true);
    // Once: the screen took it, and another run goes on from what the account has.
    expect(takeSavedHome()).toBeNull();
  });

  // The designers' try (the tech screen's neubrutalism, outside production): a
  // walk that asked something ends on ProfileReady. Today's look goes home at
  // once, which the tests above hold.
  describe("the end of the walk in the designers' try", () => {
    const LOOK = "kuutti.preference.look";
    beforeEach(() => store.set(LOOK, "neubrutalism"));
    afterEach(() => store.delete(LOOK));

    it("celebrates a walk that asked something, and goes home from its one button", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.consents = server.consents.map((c) =>
        c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
      );
      server.seeks = null;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
      await press(row("Men"));
      await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Profile ready!" })).toBeTruthy(),
      );
      expect(screen.getByText("Nicely done. That was the hard part.")).toBeTruthy();
      // Home waits for the button, and nothing else is offered.
      expect(router.replace).not.toHaveBeenCalled();
      expect(screen.getAllByRole("button").map((b) => b.props.accessibilityLabel)).toEqual([
        "Continue",
      ]);
      checkA11y();
      await press(screen.getByRole("button", { name: "Continue" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });

    it("celebrates without motion when reduce motion is on, the same words and button", async () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
      const { server } = fakeApi();
      allAnswered(server);
      server.consents = server.consents.map((c) =>
        c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
      );
      server.seeks = null;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
      await press(row("Men"));
      await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Profile ready!" })).toBeTruthy(),
      );
      await press(screen.getByRole("button", { name: "Continue" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });

    it("goes home at once when nothing was asked, with no celebration", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      await show(<OnboardingScreen />);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(screen.queryByRole("heading", { name: "Profile ready!" })).toBeNull();
    });

    it("offers to finish the profile after the celebration, when it has no words (#681)", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.profile = { displayName: "Aino", bio: null, bioPreset: null, fields: {}, prompts: [] };
      await show(<OnboardingScreen />);
      await press(await screen.findByRole("radio", { name: "Something casual" }));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Profile ready!" })).toBeTruthy(),
      );
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText(OFFER)).toBeTruthy());
      expect(router.replace).not.toHaveBeenCalled();
      await press(screen.getByRole("button", { name: "Not now" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });
  });

  // Organic Pop (outside production) ends the same walk on its own Profile
  // ready: the same words and one way on, the person's own photo, still in
  // review, in a circle among the shapes, drawn and never read.
  describe("the end of the walk in the Organic Pop try", () => {
    const LOOK = "kuutti.preference.look";
    beforeEach(() => store.set(LOOK, "organic"));
    afterEach(() => store.delete(LOOK));

    const toTheEnd = async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.consents = server.consents.map((c) =>
        c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
      );
      server.seeks = null;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
      await press(row("Men"));
      await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() =>
        expect(screen.getByRole("heading", { name: "Profile ready!" })).toBeTruthy(),
      );
    };

    it("celebrates with the same words and button, the photo in review drawn and unheard", async () => {
      await toTheEnd();
      expect(screen.getByText("Nicely done. That was the hard part.")).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalled();
      // One way on, named by its words.
      expect(screen.getAllByRole("button")).toEqual([
        screen.getByRole("button", { name: "Continue" }),
      ]);
      // The photo is the person's own, pending, on the screen but kept from the reader.
      await waitFor(() =>
        expect(screen.getByLabelText("You", { includeHiddenElements: true })).toBeTruthy(),
      );
      expect(screen.queryByLabelText("You")).toBeNull();
      checkA11y();
      await press(screen.getByRole("button", { name: "Continue" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });

    /** Every rotation drawn, the hidden too: the shape's turn is where the motion shows. */
    const rotations = () => {
      const found: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") return;
        const { props, children } = node as { props?: { style?: unknown }; children?: unknown };
        const style = StyleSheet.flatten(props?.style as never) as
          | { transform?: { rotate?: unknown }[] }
          | undefined;
        for (const part of style?.transform ?? []) {
          if (typeof part.rotate === "string") found.push(part.rotate);
        }
        walk(children);
      };
      walk(screen.toJSON());
      return found;
    };

    it("celebrates without motion when reduce motion is on: the shape upright, the same words and button", async () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(true);
      await toTheEnd();
      expect(rotations()).toContain("0deg");
      expect(rotations()).not.toContain("12deg");
      expect(screen.getByText("Nicely done. That was the hard part.")).toBeTruthy();
      await press(screen.getByRole("button", { name: "Continue" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });

    it("begins with the shape turned when motion is allowed", async () => {
      jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(false);
      await toTheEnd();
      expect(rotations()).toContain("12deg");
    });

    /** The width of every drawing, the hidden too: a shape is as wide as its words. */
    const drawnWidths = () => {
      const found: number[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (!node || typeof node !== "object") return;
        const { type, props, children } = node as {
          type?: unknown;
          props?: { width?: unknown };
          children?: unknown;
        };
        if (type === "RNSVGSvgView" && typeof props?.width === "number") found.push(props.width);
        walk(children);
      };
      walk(screen.toJSON());
      return found;
    };
    /** The headline as wide as `width` points, as the layout measures it on a phone. */
    const measure = (headline: string, width: number) =>
      fireEvent(screen.getByRole("heading", { name: headline }), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 80 } },
      });

    it("widens the shape under the words when they are wider than the room", async () => {
      await toTheEnd();
      expect(drawnWidths()).toContain(400);
      await measure("Profile ready!", 300);
      expect(drawnWidths()).toContain(400);
      await measure("Profile ready!", 400);
      expect(drawnWidths()).toContain(480);
      expect(drawnWidths()).not.toContain(400);
    });
  });

  // Glass and Bold Contrast end the walk on the same Profile ready, on their
  // own ground, the headline in the colour that ground is paired with.
  describe.each([
    ["glass", "text-card-foreground"],
    ["bold", "text-accent-foreground"],
  ] as const)("the end of the walk in the %s try", (look, ink) => {
    const LOOK = "kuutti.preference.look";
    beforeEach(() => store.set(LOOK, look));
    afterEach(() => store.delete(LOOK));

    it("celebrates with the same words and button, the headline in its ground's ink", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.consents = server.consents.map((c) =>
        c.kind === "special_category" ? { ...c, withdrawnAt: "2026-10-01T10:00:00.000Z" } : c,
      );
      server.seeks = null;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
      await press(row("Men"));
      await press(screen.getByLabelText("I consent to Kuutti ry storing whom I seek"));
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      const headline = await waitFor(() => screen.getByRole("heading", { name: "Profile ready!" }));
      expect(String(headline.props.className).split(" ")).toContain(ink);
      expect(screen.getByText("Nicely done. That was the hard part.")).toBeTruthy();
      expect(screen.getAllByRole("button")).toEqual([
        screen.getByRole("button", { name: "Continue" }),
      ]);
      checkA11y();
      await press(screen.getByRole("button", { name: "Continue" }));
      expect(router.replace).toHaveBeenCalledWith("/");
    });
  });

  describe("the seeks step and a stored answer (#542)", () => {
    const TITLE = "Whom are you looking for?";
    const CONSENT = "I consent to Kuutti ry storing whom I seek";
    const selected = checked;
    const continueDisabled = () =>
      screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled;
    const putsOfPreferences = (calls: ReturnType<typeof fakeApi>["calls"]) =>
      calls.filter((c) => c.path === "/preferences" && c.method === "PUT");
    /** A new wording: the API reads the old consent as none, and only that leaves an answer here. */
    const outdated = (server: ReturnType<typeof fakeApi>["server"], seeks: string[]) => {
      allAnswered(server);
      server.seeks = seeks;
      server.consents = server.consents.map((c) =>
        c.kind === "special_category" ? { ...c, version: "2026-01-older" } : c,
      );
    };
    const atTheStep = async () => {
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText(TITLE)).toBeTruthy());
    };

    it("starts from the stored answer when a new wording has outdated the consent", async () => {
      const { server } = fakeApi();
      outdated(server, ["woman", "non_binary"]);
      await atTheStep();
      expect(selected("Women")).toBe(true);
      expect(selected("Non-binary people")).toBe(true);
      expect(selected("Men")).toBe(false);
      expect(selected("Anyone")).toBe(false);
      // The consent is what is asked: its switch is off, and Continue waits for it.
      expect(screen.getByLabelText(CONSENT).props.accessibilityState?.checked).toBe(false);
      expect(continueDisabled()).toBe(true);
      checkA11y();
    });

    it("shows a stored answer of all three as Anyone", async () => {
      const { server } = fakeApi();
      outdated(server, ["woman", "man", "non_binary"]);
      await atTheStep();
      expect(selected("Anyone")).toBe(true);
    });

    it("starts empty with no answer stored, and Continue waits for one though the consent is there", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.seeks = null;
      await atTheStep();
      for (const name of ["Women", "Men", "Non-binary people", "Anyone"]) {
        expect(selected(name)).toBe(false);
      }
      expect(continueDisabled()).toBe(true);
    });

    it("leaves it empty when the last row is taken away: the stored answer never fills it again", async () => {
      const { server, calls } = fakeApi();
      outdated(server, ["man"]);
      await atTheStep();
      await press(row("Men"));
      expect(selected("Men")).toBe(false);
      expect(continueDisabled()).toBe(true);
      // Not when the status is read again either: the answer is still stored there.
      await act(async () => {
        focus();
        await settle();
      });
      expect(screen.getByText(TITLE)).toBeTruthy();
      expect(selected("Men")).toBe(false);
      expect(putsOfPreferences(calls)).toEqual([]);
    });

    it("disables Continue again when the last row goes, whatever the consent says", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.seeks = null;
      await atTheStep();
      await press(row("Men"));
      expect(continueDisabled()).toBe(false);
      await press(row("Men"));
      expect(continueDisabled()).toBe(true);
    });

    it("stays until Continue once the consent is given, and goes on with the stored answer", async () => {
      const { server, calls } = fakeApi();
      outdated(server, ["man"]);
      await atTheStep();
      await press(screen.getByLabelText(CONSENT));
      await flush();
      // To the API the consent alone answers the step: nothing but Continue may end it here.
      expect(screen.getByText(TITLE)).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalledWith("/");
      expect(putsOfPreferences(calls)).toEqual([]);
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
      expect(server.seeks).toEqual(["man"]);
    });

    it.each([
      ["the change, then the consent", ["rows", "consent"]],
      ["the consent, then the change", ["consent", "rows"]],
    ])("saves a change of a stored answer: %s", async (_what, order) => {
      const { server, calls } = fakeApi();
      outdated(server, ["man"]);
      await atTheStep();
      for (const step of order) {
        if (step === "consent") {
          await press(screen.getByLabelText(CONSENT));
          await flush();
        } else {
          await press(row("Women"));
          await press(row("Men"));
        }
      }
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      expect(putsOfPreferences(calls)).toEqual([
        { method: "PUT", path: "/preferences", body: { seeks: ["woman"] } },
      ]);
      expect(server.seeks).toEqual(["woman"]);
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    });

    it("keeps the step when that save is refused, and goes on once it lands", async () => {
      const { server } = fakeApi();
      outdated(server, ["man"]);
      await atTheStep();
      await press(screen.getByLabelText(CONSENT));
      await flush();
      server.seeksRefused = true;
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      expect(screen.getByText(TITLE)).toBeTruthy();
      expect(router.replace).not.toHaveBeenCalledWith("/");
      server.seeksRefused = false;
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    });

    it("saves what the rows say, not what was stored, when the step is still open at Continue", async () => {
      const { server, calls } = fakeApi();
      outdated(server, ["man"]);
      await atTheStep();
      await press(row("Women"));
      await press(row("Men"));
      // Taken back on another device meanwhile: the answer went, so the consent closes nothing.
      server.seeks = null;
      await press(screen.getByLabelText(CONSENT));
      await flush();
      expect(selected("Women")).toBe(true);
      expect(selected("Men")).toBe(false);
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      expect(putsOfPreferences(calls)).toEqual([
        { method: "PUT", path: "/preferences", body: { seeks: ["woman"] } },
      ]);
      expect(server.seeks).toEqual(["woman"]);
    });
  });

  it("says the status could not be read, and reads it again on request", async () => {
    fakeApi();
    const api = failingUntilOk("/onboarding");
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText(FAILED_TO_LOAD)).toBeTruthy());
    expect(screen.getByText("Kumpa's server had a problem. Try again in a moment.")).toBeTruthy();
    api.ok();
    await press(screen.getByRole("button", { name: "Try again" }));
    await flush();
    await waitFor(() => expect(screen.getByText(TERMS_TITLE)).toBeTruthy());
  });

  it("says a step did not go through when the API refuses it for another reason than its cadence", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    failingUntilOk("/account/gender");
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    await press(row("Woman"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() =>
      expect(screen.getByText("Something did not load. Try again.")).toBeTruthy(),
    );
    expect(screen.queryByText(/You changed this recently/)).toBeNull();
    expect(screen.getByText("How do you describe yourself?")).toBeTruthy();
  });

  describe("the home (#514, ADR-061)", () => {
    const EXPLAIN =
      "Your postal code tells Kumpa how far people are. Others see a town or your area by name, never the digits.";
    const NOT_FOUND = "We can't find that code. Choose the nearest area from the list.";
    const homeCalls = (calls: ReturnType<typeof fakeApi>["calls"]) =>
      calls.filter((c) => c.path === "/account/home");
    /** Everything but the home answered: the step is next, and in reach of what follows it. */
    const atHome = async () => {
      const api = fakeApi();
      allAnswered(api.server);
      api.server.home = null;
      api.server.photos = 0;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Where do you live?")).toBeTruthy());
      return api;
    };
    const pick = async (digits: string, name: string) => {
      await type(screen.getByLabelText("Postal code"), digits);
      await press(screen.getByRole("button", { name }));
      await flush();
    };

    it("is asked with the field its own and nothing focused", async () => {
      const { calls } = await atHome();
      asked("Where do you live?");
      expect(screen.getByText(EXPLAIN)).toBeTruthy();
      expect(screen.getByLabelText("Postal code").props.autoFocus).toBeUndefined();
      expect(screen.queryAllByRole("button")).toEqual([]);
      // No list of ponds to read: the areas are on the phone.
      expect(calls.filter((c) => c.path.includes("pond"))).toEqual([]);
      checkA11y();
    });

    it("A half-typed postal code stays on the phone", async () => {
      const { calls } = await atHome();
      const sentBefore = calls.length;
      await type(screen.getByLabelText("Postal code"), "005");
      expect(screen.getAllByRole("button").length).toBeGreaterThan(1);
      await type(screen.getByLabelText("Postal code"), "00530");
      // Nothing at all, on any path, while the digits are being typed.
      expect(calls).toHaveLength(sentBefore);
      await press(screen.getByRole("button", { name: "0 0 5 3 0, Kallio" }));
      await flush();
      expect(homeCalls(calls)).toEqual([
        { method: "PUT", path: "/account/home", body: { postalCode: "00530" } },
      ]);
    });

    it("says how many areas match to a screen reader as the digits come, with no line under the field (#581)", async () => {
      jest.replaceProperty(Platform, "OS", "android");
      const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockClear();
      await atHome();
      await type(screen.getByLabelText("Postal code"), "00530");
      expect(announce.mock.calls).toEqual([["1 area matches."]]);
      expect(screen.queryByText("1 area matches.")).toBeNull();
    });

    it("says a code that cannot become one at once, and leaves the nearest areas to choose from", async () => {
      await atHome();
      await type(screen.getByLabelText("Postal code"), "99999");
      expect(screen.getByText(NOT_FOUND)).toBeTruthy();
      expect(screen.getByRole("button", { name: "9 9 9 9 0, Nuorgam" })).toBeTruthy();
      checkA11y();
    });

    it("then shows the choice, the one the card will show filled", async () => {
      await atHome();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      // The step's own heading, the screen's one, a level above the home screen's, once.
      asked("What should your card show?");
      expect(screen.getAllByText("What should your card show?")).toHaveLength(1);
      expect(screen.getByLabelText("What should your card show?").props.accessibilityRole).toBe(
        "radiogroup",
      );
      expect(checked("Helsinki")).toBe(true);
      expect(checked("Kallio")).toBe(false);
      // The filled one says it: no line repeats it (#581).
      expect(screen.queryByText(/On your card/)).toBeNull();
      expect(screen.queryByLabelText("Postal code")).toBeNull();
      checkA11y();
    });

    it("saves the choice alone, reads it back, and Continue goes on with it kept", async () => {
      const { server, calls } = await atHome();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      await press(row("Kallio"));
      await flush();
      expect(checked("Kallio")).toBe(true);
      expect(checked("Helsinki")).toBe(false);
      expect(homeCalls(calls).at(-1)?.body).toEqual({ showArea: true });
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      expect(server.home?.showArea).toBe(true);
    });

    it("leaves the town standing when Continue is pressed without a choice", async () => {
      const { server, calls } = await atHome();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      expect(server.home?.showArea).toBe(false);
      expect(homeCalls(calls)).toHaveLength(1);
    });

    it("says the town alone where no area is kept, with nothing to choose", async () => {
      await atHome();
      await pick("83960", "8 3 9 6 0, Koli");
      // What the card says, in the question's place and role: the step still leads with a heading (#581).
      await screen.findByRole("heading", { name: "On your card: Joensuu" });
      asked("On your card: Joensuu");
      expect(screen.queryByText("What should your card show?")).toBeNull();
      expect(screen.queryByText("Your card shows the nearest town.")).toBeNull();
      expect(screen.queryAllByRole("radio")).toEqual([]);
      expect(screen.getAllByRole("button").map((b) => b.props.children)).toHaveLength(1);
      checkA11y();
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
    });

    it("asks the choice once: neither a read on focus nor a walk resumed brings it back", async () => {
      const { calls } = await atHome();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      // The status read again on focus changes nothing: the step is the screen's own.
      await act(async () => {
        focus();
        await settle(120);
      });
      expect(screen.getByText("What should your card show?")).toBeTruthy();
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      await act(async () => {
        focus();
        await settle(120);
      });
      expect(screen.getByText("Two photos of you")).toBeTruthy();
      expect(homeCalls(calls)).toHaveLength(1);
    });

    it("goes straight to the photos on a walk resumed with a home, the town standing", async () => {
      const { server } = fakeApi();
      allAnswered(server);
      server.photos = 0;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      expect(screen.queryByText("What should your card show?")).toBeNull();
      expect(screen.queryByText("Where do you live?")).toBeNull();
    });

    it("opens again for somebody active whose kept place left the list, asking nothing else", async () => {
      // Read as no home (ADR-061 §2): the status lists the step, the rest is answered.
      const { server } = fakeApi();
      allAnswered(server);
      server.home = null;
      await show(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText("Where do you live?")).toBeTruthy());
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      await press(screen.getByRole("button", { name: "Continue" }));
      await flush();
      await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/"));
    });

    it("says a code the API lacks in the same words, stays at the step, and takes another", async () => {
      const { server, calls } = await atHome();
      // On the phone's list and not on the fake API's: a build older than the API's list.
      await pick("00100", "0 0 1 0 0, Helsinki keskusta - Etu-Töölö");
      await waitFor(() => expect(screen.getByText(NOT_FOUND)).toBeTruthy());
      expect(screen.queryByText("Something did not load. Try again.")).toBeNull();
      expect(screen.getByText("Where do you live?")).toBeTruthy();
      expect(screen.getByLabelText("Postal code").props.value).toBe("00100");
      expect(server.home).toBeNull();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      expect(screen.queryByText(NOT_FOUND)).toBeNull();
      expect(homeCalls(calls)).toHaveLength(2);
    });

    it("speaks a refused save on iOS, which has no live regions, and offers the nearest areas", async () => {
      jest.replaceProperty(Platform, "OS", "ios");
      const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockClear();
      await atHome();
      await pick("00100", "0 0 1 0 0, Helsinki keskusta - Etu-Töölö");
      await waitFor(() => expect(announce).toHaveBeenCalledWith(NOT_FOUND));
      expect(screen.getAllByText(NOT_FOUND)).toHaveLength(1);
      expect(
        screen.queryByRole("button", { name: "0 0 1 0 0, Helsinki keskusta - Etu-Töölö" }),
      ).toBeNull();
      expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
    });

    it("says a save that failed for another reason as a step that did not go through", async () => {
      const { server } = await atHome();
      const api = failingUntilOk("/account/home");
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() =>
        expect(screen.getByText("Something did not load. Try again.")).toBeTruthy(),
      );
      expect(screen.getByText("Where do you live?")).toBeTruthy();
      expect(server.home).toBeNull();
      // Pressed again once the API takes it, from the digits still there.
      api.ok();
      await press(screen.getByRole("button", { name: "0 0 5 3 0, Kallio" }));
      await flush();
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
    });

    it("says a choice that failed, and keeps what the card says and the way on", async () => {
      const { server } = await atHome();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      failingUntilOk("/account/home");
      await press(row("Kallio"));
      await flush();
      await waitFor(() =>
        expect(screen.getByText("Something did not load. Try again.")).toBeTruthy(),
      );
      expect(checked("Helsinki")).toBe(true);
      expect(checked("Kallio")).toBe(false);
      expect(server.home?.showArea).toBe(false);
      await press(screen.getByRole("button", { name: "Continue" }));
      await waitFor(() => expect(screen.getByText("Two photos of you")).toBeTruthy());
      // The town stands, and what failed is not said on a step that did not fail.
      expect(screen.queryByText("Something did not load. Try again.")).toBeNull();
    });

    it("holds the rows and the way on while a save is on its way", async () => {
      const { calls } = await atHome();
      const answers = globalThis.fetch;
      let release: (() => void) | undefined;
      globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (new URL(request.url).pathname === "/account/home") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return answers(input, init);
      }) as unknown as typeof fetch;
      await type(screen.getByLabelText("Postal code"), "00530");
      const row = screen.getByRole("button", { name: "0 0 5 3 0, Kallio" });
      await press(row);
      await press(row);
      expect(row.props.accessibilityState?.disabled).toBe(true);
      await act(async () => {
        release?.();
        await settle(120);
      });
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      expect(homeCalls(calls)).toHaveLength(1);
    });

    it("keeps the rows above the keyboard: a tap on one counts with it up", async () => {
      await atHome();
      const scroll = screen.container.queryAll((node) => node.type === "RCTScrollView")[0];
      expect(scroll?.props.automaticallyAdjustKeyboardInsets).toBe(true);
      expect(scroll?.props.keyboardShouldPersistTaps).toBe("handled");
    });

    it("holds both steps at the largest text", async () => {
      jest.spyOn(PixelRatio, "getFontScale").mockReturnValue(MAX_FONT_SCALE);
      await atHome();
      await type(screen.getByLabelText("Postal code"), "0");
      expect(hasCutText(screen.toJSON() as HostNode)).toBe(false);
      checkA11y();
      await pick("00530", "0 0 5 3 0, Kallio");
      await waitFor(() => expect(screen.getByText("What should your card show?")).toBeTruthy());
      expect(hasCutText(screen.toJSON() as HostNode)).toBe(false);
      checkA11y();
    });

    it.each([
      ["fi-FI", "Missä asut?", "Postinumero", "0 0 5 3 0, Kallio", "Mitä korttisi näyttää?"],
      ["sv-FI", "Var bor du?", "Postnummer", "0 0 5 3 0, Berghäll", "Vad ska ditt kort visa?"],
    ])("speaks %s", async (tag, title, label, area, choice) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        const { server } = fakeApi();
        allAnswered(server);
        server.home = null;
        await show(<OnboardingScreen />);
        await waitFor(() => expect(screen.getByText(title)).toBeTruthy());
        await type(screen.getByLabelText(label), "00530");
        await press(screen.getByRole("button", { name: area }));
        await flush();
        await waitFor(() => expect(screen.getByText(choice)).toBeTruthy());
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    });
  });

  it("takes back a label, and a gender sought, pressed a second time", async () => {
    const { server } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("How do you describe yourself?")).toBeTruthy());
    await press(row("Non-binary"));
    await press(screen.getByRole("button", { name: "Continue" }));
    await flush();
    await waitFor(() => expect(screen.getByText("A word for it, if you like")).toBeTruthy());
    const continueDisabled = () =>
      screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled;
    await press(row("Genderfluid"));
    expect(continueDisabled()).toBe(false);
    await press(row("Genderfluid"));
    expect(continueDisabled()).toBe(true);
    await press(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    await press(row("Women"));
    expect(checked("Women")).toBe(true);
    await press(row("Women"));
    expect(checked("Women")).toBe(false);
  });

  it("asks for an app update instead of recording the sensitive-answers consent for a newer wording", async () => {
    const { server, calls } = fakeApi();
    server.consents.push(consented("terms"), consented("privacy"));
    server.profile = { displayName: "Noa", bio: null, bioPreset: null, fields: {}, prompts: [] };
    server.gender = "woman";
    const answers = globalThis.fetch;
    globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
      const response = await answers(input, init);
      const request = input instanceof Request ? input : new Request(input, init);
      if (new URL(request.url).pathname !== "/onboarding") return response;
      const body = await response.json();
      return json({
        ...body,
        currentVersions: { ...body.currentVersions, special_category: "2027-01" },
      });
    }) as unknown as typeof fetch;
    await show(<OnboardingScreen />);
    await waitFor(() => expect(screen.getByText("Whom are you looking for?")).toBeTruthy());
    expect(screen.getByText(/Update the app to continue/)).toBeTruthy();
    expect(screen.queryByLabelText("I consent to Kuutti ry storing whom I seek")).toBeNull();
    await press(row("Women"));
    expect(
      screen.getByRole("button", { name: "Continue" }).props.accessibilityState?.disabled,
    ).toBe(true);
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});
