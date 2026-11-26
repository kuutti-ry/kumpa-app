import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  useWindowDimensions,
} from "react-native";

/** What can say where it lies on the screen: a host view. */
type Measurable = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

type Sight = { subscribe: (look: () => void) => () => void };

const SightContext = createContext<Sight | null>(null);

/** Around a scroll's content: what is in it looks again each time the scroll moves. */
export const SightProvider = SightContext.Provider;

/**
 * A scroll that tells what it holds when it moves, so that a photo further
 * down a card is asked for only once it comes into sight, never before
 * (rules/mobile.md Images: prefetch counts as exposure; ADR-008). Its
 * `onScroll` and `scrollEventThrottle` go on the ScrollView, and its `sight`
 * to a `SightProvider` around the content.
 */
export function useSightScroll() {
  const looks = useRef(new Set<() => void>());
  const sight = useMemo<Sight>(
    () => ({
      subscribe: (look) => {
        looks.current.add(look);
        return () => looks.current.delete(look);
      },
    }),
    [],
  );
  const onScroll = useCallback((_event: NativeSyntheticEvent<NativeScrollEvent>) => {
    for (const look of looks.current) look();
  }, []);
  return { sight, onScroll, scrollEventThrottle: 100 };
}

/**
 * Whether a view has come into sight, any part of it inside the window: once
 * it has, it stays so, since what was shown stays mounted (#513). It looks
 * when the view is laid out and, until it is in sight, each time the scroll
 * around it moves; outside such a scroll it looks at its layout alone, so only
 * what the screen shows first comes into sight. A view with no height has no
 * part to show.
 */
export function useInSight() {
  const sight = useContext(SightContext);
  const { height: windowHeight } = useWindowDimensions();
  const [inSight, setInSight] = useState(false);
  const view = useRef<Measurable | null>(null);
  const look = useCallback(() => {
    view.current?.measureInWindow((_x, y, _width, height) => {
      if (height > 0 && y < windowHeight && y + height > 0) setInSight(true);
    });
  }, [windowHeight]);
  // Listening ends once it is in sight, and when the view goes.
  useEffect(() => (sight && !inSight ? sight.subscribe(look) : undefined), [sight, inSight, look]);
  const ref = useCallback((node: Measurable | null) => {
    view.current = node;
  }, []);
  return { ref, onLayout: look, inSight };
}
