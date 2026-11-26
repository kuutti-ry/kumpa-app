import { act } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { clearSession, saveSession } from "@/lib/session";
import { renderWithTheme } from "@/test/render";
import { LaterOrderAtSignOut } from "./LaterOrderAtSignOut";

// The Later list's order goes with the person (ADR-064 §6): kept while the
// phone is signed in, forgotten on a sign-out and at a start that finds the
// phone signed out, and not forgotten again by the sign-in after it.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const KEY = "kuutti.preference.laterOrder";
const ORDER = JSON.stringify({
  order: ["7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a02", "7a1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a01"],
  placing: null,
});

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const signIn = () =>
  saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

beforeEach(async () => {
  await clearSession();
  store.clear();
});

describe("the Later list's order at sign-out", () => {
  it("keeps the order while the phone is signed in, from the start on", async () => {
    await signIn();
    store.set(KEY, ORDER);
    await renderWithTheme(<LaterOrderAtSignOut />);
    await settle();
    expect(store.get(KEY)).toBe(ORDER);
  });

  it("forgets the order on a sign-out, and not again on the sign-in after it", async () => {
    await signIn();
    store.set(KEY, ORDER);
    await renderWithTheme(<LaterOrderAtSignOut />);
    await settle();

    await act(async () => {
      await clearSession();
    });
    await settle();
    expect(store.has(KEY)).toBe(false);

    // The next person to sign in here puts their own list in order.
    await act(async () => {
      await signIn();
    });
    store.set(KEY, ORDER);
    await settle();
    expect(store.get(KEY)).toBe(ORDER);
  });

  it("forgets an order left behind at a start that finds the phone signed out", async () => {
    store.set(KEY, ORDER);
    await renderWithTheme(<LaterOrderAtSignOut />);
    await settle();
    expect(store.has(KEY)).toBe(false);
  });
});
