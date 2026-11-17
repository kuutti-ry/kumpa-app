import { act, fireEvent, screen } from "@testing-library/react-native";
import { getInstallReferrerAsync } from "expo-application";
import { useLocales } from "expo-localization";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, Platform } from "react-native";
import { clearSession, saveSession } from "@/lib/session";
import { noProblems } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { dropHeldInvitationCode, heldInvitationCode, takeInvitationLink } from "./held-code";
import { RedeemInvitation } from "./RedeemInvitation";

// A code from a friend (#107, ADR-044 §6): Use the code dimmed until what is
// typed reads as a code the way the API reads it; the code sent as typed;
// every refusal in its own words, said in a live region and aloud on iOS; a
// code that works said the same way and handed back to the caller. A code
// that came by a friend's link or with the install (#184) is in the field
// already, sent only at the press, and gone once it is used or no use.

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (code: string, status: number) =>
  json({ error: { code, message: "x", requestId: "r" } }, status);
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

const DONE = "The code is in.";
const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const HELD = "kuutti.preference.invitationCode";
const referrer = jest.mocked(getInstallReferrerAsync);
const field = () => screen.getByLabelText("Invitation code");
const button = () => screen.getByRole("button", { name: "Use the code" });
const dimmed = () => button().props.accessibilityState?.disabled === true;
const type = (text: string) => act(async () => fireEvent.changeText(field(), text));
const send = async () => {
  await act(async () => fireEvent.press(button()));
  await settle();
};

type Sent = { path: string; body: unknown };
function api(answer: () => Response): Sent[] {
  const seen: Sent[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    seen.push({ path: new URL(request.url).pathname, body: JSON.parse(await request.text()) });
    return answer();
  }) as unknown as typeof fetch;
  return seen;
}

beforeEach(async () => {
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
  (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
  // No code held, and Play not asked yet.
  await dropHeldInvitationCode();
  store.delete("kuutti.preference.referrerRead");
  referrer.mockClear();
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

describe("RedeemInvitation", () => {
  it.each([
    ["nothing typed", "", true],
    ["nine characters", "ABCDE-FGHJ", true],
    ["a U, which no code has", "ABCDE-FGHJU", true],
    ["eleven characters", "ABCDE-FGHJKM", true],
    ["a code in its two groups", "ABCDE-FGHJK", false],
    ["lower case with spaces, O and I and L read as Crockford reads them", " abcde ohilk ", false],
  ])("is dimmed for %s: %j", async (_what, typed, expected) => {
    api(() => new Response(null, { status: 204 }));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await type(typed);
    expect(dimmed()).toBe(expected);
  });

  it("sends the code as typed and hands a code that works back, saying so aloud on iOS", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const seen = api(() => new Response(null, { status: 204 }));
    const onRedeemed = jest.fn();
    await renderWithTheme(<RedeemInvitation onRedeemed={onRedeemed} />);
    noProblems();
    await type("abcde-fghjk");
    await send();
    expect(seen).toEqual([{ path: "/invitations/redeem", body: { code: "abcde-fghjk" } }]);
    expect(onRedeemed).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(DONE);
    // No second try while the caller takes the form away.
    expect(dimmed()).toBe(true);
  });

  it("leaves the announcement of a code that works to TalkBack's reading of the caller's region on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    api(() => new Response(null, { status: 204 }));
    const onRedeemed = jest.fn();
    await renderWithTheme(<RedeemInvitation onRedeemed={onRedeemed} />);
    await type("ABCDE-FGHJK");
    await send();
    expect(onRedeemed).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
  });

  it.each([
    ["invitation_unknown", 404, "That code does not work. Check it and try again."],
    [
      "invitation_not_for_you",
      409,
      "This account cannot use an invitation code. A code is for someone new, before their profile is complete, and works once.",
    ],
    [
      "invitation_tries_exceeded",
      429,
      "That is enough for today. You can try again after midnight.",
    ],
    ["internal_error", 500, "That did not go through. Try again."],
  ])(
    "says the refusal %s in words, aloud on iOS, and keeps the field",
    async (code, status, words) => {
      jest.replaceProperty(Platform, "OS", "ios");
      api(() => refusal(code, status));
      const onRedeemed = jest.fn();
      await renderWithTheme(<RedeemInvitation onRedeemed={onRedeemed} />);
      await type("ABCDE-FGHJK");
      await send();
      expect(screen.getByText(words).props.accessibilityLiveRegion).toBe("assertive");
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(words);
      expect(onRedeemed).not.toHaveBeenCalled();
      expect(field().props.value).toBe("ABCDE-FGHJK");
      expect(dimmed()).toBe(false);
    },
  );

  it("says a refusal without a word aloud on Android, where the live region does, and takes it away as the person types", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    api(() => refusal("invitation_unknown", 404));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await type("ABCDE-FGHJK");
    await send();
    const words = "That code does not work. Check it and try again.";
    expect(screen.getByText(words)).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    await type("ABCDE-FGHJM");
    expect(screen.queryByText(words)).toBeNull();
  });

  it("says a code could not be checked when no answer came", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new TypeError("Network request failed");
    }) as unknown as typeof fetch;
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await type("ABCDE-FGHJK");
    await send();
    expect(screen.getByText("That did not go through. Try again.")).toBeTruthy();
  });

  it("is dimmed while a code is on its way", async () => {
    let answer: (response: Response) => void = () => undefined;
    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    ) as unknown as typeof fetch;
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await type("ABCDE-FGHJK");
    await act(async () => fireEvent.press(button()));
    expect(dimmed()).toBe(true);
    await act(async () => answer(refusal("invitation_unknown", 404)));
    await settle();
    expect(dimmed()).toBe(false);
  });
});

describe("a code that came by itself (#184)", () => {
  const LINK = "https://api.kumpa.fi/i/abcdefghjk";

  it("is in the field in its two groups, sent only at the press, and gone once it worked", async () => {
    takeInvitationLink(LINK);
    const seen = api(() => new Response(null, { status: 204 }));
    const onRedeemed = jest.fn();
    await renderWithTheme(<RedeemInvitation onRedeemed={onRedeemed} />);
    await settle();
    expect(field().props.value).toBe("ABCDE-FGHJK");
    expect(dimmed()).toBe(false);
    noProblems();
    // A link is somebody else's words: nothing went anywhere, and nothing was said.
    expect(seen).toEqual([]);
    expect(onRedeemed).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).not.toHaveBeenCalled();
    expect(store.get(HELD)).toBe("ABCDEFGHJK");
    await send();
    expect(seen).toEqual([{ path: "/invitations/redeem", body: { code: "ABCDE-FGHJK" } }]);
    expect(onRedeemed).toHaveBeenCalledTimes(1);
    expect(store.has(HELD)).toBe(false);
    expect(await heldInvitationCode()).toBeNull();
  });

  it("leaves the field empty when no code came", async () => {
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    expect(field().props.value).toBe("");
    expect(dimmed()).toBe(true);
  });

  it("is the code the install came with on Android, where Play is asked once", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    referrer.mockResolvedValueOnce("ABCDEFGHJK");
    const seen = api(() => new Response(null, { status: 204 }));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    expect(field().props.value).toBe("ABCDE-FGHJK");
    expect(referrer).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([]);
  });

  it("leaves alone what the person typed before it arrived, and keeps it for the next time", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    let answer: (said: string) => void = () => undefined;
    referrer.mockReturnValueOnce(new Promise<string>((resolve) => (answer = resolve)));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await type("ZYXWV-98765");
    await act(async () => answer("ABCDEFGHJK"));
    await settle();
    expect(field().props.value).toBe("ZYXWV-98765");
    expect(store.get(HELD)).toBe("ABCDEFGHJK");
  });

  it.each([
    ["invitation_unknown", 404],
    ["invitation_not_for_you", 409],
  ])("is not offered again once the API says %s of it", async (code, status) => {
    takeInvitationLink(LINK);
    api(() => refusal(code, status));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    await send();
    // The person still sees what was refused.
    expect(field().props.value).toBe("ABCDE-FGHJK");
    expect(store.has(HELD)).toBe(false);
    expect(await heldInvitationCode()).toBeNull();
  });

  it.each([
    ["the day's tries are spent", () => refusal("invitation_tries_exceeded", 429)],
    ["the API failed", () => refusal("internal_error", 500)],
    [
      "no answer came",
      () => {
        throw new TypeError("Network request failed");
      },
    ],
  ])("is kept when %s, which says nothing of the code", async (_what, answer) => {
    takeInvitationLink(LINK);
    api(answer);
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    await send();
    expect(store.get(HELD)).toBe("ABCDEFGHJK");
    expect(await heldInvitationCode()).toBe("ABCDEFGHJK");
  });

  it("is kept when another code, typed over it, is refused", async () => {
    takeInvitationLink(LINK);
    const seen = api(() => refusal("invitation_unknown", 404));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    await type("ZYXWV-98765");
    await send();
    expect(seen).toEqual([{ path: "/invitations/redeem", body: { code: "ZYXWV-98765" } }]);
    expect(store.get(HELD)).toBe("ABCDEFGHJK");
  });

  it("goes when another code, typed over it, worked: a person takes one invitation", async () => {
    takeInvitationLink(LINK);
    api(() => new Response(null, { status: 204 }));
    await renderWithTheme(<RedeemInvitation onRedeemed={jest.fn()} />);
    await settle();
    await type("ZYXWV-98765");
    await send();
    expect(store.has(HELD)).toBe(false);
    expect(await heldInvitationCode()).toBeNull();
  });
});
