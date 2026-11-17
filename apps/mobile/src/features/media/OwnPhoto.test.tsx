import { act, screen } from "@testing-library/react-native";
import { saveSession } from "@/lib/session";
import { renderWithTheme, underProviders } from "@/test/render";
import { OwnPhoto } from "./OwnPhoto";

// The reader's own first photo in the designers' tries: the first approved one,
// a photo still in review only where `inReview` lets it stand in, and nothing
// at all while it loads, where there is none, and where the read failed.

const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

type State = "approved" | "pending" | "queued" | "rejected";
const photo = (n: number, state: State) => ({
  id: `0b1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a${n.toString(16).padStart(2, "0")}`,
  blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
  width: 1600,
  height: 1200,
  state,
  rejectionReason: state === "rejected" ? "no_person" : null,
  appealable: false,
  position: n - 1,
  createdAt: "2026-09-25T12:00:00.000Z",
  caption: null,
});

/** Answers the list with `photos` (or the status alone), and every signed URL. */
function answering(photos: ReturnType<typeof photo>[] | number) {
  const seen: string[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = input instanceof Request ? input : new Request(input);
    const path = new URL(request.url).pathname;
    seen.push(path);
    if (path.endsWith("/photos")) {
      return typeof photos === "number"
        ? json({ error: "internal" }, photos)
        : json({ photos, maxPhotos: 3, tips: [] });
    }
    return json({
      url: `https://media.test/media/k/card.webp?Signature=${seen.length}`,
      variant: "card",
      expiresAt: "2030-01-01T00:15:00.000Z",
    });
  }) as unknown as typeof fetch;
  return seen;
}

const shown = () => screen.queryByLabelText("You");
const keyOf = () =>
  (screen.getByLabelText("You").props.source as Array<{ cacheKey: string }>)[0]?.cacheKey;

beforeEach(async () => {
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

describe("OwnPhoto", () => {
  it("shows the first approved photo, before any still in review", async () => {
    answering([photo(1, "pending"), photo(2, "approved"), photo(3, "approved")]);
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    expect(keyOf()).toBe(`${photo(2, "approved").id}/card`);
  });

  it("shows nothing for a photo in review unless one may stand in", async () => {
    answering([photo(1, "pending"), photo(2, "queued")]);
    await renderWithTheme(<OwnPhoto label="You" />);
    await settle();
    expect(shown()).toBeNull();
  });

  it.each([
    ["not yet moderated", "pending"],
    ["waiting for a moderator", "queued"],
  ] as const)("lets a photo %s stand in at the end of making a profile", async (_, state) => {
    answering([photo(1, "rejected"), photo(2, state)]);
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    expect(keyOf()).toBe(`${photo(2, state).id}/card`);
  });

  it("never shows a rejected photo", async () => {
    answering([photo(1, "rejected")]);
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    expect(shown()).toBeNull();
  });

  it("shows nothing where there is no photo", async () => {
    answering([]);
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    expect(shown()).toBeNull();
  });

  it("shows nothing, and says nothing, where the read failed", async () => {
    const seen = answering(500);
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    expect(seen).toEqual(["/photos"]);
    expect(shown()).toBeNull();
    expect(screen.queryAllByText(/./, { includeHiddenElements: true })).toHaveLength(0);
  });

  it("keeps to the latest question: a late answer to an earlier one shows nothing", async () => {
    const answers: Array<(response: Response) => void> = [];
    globalThis.fetch = jest.fn(
      () =>
        new Promise<Response>((resolve) => {
          answers.push(resolve);
        }),
    ) as unknown as typeof fetch;
    const only = { photos: [photo(1, "pending")], maxPhotos: 3, tips: [] };
    await renderWithTheme(<OwnPhoto label="You" inReview />);
    await settle();
    await screen.rerender(underProviders(<OwnPhoto label="You" />));
    await settle();
    expect(answers).toHaveLength(2);
    answers[0]?.(json(only));
    await settle();
    expect(shown()).toBeNull();
    answers[1]?.(json(only));
    await settle();
    expect(shown()).toBeNull();
  });
});
