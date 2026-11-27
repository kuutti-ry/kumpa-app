import type { LucideIcon } from "lucide-react-native";
import type { ReactNode, Ref } from "react";
import { Platform, type Text as RNText, View } from "react-native";
import { Circle, Path } from "react-native-svg";
import { drawn, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useHardShadow } from "@/theme/shadow";

// The loud pieces of the designers' try (outside production, the tech screen's
// neubrutalism), after Sini's screens of 15/11/2026: a headline in a tilted
// slab, sparks, blobs, starbursts and a face that winks. The pill styles'
// moments draw the sparks too, Kumpa's, which every phone starts in, among
// them. Our own drawings, each layer in one token colour, so they follow every
// set of tokens.css; all of it decorative, hidden from screen readers by Icon.

/** Takes a subtree out of what a screen reader walks: the words beside it say it all. */
export const UNSPOKEN = Platform.select({
  web: { "aria-hidden": true },
  default: {
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants" as const,
  },
});

/** The ink of the try's loud pieces: thicker than a control's 2 points. */
export const INK = 3;
/** Their hard shadow, deeper than a dialog's. */
export const LOUD_SHADOW = 6;

const filled = (name: string, d: string) =>
  drawn(name, <Path d={d} fill="currentColor" stroke="none" />);
const outlined = (name: string, d: string) => drawn(name, <Path d={d} />);

const BLOB =
  "M4.6 9.4C3.2 5.6 6.9 2.1 11.4 2.6c3.5.4 5.3-.7 8.1 1.5 2.9 2.3 3.6 6.4 2 9.7-1.3 2.7-.6 4.9-3.4 6.9-3 2.1-7.2 1.6-10.3-.2-3.2-1.8-5.8-3.9-5.4-6.9.2-1.6 2.8-2.5 2.2-4.2Z";

/** A star of `spikes` points on the 24-point grid, a point straight up. */
function star(spikes: number, inner: number, outer = 11.2): string {
  const points = Array.from({ length: spikes * 2 }, (_, at) => {
    const radius = at % 2 ? inner : outer;
    const angle = (Math.PI * at) / spikes - Math.PI / 2;
    return `${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return `M${points.join("L")}Z`;
}
const BURST = star(14, 8.4);

const BlobShape = filled("Blob", BLOB);
const BurstFill = filled("BurstFill", BURST);
const BurstLine = outlined("BurstLine", BURST);
const SparksShape = drawn("Sparks", <Path d="M4 13.5l5 2.5M10.5 4l2 6.5M20 6l-4 5.5" />);

const SMILE = "M7.4 13.4c1 2.3 2.7 3.5 4.6 3.5s3.6-1.2 4.6-3.5";
const EyesOpen = drawn(
  "EyesOpen",
  <>
    <Circle cx="8.9" cy="9.6" r="1.35" fill="currentColor" stroke="none" />
    <Circle cx="15.1" cy="9.6" r="1.35" fill="currentColor" stroke="none" />
    <Path d={SMILE} />
  </>,
);
const WinkShape = drawn(
  "Wink",
  <>
    <Circle cx="8.9" cy="9.6" r="1.35" fill="currentColor" stroke="none" />
    <Path d="M13.3 10.3c1.1-1 2.5-1 3.6 0" />
    <Path d={SMILE} />
  </>,
);

/** One shape in one token colour, `size` points square; `line` is its stroke in points. */
function Layer({
  as,
  size,
  colour,
  line = INK,
}: {
  as: LucideIcon;
  size: number;
  colour: string;
  line?: number;
}) {
  return (
    <View className="absolute left-0 top-0">
      <Icon as={as} size={size} strokeWidth={(line * 24) / size} className={colour} />
    </View>
  );
}

/** A soft shape behind things: `colour` is a text colour class of a token. */
export function Blob({ size, colour }: { size: number; colour: string }) {
  return <Icon as={BlobShape} size={size} className={colour} />;
}

/** A starburst in a token colour with the ink around it. */
export function Burst({ size, colour }: { size: number; colour: string }) {
  return (
    <View style={{ width: size, height: size }}>
      <Layer as={BurstFill} size={size} colour={colour} />
      <Layer as={BurstLine} size={size} colour="text-stroke" />
    </View>
  );
}

/** Three short strokes, as beside something that just landed; `line` is their width in points. */
export function Sparks({ size, line = 4 }: { size: number; line?: number }) {
  return (
    <Icon as={SparksShape} size={size} strokeWidth={(line * 24) / size} className="text-stroke" />
  );
}

/** The face of the try, eyes open or winking: the caller cross-fades the two. */
export function Face({ size, wink }: { size: number; wink: boolean }) {
  return (
    <Icon
      as={wink ? WinkShape : EyesOpen}
      size={size}
      strokeWidth={2.1}
      className="text-accent-foreground"
    />
  );
}

/** The round sticker the face sits on. */
export function Sticker({ size, children }: { size: number; children: ReactNode }) {
  const shadow = useHardShadow(4);
  return (
    <View
      className="items-center justify-center rounded-full border-solid border-stroke bg-accent"
      style={[shadow, { width: size, height: size, borderWidth: INK }]}
    >
      {children}
    </View>
  );
}

/** The headline's size at its largest, the `display` step of tailwind.config.js. */
const DISPLAY = 54;

/**
 * A headline in a slab of the accent colour, with the ink around it and its
 * hard shadow: the caller tilts it. The words are the screen's first heading;
 * `textRef` takes the screen reader to them. Its size follows `room`, the width
 * it has, so that a word of the length of "Profiili" stays whole on a 320-point
 * phone; and it does not grow with the OS's text size, being drawn larger
 * already than h1 at its largest (HEADING_FONT_SCALE: the larger, the less).
 */
export function Slab({
  children,
  room,
  max = DISPLAY,
  textRef,
}: {
  children: string;
  room: number;
  /** The largest the words are drawn: a step's question is longer than a cheer. */
  max?: number;
  textRef?: Ref<RNText>;
}) {
  const shadow = useHardShadow(LOUD_SHADOW);
  const size = Math.min(max, Math.floor(room * 0.158));
  return (
    <View
      className="rounded-xl border-solid border-stroke bg-accent px-5 py-1.5"
      style={[shadow, { borderWidth: INK }]}
    >
      <Text
        ref={textRef}
        variant="h1"
        accessibilityLiveRegion="polite"
        maxFontSizeMultiplier={1}
        className="text-display text-accent-foreground"
        style={{ fontSize: size, lineHeight: Math.round(size * 1.08) }}
      >
        {children}
      </Text>
    </View>
  );
}
