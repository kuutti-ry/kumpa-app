import { Slot } from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Platform, Text as RNText, type Role, View, type ViewProps } from "react-native";
import { cn } from "@/lib/utils";
import { HEADING_FONT_SCALE, MAX_FONT_SCALE } from "@/theme/a11y";
import { useLookTraits } from "@/theme/ThemeProvider";

// From React Native Reusables (#12, TD-9), adapted: text follows the OS font
// size up to MAX_FONT_SCALE, headings less (HEADING_FONT_SCALE), and no
// variant shrinks at a web breakpoint.
// The type is #408's (ADR-052 §4): what is read, ours and people's, is in the
// phone's own font (font-system) at 17 pt; Saiga (font-sans) draws headings
// and short labels. Saiga Regular is as dark as the system font's Semibold, so
// it takes Semibold's jobs, and Bold is for h1 alone.
const textVariants = cva(
  cn("font-system text-body text-foreground", Platform.select({ web: "select-text" })),
  {
    variants: {
      variant: {
        default: "",
        h1: "font-sans text-h1 font-bold",
        h2: "font-sans text-h2 font-medium",
        h3: "font-sans text-title font-medium",
        h4: "font-sans text-control font-medium",
        // A heading inside a card or a dialog, or over an open row of Settings (#511).
        title: "font-sans text-title font-normal",
        // The heading of a group of rows: small and quiet, as the phone's own lists draw it.
        group: "font-sans text-label font-normal text-muted-foreground",
        // A field's label, a chip's words, a short tag.
        small: "font-sans text-label font-normal",
        muted: "text-small text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps["variant"]>;

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  title: "heading",
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = {
  h1: "1",
  h2: "2",
  h3: "3",
  h4: "4",
  title: "4",
};

const FONT_SCALE: Partial<Record<TextVariant, number>> = HEADING_FONT_SCALE;

/** The text classes a parent (a Button, a Card) wants its Text children to take. */
const TextClassContext = React.createContext<string | undefined>(undefined);

type TextProps = React.ComponentProps<typeof RNText> &
  React.RefAttributes<RNText> &
  TextVariantProps & { asChild?: boolean };

// The Organic Pop try (outside production) reads what is read light, as Sini's
// "Inter Light": the phone's own font at its light weight, which a button's or
// a heading's own weight overrides.
const LIGHT: Partial<Record<TextVariant, true>> = { default: true, muted: true };

function Text({ className, asChild = false, variant = "default", ...props }: TextProps) {
  const textClass = React.useContext(TextClassContext);
  const light = useLookTraits().lightText && variant !== null && LIGHT[variant];
  const drawn = cn(textVariants({ variant }), light && "font-light", textClass);
  const own = {
    role: variant ? ROLE[variant] : undefined,
    "aria-level": variant ? ARIA_LEVEL[variant] : undefined,
    maxFontSizeMultiplier: (variant && FONT_SCALE[variant]) ?? MAX_FONT_SCALE,
    ...props,
  };
  // asChild takes an element, so a heading of words is never one.
  if (ofPlainWords(own)) return <Heading drawn={drawn} className={className} {...own} />;
  const Component = asChild ? Slot : RNText;
  return <Component className={cn(drawn, className)} {...own} />;
}

/**
 * A heading of plain words, whose lines are left to Text: not on the web,
 * where text keeps one size, nor where the caller sets the lines, the size or
 * the style, reads the layout or makes the heading pressable.
 */
function ofPlainWords(props: TextProps): props is TextProps & { children: string } {
  return (
    Platform.OS !== "web" &&
    props.role === "heading" &&
    typeof props.children === "string" &&
    props.numberOfLines === undefined &&
    props.adjustsFontSizeToFit === undefined &&
    props.onTextLayout === undefined &&
    props.onPress === undefined &&
    props.onLongPress === undefined &&
    props.style === undefined
  );
}

type HeadingProps = TextProps & { children: string; drawn: string };

/**
 * A heading's words never break in the middle (#467, #757). It is one text
 * while the phone breaks its lines between words or after a hyphen, and is
 * drawn again as Words once a line ends inside a word. Either phone breaks a
 * word wider than the line anywhere in it, and Android never breaks after a
 * hyphen while hyphenation is off, React Native's default (Minikin leaves
 * hyphens to hyphenation): "Ihmiset Kumpa-so" over "velluksessa".
 */
function Heading({ drawn, className, ...props }: HeadingProps) {
  // The words the phone broke inside one. Other words, as in another
  // language, are one text again until their own lines say otherwise.
  const [broken, setBroken] = React.useState<string>();
  const words = props.children;
  if (broken === words) return <Words drawn={drawn} className={className} {...props} />;
  return (
    <RNText
      className={cn(drawn, className)}
      {...props}
      onTextLayout={({ nativeEvent }) => {
        if (breaksInWord(nativeEvent.lines)) setBroken(words);
      }}
    />
  );
}

/**
 * Whether a line other than the last ends inside a word: not at a space, nor
 * after a hyphen. Both phones give each line with the space it ends at.
 */
function breaksInWord(lines: ReadonlyArray<{ text: string }>): boolean {
  return lines.slice(0, -1).some(({ text }) => !/[\s-]$/.test(text));
}

/**
 * Where Words breaks: after a space, and after a hyphen inside a word
 * ("Kumpa-|sovelluksessa"), unless a digit follows. Never at a no-break space.
 */
const BREAK = /(?<= )(?=[^ ])|(?<=[^\s-]-)(?=[^\s\d-])/;

/** A class that draws the words rather than the box they stand in. */
const WORD_CLASS =
  /^(?:[\w-]+:)*!?(?:text-|font-|tracking-|leading-|italic$|not-italic$|uppercase$|lowercase$|capitalize$|normal-case$|underline$|line-through$|no-underline$)/;

/** A heading drawn centred or at the end keeps its lines so. */
function alignment(classes: string): string | undefined {
  if (/(?:^| )text-center(?: |$)/.test(classes)) return "justify-center";
  if (/(?:^| )text-(?:right|end)(?: |$)/.test(classes)) return "justify-end";
  return undefined;
}

/**
 * A heading as its words. Each word, and each part of a hyphenated word up to
 * its hyphen, is a line of its own, so the heading breaks only between them;
 * one wider than the heading even alone shrinks to fit, #467's fallback. The
 * box takes the caller's layout and speaks the heading whole; its words take
 * the classes that draw text.
 */
function Words({
  children,
  className,
  drawn,
  maxFontSizeMultiplier,
  allowFontScaling,
  ...props
}: HeadingProps) {
  // The box takes what the caller gave the heading: its layout, its
  // accessibility and its ref, a host view as the text was, which a screen
  // reader's focus is sent to (focusOnMount). A view ignores a text's own props.
  const box = props as ViewProps & React.RefAttributes<View>;
  const classes = className?.split(/\s+/) ?? [];
  const wordClass = cn(
    drawn,
    classes.filter((utility) => WORD_CLASS.test(utility)),
  );
  const boxClass = classes.filter((utility) => !WORD_CLASS.test(utility));
  let offset = 0;
  return (
    <View
      accessible
      accessibilityLabel={children}
      className={cn("flex-row flex-wrap", alignment(cn(drawn, className)), boxClass)}
      {...box}
    >
      {children
        .trim()
        .split(BREAK)
        .map((word) => {
          const key = offset;
          offset += word.length;
          return (
            <RNText
              key={key}
              className={wordClass}
              numberOfLines={1}
              adjustsFontSizeToFit
              maxFontSizeMultiplier={maxFontSizeMultiplier}
              allowFontScaling={allowFontScaling}
            >
              {word}
            </RNText>
          );
        })}
    </View>
  );
}

export { Text, TextClassContext };
