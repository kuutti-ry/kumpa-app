import { fireEvent, screen } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Dimensions, ScrollView, View } from "react-native";
import { SightProvider, useSightScroll } from "@/components/InSight";

/**
 * Where a card's photos lie on the screen, which jest's views never say (the
 * preset's `measureInWindow` never calls back), so that the real
 * `@/components/InSight` decides which photo is in sight: the photos stacked a
 * window's height each, the one the window has reached at its top, those
 * before it above and the rest below. `placePhotos()` in a `beforeEach`, then
 * `layOut()` once a card is drawn, as a phone lays its views out, and
 * `scrollTo(n)` to bring photo n to the window's top and tell the scroll
 * around the card, the screen's own or `InScroll`'s.
 */

let top = 0;
const photos = () => screen.queryAllByTestId(/^card-photo-/);
type Measured = (x: number, y: number, width: number, height: number) => void;

export function placePhotos() {
  top = 0;
  const host = View.prototype as unknown as { measureInWindow: (callback: Measured) => void };
  jest.spyOn(host, "measureInWindow").mockImplementation(function (
    this: { props: { testID?: unknown } },
    callback: Measured,
  ) {
    const height = Dimensions.get("window").height;
    const at = photos().findIndex((photo) => photo.props.testID === this.props.testID);
    callback(0, (at - top) * height, 300, height);
  });
}

/** Every photo of the card laid out where it lies. */
export async function layOut() {
  for (const photo of photos()) {
    await fireEvent(photo, "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 400 } },
    });
  }
}

/** Photo n (from 1) at the window's top, and the scroll around the card told that it moved. */
export async function scrollTo(n: number) {
  top = n - 1;
  const [first] = photos();
  if (first) {
    await fireEvent.scroll(first, { nativeEvent: { contentOffset: { x: 0, y: top * 600 } } });
  }
}

/** A scroll that tells the card when it moves, as the queue's and the preview's do. */
export function InScroll({ children }: { children: ReactNode }) {
  const scroll = useSightScroll();
  return (
    <ScrollView onScroll={scroll.onScroll} scrollEventThrottle={scroll.scrollEventThrottle}>
      <SightProvider value={scroll.sight}>{children}</SightProvider>
    </ScrollView>
  );
}
