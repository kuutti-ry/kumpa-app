import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { SightProvider, useInSight, useSightScroll } from "./InSight";

// A view comes into sight once any part of it is inside the window, and stays
// so; a scroll tells what it holds to look again each time it moves, and a
// view in sight or gone stops listening (ADR-008: a card's photo is asked for
// only once it is in sight, never before).

/** A host view that says where it lies, wherever the test puts it. */
const viewAt = (y: number, height = 400) => {
  const where = { y, height };
  const measureInWindow = jest.fn(
    (callback: (x: number, y: number, w: number, h: number) => void) =>
      callback(0, where.y, 300, where.height),
  );
  // The same object: moving the view moves what it measures.
  return Object.assign(where, { measureInWindow });
};
const moved = {} as NativeSyntheticEvent<NativeScrollEvent>;
const windowHeight = () => Dimensions.get("window").height;

describe("useInSight", () => {
  it.each([
    ["at the top of the window", true, 0, 400],
    ["half above the window's top", true, -200, 400],
    ["reaching one point into the window from below", true, () => windowHeight() - 1, 400],
    ["just under the window", false, () => windowHeight(), 400],
    ["far under the window", false, () => windowHeight() * 3, 400],
    ["just above the window", false, -400, 400],
    ["with no height yet, inside the window", false, 100, 0],
  ])("on its layout, a view %s is in sight: %s", async (_where, seen, y, height) => {
    const { result } = await renderHook(() => useInSight());
    const view = viewAt(typeof y === "function" ? y() : y, height);
    expect(result.current.inSight).toBe(false);
    await act(async () => {
      result.current.ref(view);
      result.current.onLayout();
    });
    expect(result.current.inSight).toBe(seen);
  });

  it("looks at its layout alone outside a scroll that tells, and never measures without a view", async () => {
    const { result } = await renderHook(() => useInSight());
    await act(async () => result.current.onLayout());
    expect(result.current.inSight).toBe(false);
    const view = viewAt(windowHeight() * 2);
    await act(async () => {
      result.current.ref(view);
      result.current.onLayout();
    });
    view.y = 10;
    // Nothing tells it the view moved: it stays out of sight until it is laid out again.
    expect(result.current.inSight).toBe(false);
    await act(async () => result.current.onLayout());
    expect(result.current.inSight).toBe(true);
  });

  describe("inside a scroll that tells", () => {
    const inScroll = async () => {
      const { result: scroll } = await renderHook(() => useSightScroll());
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SightProvider value={scroll.current.sight}>{children}</SightProvider>
      );
      const { result } = await renderHook(() => useInSight(), { wrapper });
      return { scroll, result };
    };

    it("comes into sight when the scroll brings it there, and stays, listening no more", async () => {
      const { scroll, result } = await inScroll();
      expect(scroll.current.scrollEventThrottle).toBe(100);
      const view = viewAt(windowHeight() + 100);
      await act(async () => {
        result.current.ref(view);
        result.current.onLayout();
      });
      expect(result.current.inSight).toBe(false);
      // A scroll that has not reached it yet.
      view.y = windowHeight() + 20;
      await act(async () => scroll.current.onScroll(moved));
      expect(result.current.inSight).toBe(false);
      view.y = windowHeight() - 50;
      await act(async () => scroll.current.onScroll(moved));
      expect(result.current.inSight).toBe(true);
      // Scrolled past and back: it stays in sight, and nobody measures it again.
      const measured = view.measureInWindow.mock.calls.length;
      view.y = -2000;
      await act(async () => {
        scroll.current.onScroll(moved);
        scroll.current.onScroll(moved);
      });
      expect(result.current.inSight).toBe(true);
      expect(view.measureInWindow).toHaveBeenCalledTimes(measured);
    });

    it("stops listening once it is gone", async () => {
      const { result: scroll } = await renderHook(() => useSightScroll());
      const wrapper = ({ children }: { children: ReactNode }) => (
        <SightProvider value={scroll.current.sight}>{children}</SightProvider>
      );
      const { result, unmount } = await renderHook(() => useInSight(), { wrapper });
      const view = viewAt(windowHeight() * 2);
      await act(async () => result.current.ref(view));
      await act(async () => scroll.current.onScroll(moved));
      expect(view.measureInWindow).toHaveBeenCalledTimes(1);
      await unmount();
      await act(async () => scroll.current.onScroll(moved));
      expect(view.measureInWindow).toHaveBeenCalledTimes(1);
    });
  });
});
