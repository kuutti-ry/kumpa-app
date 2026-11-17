import { type Ref, useId } from "react";
import { type Text as RNText, type StyleProp, View, type ViewStyle } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { UNSPOKEN } from "@/components/celebration";
import { drawn, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useTokenColour } from "@/theme/shadow";
import { useLookTraits, useTheme } from "@/theme/ThemeProvider";

// The pieces of the Organic Pop try (outside production, one of the tech
// screen's styles), after Sini's board of 15/11/2026: soft shapes in a
// gradient of the style's colours, a display headline, and small marks drawn
// in the ink; the headline serves the other pill styles too. Every colour is a token, so the shapes follow every set of
// tokens.css; all of it but the headline's words is hidden from screen readers.

/** Three shapes on a 200-point grid: a three-lobed puddle, a wide bean, a cloud. */
const SHAPES = {
  puddle:
    "M38 128C10 108 14 62 48 54C78 47 92 18 126 20C162 22 184 50 178 86C173 116 190 140 172 166C152 194 112 180 92 170C72 160 62 145 38 128Z",
  bean: "M18 112C10 76 40 46 80 50C108 53 120 30 150 34C182 38 196 74 186 104C176 134 150 140 124 150C96 161 76 182 50 170C30 160 22 136 18 112Z",
  cloud:
    "M30 100C28 70 56 56 80 64C92 38 130 34 146 58C176 54 196 84 182 110C196 136 170 166 140 156C124 178 86 178 74 156C46 164 26 134 36 116C32 112 30 106 30 100Z",
} as const;

/**
 * Which colours run across a shape: `pop` from violet through lavender to
 * lime; `match` the same with the violet faded, light enough under the ink's
 * words, as behind Sini's "It's a Match!"; `soft` from lavender to lime;
 * `lavender` the one colour, fading.
 */
const RUNS = {
  pop: [
    ["ring", 0, 0.95],
    ["secondary", 0.5, 0.95],
    ["accent", 1, 0.95],
  ],
  soft: [
    ["secondary", 0, 1],
    ["secondary", 0.45, 1],
    ["accent", 1, 1],
  ],
  lavender: [
    ["secondary", 0, 0.95],
    ["secondary", 1, 0.55],
  ],
  match: [
    ["ring", 0, 0.6],
    ["secondary", 0.4, 1],
    ["accent", 1, 1],
  ],
} as const;

export type BlobShape = keyof typeof SHAPES;
export type BlobRun = keyof typeof RUNS;

/**
 * A soft shape in a gradient of tokens, `width` by `height` points, its colours
 * running at `angle` degrees (0 is left to right). Decoration only.
 */
export function GradientBlob({
  width,
  height,
  shape,
  run = "pop",
  angle = 0,
  style,
}: {
  width: number;
  height: number;
  shape: BlobShape;
  run?: BlobRun;
  angle?: number;
  style?: StyleProp<ViewStyle>;
}) {
  // An SVG gradient's id is the page's on the web: one each.
  const id = `blob${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const ring = useTokenColour("ring");
  const secondary = useTokenColour("secondary");
  const accent = useTokenColour("accent");
  const { highContrast } = useTheme();
  const room = <View style={[{ width, height }, style]} pointerEvents="none" {...UNSPOKEN} />;
  // High contrast keeps the room and draws no shape: its sets make the colours
  // the background's or the ink's, and a gradient between them under the words
  // takes the words below its 7:1.
  if (highContrast) return room;
  const colour = { ring, secondary, accent };
  const radians = (angle * Math.PI) / 180;
  const dx = Math.cos(radians) / 2;
  const dy = Math.sin(radians) / 2;
  return (
    <View style={[{ width, height }, style]} pointerEvents="none" {...UNSPOKEN}>
      <Svg width={width} height={height} viewBox="0 0 200 200" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1={0.5 - dx} y1={0.5 - dy} x2={0.5 + dx} y2={0.5 + dy}>
            {RUNS[run].map(([token, offset, opacity]) => (
              <Stop
                key={`${token}${offset}`}
                offset={offset}
                stopColor={colour[token]}
                stopOpacity={opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Path d={SHAPES[shape]} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** A four-pointed star on the 24-point grid, drawn as a line. */
const SparkleShape = drawn(
  "Sparkle",
  <Path d="M12 2.5c.7 5.2 2.3 6.8 7.5 9.5-5.2 2.7-6.8 4.3-7.5 9.5-.7-5.2-2.3-6.8-7.5-9.5 5.2-2.7 6.8-4.3 7.5-9.5Z" />,
);

/** A sparkle in the ink, as beside Sini's "Hyvä löytö!". Decoration only. */
export function Sparkle({
  size,
  style,
  colour = "text-stroke",
}: {
  size: number;
  style?: StyleProp<ViewStyle>;
  /** A text colour class of a token: the ink on a shape, `text-stroke` off one. */
  colour?: string;
}) {
  return (
    <View style={style} pointerEvents="none" {...UNSPOKEN}>
      <Icon as={SparkleShape} size={size} strokeWidth={(2 * 24) / size} className={colour} />
    </View>
  );
}

/**
 * The try's display headline, as the style draws it (looks.ts): in Organic Pop
 * Saiga at its heaviest, slanted as Sini's "Saiga Bold Italic" is (Saiga's
 * licensed faces have an italic in Regular alone, so the Extrabold leans by 9
 * degrees); in Glass and Bold Contrast Saiga's own italic, as her boards name
 * it. The screen's first heading; `textRef` takes the screen reader to it.
 * Drawn at `size` whatever the OS's text size, being larger already than h1 at
 * its largest.
 */
export function PopHeadline({
  children,
  size,
  textRef,
  className,
}: {
  children: string;
  size: number;
  textRef?: Ref<RNText>;
  className?: string;
}) {
  const italic = useLookTraits().headline === "italic";
  return (
    <Text
      ref={textRef}
      variant="h1"
      accessibilityLiveRegion="polite"
      maxFontSizeMultiplier={1}
      className={cn(italic ? "font-normal italic" : "font-extrabold", "text-foreground", className)}
      style={{
        fontSize: size,
        lineHeight: Math.round(size * (italic ? 1.1 : 1.04)),
        letterSpacing: -size * (italic ? 0.01 : 0.02),
        paddingHorizontal: Math.ceil(size * 0.08),
        transform: italic ? undefined : [{ skewX: "-9deg" }],
      }}
    >
      {children}
    </Text>
  );
}
