import { act, renderHook, waitFor } from "@testing-library/react-native";
import { ApiError } from "@/lib/api";
import { saveSession } from "@/lib/session";
import { useOnboarding } from "./useOnboarding";

// The onboarding status as the screen uses it (#46, #146): read on focus and
// after every step; a step that fails leaves the status as it was and names
// the API's refusal, or "unknown" for anything else.

const { __focus: focus } = jest.requireMock("expo-router") as { __focus: () => void };
const token = (seed: string) => (seed + "x".repeat(43)).slice(0, 43);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const status = (missing: string[]) => ({
  state: missing.length ? "registered" : "active",
  age: 36,
  gender: "woman",
  home: null,
  preferences: { seeks: ["man"], ageWindow: { min: 30, max: 40 } },
  consents: { terms: "v1", privacy: "v1", specialCategory: "s1" },
  currentVersions: { terms: "v1", privacy: "v1", special_category: "s1" },
  nextChange: { gender: null },
  missing,
  complete: missing.length === 0,
});

let missing: string[];
let reads: number;
let readsFail: boolean;
beforeEach(async () => {
  missing = ["photos"];
  reads = 0;
  readsFail = false;
  globalThis.fetch = jest.fn(async () => {
    reads += 1;
    return readsFail
      ? json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500)
      : json(status(missing));
  }) as unknown as typeof fetch;
  await saveSession({
    sessionId: "6f1c1c4e-9a8e-4a0b-9c3a-0c8d1e2f3a4b",
    accessToken: token("access"),
    accessExpiresAt: "2030-01-01T00:15:00.000Z",
    refreshToken: `${token("family")}.${token("refresh")}`,
    refreshExpiresAt: "2030-04-01T00:00:00.000Z",
  });
});

async function ready() {
  const view = await renderHook(() => useOnboarding());
  await waitFor(() => expect(view.result.current.state.status).not.toBe("loading"));
  return view;
}

describe("useOnboarding", () => {
  it("reads the status, and again when the screen gets the focus back", async () => {
    const { result } = await ready();
    expect(result.current.state).toMatchObject({
      status: "ready",
      onboarding: { missing: ["photos"] },
    });
    expect(result.current).toMatchObject({ busy: false, failed: false, failedCode: null });
    missing = [];
    await act(async () => focus());
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ onboarding: { complete: true } }),
    );
    expect(reads).toBe(2);
  });

  it("is an error when the status cannot be read", async () => {
    readsFail = true;
    const { result } = await ready();
    expect(result.current.state).toMatchObject({ status: "error" });
    // The reason stays with the state, for the screen to say it.
    expect((result.current.state as { error?: unknown }).error).toBeInstanceOf(Error);
  });

  it("runs a step, is busy meanwhile, then reads the status again", async () => {
    const { result } = await ready();
    let finish: (() => void) | undefined;
    let running: Promise<unknown> | undefined;
    await act(async () => {
      running = result.current.step(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    });
    expect(result.current.busy).toBe(true);
    missing = [];
    await act(async () => {
      finish?.();
      await running;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.failed).toBe(false);
    expect(result.current.state).toMatchObject({ onboarding: { complete: true } });
  });

  it("reads the status again when an answer is refused for its consent, which may be gone", async () => {
    const { result } = await ready();
    missing = ["seeks"];
    await act(async () =>
      result.current.step(async () => {
        throw new ApiError("preferences answered 403", 403, "consent_required");
      }),
    );
    expect(result.current).toMatchObject({ failed: true, failedCode: "consent_required" });
    expect(result.current.state).toMatchObject({ onboarding: { missing: ["seeks"] } });
    expect(reads).toBe(2);
  });

  it("names the API's refusal of a step and keeps the status as it was", async () => {
    const { result } = await ready();
    await act(async () =>
      result.current.step(async () => {
        throw new ApiError("gender answered 429", 429, "gender_change_too_soon");
      }),
    );
    expect(result.current).toMatchObject({ failed: true, failedCode: "gender_change_too_soon" });
    expect(result.current.state).toMatchObject({ onboarding: { missing: ["photos"] } });
    expect(reads).toBe(1);
    expect(reads).toBe(1);
  });

  it("says unknown for a refusal without a code and for any other failure", async () => {
    const { result } = await ready();
    await act(async () =>
      result.current.step(async () => {
        throw new ApiError("gender answered 502", 502);
      }),
    );
    expect(result.current.failedCode).toBe("unknown");
    await act(async () =>
      result.current.step(async () => {
        throw new TypeError("Network request failed");
      }),
    );
    expect(result.current.failedCode).toBe("unknown");
    // The next step starts with a clean slate.
    await act(async () => result.current.step(async () => undefined));
    expect(result.current).toMatchObject({ failed: false, failedCode: null });
  });

  it("lets the later of two reads speak, whichever answers first", async () => {
    // Each read waits until the test answers it.
    const waiting: Array<(answer: Response) => void> = [];
    globalThis.fetch = jest.fn(
      () => new Promise<Response>((answer) => waiting.push(answer)),
    ) as unknown as typeof fetch;
    const failure = () =>
      json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500);
    const { result } = await renderHook(() => useOnboarding());
    await waitFor(() => expect(waiting).toHaveLength(1));
    await act(async () => focus());
    await waitFor(() => expect(waiting).toHaveLength(2));
    await act(async () => waiting[1]?.(json(status([]))));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ onboarding: { complete: true } }),
    );
    // The earlier read answers last, with a step the later one found done: it is not shown.
    await act(async () => waiting[0]?.(json(status(["photos"]))));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(result.current.state).toMatchObject({ onboarding: { complete: true } });
    // Nor is an earlier read's failure, which would put the could-not-load screen over a step.
    await act(async () => focus());
    await act(async () => focus());
    await waitFor(() => expect(waiting).toHaveLength(4));
    await act(async () => waiting[3]?.(json(status([]))));
    await act(async () => waiting[2]?.(failure()));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(result.current.state).toMatchObject({
      status: "ready",
      onboarding: { complete: true },
    });
    // A read that is the latest still says it failed.
    await act(async () => focus());
    await waitFor(() => expect(waiting).toHaveLength(5));
    await act(async () => waiting[4]?.(failure()));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });

  it("shows an earlier read's answer while a later one is still out", async () => {
    const waiting: Array<(answer: Response) => void> = [];
    globalThis.fetch = jest.fn(
      () => new Promise<Response>((answer) => waiting.push(answer)),
    ) as unknown as typeof fetch;
    const { result } = await renderHook(() => useOnboarding());
    await waitFor(() => expect(waiting).toHaveLength(1));
    await act(async () => focus());
    await waitFor(() => expect(waiting).toHaveLength(2));
    // The later read stalls: the earlier one's answer is not held back for it.
    await act(async () => waiting[0]?.(json(status(["photos"]))));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({
        status: "ready",
        onboarding: { missing: ["photos"] },
      }),
    );
    // When the later one answers after all, it is the one shown.
    await act(async () => waiting[1]?.(json(status([]))));
    await waitFor(() =>
      expect(result.current.state).toMatchObject({ onboarding: { complete: true } }),
    );
  });
});
