import { useId } from "react";
import { type StyleProp, useWindowDimensions, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Rect, Stop } from "react-native-svg";
import { UNSPOKEN } from "@/components/celebration";
import { type BlobRun, type BlobShape, GradientBlob } from "@/components/organic";
import { cn } from "@/lib/utils";
import type { LookTraits } from "@/theme/looks";
import { useTokenColour } from "@/theme/shadow";
import { useLookTraits, useTheme } from "@/theme/ThemeProvider";

// What the try's pill styles (outside production) draw behind a screen and
// under a moment's words, after Sini's boards of "finding style": Organic
// Pop's soft blobs, Glass's bubbles and frosted panes, Bold Contrast's colour
// blocks. Every colour is a token, so the shapes follow every set of
// tokens.css; all of it is hidden from screen readers and takes no touch.

/**
 * A token a backdrop tints with, and how strongly at most (0..1), by day and by
 * night: light words need a darker ground, so the night's tints are fainter.
 */
export type Tint = { token: "secondary" | "accent" | "flourish"; light: number; dark: number };

type Kind = Exclude<LookTraits["backdrop"], "none">;

/**
 * Each backdrop's tints: a wash over the whole screen, and the patches in its
 * corners. Words of every kind sit on them, so the alphas are what
 * backdrop.test.tsx holds: the foreground, the muted foreground and the primary
 * at 4.5:1, the outline of a field and the ink at 3:1, on the wash and on each
 * patch over it, in each style's light and dark sets, and a pressed row's words
 * there under its tint of the ink (pressFill), which kept Glass's dark bubbles
 * faint.
 */
export const BACKDROP_TINTS: Record<Kind, { wash?: Tint; patches: readonly Tint[] }> = {
  blobs: {
    patches: [
      { token: "secondary", light: 0.55, dark: 0.2 },
      { token: "accent", light: 0.55, dark: 0.2 },
    ],
  },
  bubbles: {
    wash: { token: "secondary", light: 0.6, dark: 0.6 },
    patches: [
      { token: "flourish", light: 0.6, dark: 0.2 },
      { token: "accent", light: 0.35, dark: 0.15 },
    ],
  },
  blocks: {
    patches: [
      { token: "flourish", light: 0.3, dark: 0.3 },
      { token: "accent", light: 0.3, dark: 0.15 },
      { token: "secondary", light: 0.35, dark: 0.25 },
    ],
  },
};

// Whole class names, never built from parts: Tailwind keeps a rule only for a
// class it finds written out.
const FILL: Record<Tint["token"], string> = {
  secondary: "bg-secondary",
  accent: "bg-accent",
  flourish: "bg-flourish",
};

/**
 * A glass bubble, Glass's: a circle of `token`, clearer towards its edge, lit
 * from its upper left in the card's colour and ringed in it. Decoration only.
 */
export function Bubble({
  size,
  token,
  alpha = 1,
  style,
}: {
  size: number;
  token: Tint["token"];
  alpha?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const id = `bubble${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tone = useTokenColour(token);
  const light = useTokenColour("card");
  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none" {...UNSPOKEN}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id={id} cx="38%" cy="32%" r="68%">
            <Stop offset={0} stopColor={light} stopOpacity={alpha * 0.85} />
            <Stop offset={0.32} stopColor={tone} stopOpacity={alpha} />
            <Stop offset={1} stopColor={tone} stopOpacity={alpha * 0.3} />
          </RadialGradient>
        </Defs>
        <Circle
          cx={50}
          cy={50}
          r={49}
          fill={`url(#${id})`}
          stroke={light}
          strokeOpacity={alpha}
          strokeWidth={0.8}
        />
      </Svg>
    </View>
  );
}

/** A block of colour, Bold Contrast's: a rounded square or a round, tilted. Decoration only. */
export function Block({
  width,
  height,
  token,
  alpha = 1,
  round = false,
  rotate = 0,
  style,
}: {
  width: number;
  height: number;
  token: Tint["token"];
  alpha?: number;
  round?: boolean;
  rotate?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      className={cn(FILL[token], round ? "rounded-full" : "rounded-[28px]")}
      style={[{ width, height, opacity: alpha, transform: [{ rotate: `${rotate}deg` }] }, style]}
      pointerEvents="none"
      {...UNSPOKEN}
    />
  );
}

/** The widest a backdrop's shapes are measured against, on a tablet or the web preview. */
const ROOM_MAX = 520;

type Corner = { top?: number; bottom?: number; left?: number; right?: number };

/** Where in a screen a patch sits, as fractions of its measure. */
const at = (corner: Corner, room: number): ViewStyle => ({
  position: "absolute",
  ...Object.fromEntries(Object.entries(corner).map(([side, f]) => [side, f * room])),
});

/**
 * What the style draws behind a screen: the first child of a screen's root,
 * behind everything on it, and nothing in today's style, in Neobrutalism or in
 * high contrast (looks.ts).
 */
export function Backdrop() {
  const { backdrop } = useLookTraits();
  return backdrop === "none" ? null : <Drawn backdrop={backdrop} />;
}

/** The backdrop itself, at the scheme's tints; asked only where a style draws one. */
function Drawn({ backdrop }: { backdrop: Exclude<LookTraits["backdrop"], "none"> }) {
  const { scheme } = useTheme();
  const { width } = useWindowDimensions();
  const room = Math.min(width, ROOM_MAX);
  const alpha = (tint: Tint | undefined) => tint?.[scheme] ?? 0;
  return (
    <View className="absolute inset-0 overflow-hidden" pointerEvents="none" {...UNSPOKEN}>
      {backdrop === "blobs" && <Blobs room={room} alpha={alpha} />}
      {backdrop === "bubbles" && <Bubbles room={room} alpha={alpha} />}
      {backdrop === "blocks" && <Blocks room={room} alpha={alpha} />}
    </View>
  );
}

type Layer = { room: number; alpha: (tint: Tint | undefined) => number };

function Blobs({ room, alpha }: Layer) {
  const [lavender, lime] = BACKDROP_TINTS.blobs.patches;
  return (
    <>
      <GradientBlob
        width={room * 0.95}
        height={room * 0.8}
        shape="puddle"
        run="lavender"
        angle={120}
        style={[at({ top: -0.36, right: -0.42 }, room), { opacity: alpha(lavender) }]}
      />
      <GradientBlob
        width={room * 0.85}
        height={room * 0.7}
        shape="cloud"
        run="soft"
        angle={300}
        style={[at({ bottom: -0.32, left: -0.4 }, room), { opacity: alpha(lime) }]}
      />
    </>
  );
}

function Bubbles({ room, alpha }: Layer) {
  const { wash, patches } = BACKDROP_TINTS.bubbles;
  const [lavender, cyan] = patches;
  const id = `wash${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const sky = useTokenColour(wash?.token ?? "secondary");
  return (
    <>
      {/* The sky: the secondary colour from the top, clearing by the middle. */}
      <Svg width="100%" height="100%" style={{ position: "absolute" }}>
        <Defs>
          <LinearGradient id={id} x1={0} y1={0} x2={0} y2={1}>
            <Stop offset={0} stopColor={sky} stopOpacity={alpha(wash)} />
            <Stop offset={0.6} stopColor={sky} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      <Bubble
        size={room * 0.78}
        token="flourish"
        alpha={alpha(lavender)}
        style={at({ top: -0.26, right: -0.3 }, room)}
      />
      <Bubble
        size={room * 0.22}
        token="flourish"
        alpha={alpha(lavender)}
        style={at({ top: 0.62, right: 0.06 }, room)}
      />
      <Bubble
        size={room * 0.6}
        token="accent"
        alpha={alpha(cyan)}
        style={at({ bottom: -0.22, left: -0.26 }, room)}
      />
    </>
  );
}

function Blocks({ room, alpha }: Layer) {
  const [coral, lime, lavender] = BACKDROP_TINTS.blocks.patches;
  return (
    <>
      <Block
        width={room * 0.72}
        height={room * 0.72}
        token="flourish"
        alpha={alpha(coral)}
        rotate={16}
        style={at({ top: -0.4, right: -0.3 }, room)}
      />
      <Block
        width={room * 0.2}
        height={room * 0.2}
        token="secondary"
        alpha={alpha(lavender)}
        rotate={-14}
        style={at({ top: 0.34, right: -0.07 }, room)}
      />
      <Block
        width={room * 0.5}
        height={room * 0.5}
        token="accent"
        alpha={alpha(lime)}
        round
        style={at({ bottom: -0.2, left: -0.18 }, room)}
      />
    </>
  );
}

/**
 * The ground of a moment's headline (the hello, Profile ready), in the pill
 * styles, `width` by `height`: Organic Pop's gradient shape, a frosted pane on
 * a bubble in Glass, a tilted block of the accent on a block of the flourish in
 * Bold Contrast; nothing in high contrast, which keeps the room. `momentInk`
 * is the colour the words take on it.
 */
export function MomentGround({
  width,
  height,
  shape,
  angle,
}: {
  width: number;
  height: number;
  shape: BlobShape;
  angle: number;
}) {
  const { backdrop } = useLookTraits();
  if (backdrop === "blobs") {
    return <GradientBlob width={width} height={height} shape={shape} run="match" angle={angle} />;
  }
  if (backdrop === "bubbles") {
    return (
      <View style={{ width, height }} pointerEvents="none" {...UNSPOKEN}>
        <Bubble
          size={height * 0.95}
          token="flourish"
          style={{ position: "absolute", right: -height * 0.12, top: -height * 0.2 }}
        />
        <Bubble
          size={height * 0.5}
          token="accent"
          alpha={0.8}
          style={{ position: "absolute", left: -height * 0.08, bottom: -height * 0.12 }}
        />
        <View
          className="absolute inset-x-0 rounded-full border border-solid border-card bg-card/80"
          style={{ top: height * 0.14, bottom: height * 0.14 }}
        />
      </View>
    );
  }
  if (backdrop === "blocks") {
    return (
      <View style={{ width, height }} pointerEvents="none" {...UNSPOKEN}>
        <Block
          width={width * 0.92}
          height={height * 0.78}
          token="flourish"
          rotate={angle > 0 ? 4 : -4}
          style={{ position: "absolute", left: width * 0.06, top: height * 0.16 }}
        />
        <Block
          width={width * 0.92}
          height={height * 0.78}
          token="accent"
          rotate={angle > 0 ? -3 : 3}
          style={{ position: "absolute", left: width * 0.02, top: height * 0.04 }}
        />
      </View>
    );
  }
  return <View style={{ width, height }} pointerEvents="none" {...UNSPOKEN} />;
}

/** The words' colour on a moment's ground, held to its pair by check:contrast. */
export function momentInk(backdrop: LookTraits["backdrop"]): string {
  return backdrop === "bubbles"
    ? "text-card-foreground"
    : backdrop === "none"
      ? "text-foreground"
      : "text-accent-foreground";
}

/**
 * A small shape beside a photo in a moment: Organic Pop's gradient blob, a
 * bubble in Glass, a block in Bold Contrast; `run` picks its colours as a
 * blob's would (`soft` the accent, `lavender` the secondary).
 */
export function Patch({
  width,
  height,
  shape,
  run,
  angle = 0,
  style,
}: {
  width: number;
  height: number;
  shape: BlobShape;
  run: Extract<BlobRun, "soft" | "lavender">;
  angle?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { backdrop } = useLookTraits();
  const token = run === "soft" ? "accent" : "secondary";
  if (backdrop === "bubbles") {
    return <Bubble size={Math.min(width, height)} token={token} style={style} />;
  }
  if (backdrop === "blocks") {
    return (
      <Block
        width={width * 0.8}
        height={height * 0.8}
        token={token}
        round={run === "soft"}
        rotate={angle / 12}
        style={style}
      />
    );
  }
  return (
    <GradientBlob
      width={width}
      height={height}
      shape={shape}
      run={run}
      angle={angle}
      style={style}
    />
  );
}
