import { act, renderHook, waitFor } from "@testing-library/react-native";
import { usePondCounter } from "./usePondCounter";

// What the counter says of everybody on Kuutti (#54, #607): its figures, no
// number below the threshold, a failure with a retry, and the answer of a read
// that a retry replaced is dropped.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const COUNTER = { k: 10, day: "2026-10-05", finished: 150, seeks: null };
const BELOW = { k: 10, day: null, finished: null, seeks: null };

function pendingReads() {
  const waiting: Array<(response: Response) => void> = [];
  globalThis.fetch = jest.fn(
    () =>
      new Promise<Response>((resolve) => {
        waiting.push(resolve);
      }),
  ) as unknown as typeof fetch;
  return waiting;
}

describe("usePondCounter", () => {
  it("gives the counter's figures", async () => {
    globalThis.fetch = jest.fn(async () => json(COUNTER)) as unknown as typeof fetch;
    const { result } = await renderHook(() => usePondCounter());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ status: "ready", figures: COUNTER });
  });

  it("has no number below the threshold", async () => {
    globalThis.fetch = jest.fn(async () => json(BELOW)) as unknown as typeof fetch;
    const { result } = await renderHook(() => usePondCounter());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current).toMatchObject({ status: "ready", figures: BELOW });
  });

  it("fails on a list of ponds, the answer as it was before the pond's row went", async () => {
    const listed = { k: 10, ponds: [{ ...COUNTER, pond: { slug: "suomi" } }] };
    globalThis.fetch = jest.fn(async () => json(listed)) as unknown as typeof fetch;
    const { result } = await renderHook(() => usePondCounter());
    await waitFor(() => expect(result.current.status).toBe("failed"));
    expect(result.current).toMatchObject({ status: "failed", error: { name: "ZodError" } });
  });

  it("fails, and loads again on a retry", async () => {
    const waiting = pendingReads();
    const { result } = await renderHook(() => usePondCounter());
    await act(async () => waiting.shift()?.(json({ error: { code: "internal_error" } }, 503)));
    expect(result.current.status).toBe("failed");
    await act(async () => result.current.retry());
    expect(result.current.status).toBe("loading");
    await act(async () => waiting.shift()?.(json(COUNTER)));
    expect(result.current).toMatchObject({ status: "ready", figures: COUNTER });
  });

  it("drops the answer, or the failure, of a read that a retry replaced", async () => {
    const waiting = pendingReads();
    const { result } = await renderHook(() => usePondCounter());
    await act(async () => result.current.retry());
    const [first, second] = waiting;
    await act(async () => first?.(json(COUNTER)));
    expect(result.current.status).toBe("loading");
    await act(async () => second?.(json(COUNTER)));
    expect(result.current).toMatchObject({ figures: COUNTER });
    await act(async () => result.current.retry());
    await act(async () => result.current.retry());
    const [, , third, fourth] = waiting;
    await act(async () => third?.(json({ error: { code: "internal_error" } }, 503)));
    expect(result.current.status).toBe("loading");
    await act(async () => fourth?.(json(COUNTER)));
    expect(result.current).toMatchObject({ status: "ready", figures: COUNTER });
  });
});
