import { Platform } from "react-native";
import { cn } from "@/lib/utils";

/**
 * The app's looks, each with its own colours. Kumpa, the HS design of
 * 20/11/2026, is the one every phone starts in, a released app's too (the
 * maintainer, 20/11/2026). The rest are chosen on the tech screen, which
 * production has not: today's style, the app's look before Kumpa, and the
 * designers' try (#408), Sini's four from "finding style" of 15/11/2026.
 */
export const LOOKS = ["today", "neubrutalism", "organic", "glass", "bold", "kumpa"] as const;
export type Look = (typeof LOOKS)[number];

/** The style a phone starts in until one is chosen on the tech screen: Kumpa, the HS design. */
export const DEFAULT_LOOK: Look = "kumpa";

export const isLook = (value: string | null): value is Look =>
  (LOOKS as readonly (string | null)[]).includes(value);

/**
 * Each style's token sets of tokens.css, light and dark; today's are the base
 * sets. Whole class names, never built from parts: Tailwind keeps a rule of
 * tokens.css only for a class it finds written out in the source.
 */
export const LOOK_CLASS: Record<Look, { light?: string; dark?: string }> = {
  today: {},
  neubrutalism: { light: "look-neubrutalism", dark: "look-neubrutalism-dark" },
  organic: { light: "look-organic", dark: "look-organic-dark" },
  glass: { light: "look-glass", dark: "look-glass-dark" },
  bold: { light: "look-bold", dark: "look-bold-dark" },
  kumpa: { light: "look-kumpa", dark: "look-kumpa-dark" },
};

/**
 * What a style asks of the primitives and the screens, so that they draw by
 * trait rather than by a style's name, and a fifth style is a row here.
 */
export type LookTraits = {
  /** Outlines and hard shadows in the ink, square corners (Neobrutalism). */
  ink: boolean;
  /** Pills and soft round corners (Organic Pop, Glass, Bold Contrast). */
  pill: boolean;
  /** Cards, fields and bars as frosted panes over the backdrop (Glass). */
  glass: boolean;
  /** What is read at the system font's light weight (Organic Pop's "Inter Light"). */
  lightText: boolean;
  /**
   * A step's and a moment's display headline: today's h1, Saiga Extrabold
   * slanted (Saiga's italic is Regular alone), or Saiga's own italic.
   */
  headline: "plain" | "slant" | "italic";
  /** What a screen draws behind itself: nothing, soft blobs, bubbles, colour blocks. */
  backdrop: "none" | "blobs" | "bubbles" | "blocks";
  /** The match and Profile ready: today's, the tilted slab, or the shape behind the words. */
  moment: "plain" | "slab" | "pop";
  /**
   * A pressed row, ghost or outlined control tints its ground with the ink,
   * its words keeping their colour; today's fills it with --accent, a neutral
   * grey there, while a style's --accent is one of its loud colours, which the
   * words of a row are not paired with.
   */
  pressTint: boolean;
  /**
   * The card as a poster (Kumpa, the HS design of 20/11/2026): the photo to
   * the screen's edges with a wavy end, the name large under it, pastel chips,
   * and Pass, Like and Later as round buttons in the ink's outline.
   */
  poster: boolean;
};

const TRAITS: Record<Look, LookTraits> = {
  today: {
    ink: false,
    pill: false,
    glass: false,
    lightText: false,
    headline: "plain",
    backdrop: "none",
    moment: "plain",
    pressTint: false,
    poster: false,
  },
  neubrutalism: {
    ink: true,
    pill: false,
    glass: false,
    lightText: false,
    headline: "plain",
    backdrop: "none",
    moment: "slab",
    pressTint: true,
    poster: false,
  },
  organic: {
    ink: false,
    pill: true,
    glass: false,
    lightText: true,
    headline: "slant",
    backdrop: "blobs",
    moment: "pop",
    pressTint: true,
    poster: false,
  },
  glass: {
    ink: false,
    pill: true,
    glass: true,
    lightText: false,
    headline: "italic",
    backdrop: "bubbles",
    moment: "pop",
    pressTint: true,
    poster: false,
  },
  bold: {
    ink: false,
    pill: true,
    glass: false,
    lightText: false,
    headline: "italic",
    backdrop: "blocks",
    moment: "pop",
    pressTint: true,
    poster: false,
  },
  kumpa: {
    ink: true,
    pill: true,
    glass: false,
    lightText: false,
    headline: "plain",
    backdrop: "none",
    moment: "pop",
    pressTint: true,
    poster: true,
  },
};

/**
 * The fill of a pressed row, ghost or outlined control, and of a hovered one on
 * the web: `--accent` in today's style, a tenth of the ink where `pressTint`
 * says so, whose ground `looks.test.ts` holds the words to.
 */
export const PRESS_FILL = {
  accent: cn("active:bg-accent", Platform.select({ web: "hover:bg-accent" })),
  tint: cn("active:bg-foreground/10", Platform.select({ web: "hover:bg-foreground/5" })),
} as const;
export const pressFill = ({ pressTint }: Pick<LookTraits, "pressTint">): string =>
  pressTint ? PRESS_FILL.tint : PRESS_FILL.accent;

/**
 * A style's traits. High contrast keeps its shape and drops what thins the
 * words' ground: no see-through pane and nothing drawn behind a screen, since
 * its sets are for a person who needs them.
 */
export function traitsOf(look: Look, highContrast: boolean): LookTraits {
  const traits = TRAITS[look];
  return highContrast ? { ...traits, glass: false, backdrop: "none" } : traits;
}
