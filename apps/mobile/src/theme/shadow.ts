import { useUnstableNativeVariable } from "nativewind";
import { Platform, type ViewStyle } from "react-native";
import { useTheme } from "./ThemeProvider";

/**
 * Neubrutalism's hard shadow (neubrutalism.com): the shape again, offset down
 * and right, in the ink, with no blur. Its three tiers, kept small for a
 * dating app: a control, a container, and a dialog over everything.
 */
export const HARD_SHADOW = { control: 2, container: 3, overlay: 5 } as const;

// NativeWind turns box-shadow into a colour and a blur and drops the offset, so
// the shadow is React Native's own boxShadow style. Its colour is the ink, the
// --stroke token, as on neubrutalism.com: on a phone read from the set the root
// view carries (NativeWind keeps only a variable some class uses, and
// border-stroke does), on the web the CSS variable itself, which NativeWind's
// hook does not read there.
const useInkChannels: () => unknown =
  Platform.OS === "web" ? () => undefined : () => useUnstableNativeVariable("--stroke");

function hslOf(channels: unknown, alpha?: number): string | undefined {
  const text = Array.isArray(channels) ? channels.join(" ") : channels;
  if (typeof text !== "string") return undefined;
  const [hue, saturation, lightness] = text.trim().split(/[\s,]+/);
  if (!hue || !saturation || !lightness) return undefined;
  return alpha === undefined
    ? `hsl(${hue}, ${saturation}, ${lightness})`
    : `hsla(${hue}, ${saturation}, ${lightness}, ${alpha})`;
}

/**
 * A token's colour as a string, for what takes no class: a gradient's stops in
 * the Organic Pop try (components/organic.tsx). On the web the CSS variable
 * itself, which an SVG paint resolves; on a phone the value of the set the root
 * view carries, which NativeWind keeps only for a token some class uses.
 */
const useNativeToken: (token: string) => unknown =
  Platform.OS === "web" ? () => undefined : (token) => useUnstableNativeVariable(`--${token}`);

export function useTokenColour(token: string): string | undefined {
  const channels = useNativeToken(token);
  return Platform.OS === "web" ? `hsl(var(--${token}))` : hslOf(channels);
}

/** The hard shadow at an offset, or nothing where the token cannot be read. */
export function useHardShadow(offset: number): ViewStyle {
  const channels = useInkChannels();
  const colour = Platform.OS === "web" ? "hsl(var(--stroke))" : hslOf(channels);
  return colour === undefined ? {} : { boxShadow: `${offset}px ${offset}px 0px 0px ${colour}` };
}

/** How much of the lift's colour shows, at its darkest. */
const LIFT_ALPHA = 0.35;

/**
 * A soft shadow under a control that floats over what scrolls beneath it: the
 * queue's decision buttons over the card (#681, the maintainer's of
 * 18/11/2026). Its colour is the set's darker end, the ink in a light set and
 * the background in a dark one, whose ink is light, so it reads as a shadow in
 * all four. A style that draws hard shadows keeps its own (the button's).
 */
export function useLift(): ViewStyle {
  const { scheme } = useTheme();
  const token = scheme === "dark" ? "background" : "stroke";
  const ink = useNativeToken("stroke");
  const ground = useNativeToken("background");
  const colour =
    Platform.OS === "web"
      ? `hsl(var(--${token}) / ${LIFT_ALPHA})`
      : hslOf(scheme === "dark" ? ground : ink, LIFT_ALPHA);
  return colour === undefined ? {} : { boxShadow: `0px 2px 8px 0px ${colour}` };
}
