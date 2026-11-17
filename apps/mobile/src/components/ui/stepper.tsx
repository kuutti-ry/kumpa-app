import Minus from "lucide-react-native/icons/minus";
import Plus from "lucide-react-native/icons/plus";
import { useEffect, useRef } from "react";
import { AccessibilityInfo, Platform, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { useHapticTap } from "@/theme/haptics";
import { useHardShadow } from "@/theme/shadow";
import { useLookTraits } from "@/theme/ThemeProvider";

/**
 * A number between a minus and a plus, which stand well clear of it (the
 * maintainer, 04/11/2026): every answer a button (ADR-010 §9), each with its
 * own spoken label, the number announced as it changes: from its live region,
 * and aloud on iOS, which has none, queued behind the button's own name (#542).
 * The age window of onboarding and of What you seek, and the height of the
 * profile (#146, #148).
 * The label is left out where the field above already names the number: the
 * height said "Height" twice (#238).
 * It takes no flex of its own: as `flex-1` in a column it could shrink to
 * nothing while its buttons still drew over the hint below (#238). It takes the
 * width of a line, with what it shows wrapping before its buttons do, so two
 * stand one above the other, never side by side: there they overflow a small phone.
 *
 * The designers' try (outside production, the tech screen's neubrutalism) draws
 * it as Sini's age screen of 15/11/2026: a card with the ink round it and its
 * hard shadow, the label a tab of the accent colour on its top edge, the number
 * large between two square buttons, the plus in the accent colour. `tone`
 * gives a second card the secondary colour, as hers does the oldest age. The
 * Organic Pop try draws it as her later board: a pill with a tab, on a soft shape.
 */
export function Stepper({
  label,
  value,
  shown,
  downLabel,
  upLabel,
  canDown,
  canUp,
  onChange,
  tone = "card",
}: {
  label?: string;
  value: number;
  /** The number as text, with its unit where it has one. */
  shown: string;
  downLabel: string;
  upLabel: string;
  canDown: boolean;
  canUp: boolean;
  onChange: (next: number) => void;
  tone?: "card" | "secondary";
}) {
  const tap = useHapticTap();
  const { ink: loud, pill, glass, headline } = useLookTraits();
  const shadow = useHardShadow(4);
  // Said when it changes, not when the screen opens.
  const before = useRef(shown);
  useEffect(() => {
    if (before.current === shown) return;
    before.current = shown;
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibilityWithOptions(shown, { queue: true });
    }
  }, [shown]);
  if (pill) {
    // The pill styles, Sini's Organic Pop age screen: a pill with its label a
    // tab on its top edge, the number large between a plain minus and plus,
    // slanted or in Saiga's italic as the style's headline is; a frosted pane
    // in Glass.
    const card = glass ? "bg-card/70" : "bg-card";
    return (
      <View>
        {label !== undefined && (
          <View className={cn("self-start rounded-t-2xl px-4 pb-0.5 pt-2", card)}>
            <Text variant="small" className="font-medium text-card-foreground">
              {label}
            </Text>
          </View>
        )}
        <View
          className={cn(
            "flex-row items-center justify-between gap-3 rounded-[32px] px-2 py-2 shadow-lg shadow-primary/15",
            card,
            label !== undefined && "rounded-tl-none",
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            accessibilityLabel={downLabel}
            disabled={!canDown}
            onPress={() => {
              tap();
              onChange(value - 1);
            }}
          >
            <Icon as={Minus} size={24} />
          </Button>
          {/* A value, not a heading; already larger than h1 at its largest, so it keeps its size. */}
          <Text
            role="none"
            maxFontSizeMultiplier={1}
            className={cn(
              "shrink text-center font-sans text-card-foreground",
              headline === "italic" ? "font-normal italic" : "font-extrabold",
            )}
            style={{
              fontSize: 44,
              lineHeight: 52,
              transform: headline === "italic" ? undefined : [{ skewX: "-9deg" }],
            }}
            accessibilityLiveRegion="polite"
          >
            {shown}
          </Text>
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            accessibilityLabel={upLabel}
            disabled={!canUp}
            onPress={() => {
              tap();
              onChange(value + 1);
            }}
          >
            <Icon as={Plus} size={24} />
          </Button>
        </View>
      </View>
    );
  }
  if (loud) {
    return (
      <View
        className={cn(
          "rounded-2xl border-solid border-stroke px-4 pb-4",
          label !== undefined ? "mt-3 pt-6" : "pt-4",
          tone === "secondary" ? "bg-secondary" : "bg-card",
        )}
        style={[shadow, { borderWidth: 2 }]}
      >
        {label !== undefined && (
          <View className="absolute -top-4 left-3 rounded-lg border-2 border-solid border-stroke bg-accent px-3 py-0.5">
            {/* The number's label, not a heading (#542): drawn as Sini's tab, heard as today's. */}
            <Text variant="title" role="none" className="text-accent-foreground">
              {label}
            </Text>
          </View>
        )}
        <View className="flex-row items-center justify-between gap-3">
          <Button
            variant="outline"
            size="icon"
            accessibilityLabel={downLabel}
            disabled={!canDown}
            onPress={() => {
              tap();
              onChange(value - 1);
            }}
          >
            <Icon as={Minus} />
          </Button>
          {/* A value, not a heading; already larger than h1 at its largest, so it keeps its size. */}
          <Text
            role="none"
            maxFontSizeMultiplier={1}
            className={cn(
              "shrink text-center font-sans font-bold",
              tone === "secondary" ? "text-secondary-foreground" : "text-card-foreground",
            )}
            style={{ fontSize: 52, lineHeight: 58 }}
            accessibilityLiveRegion="polite"
          >
            {shown}
          </Text>
          <Button
            variant="outline"
            size="icon"
            className="bg-accent"
            accessibilityLabel={upLabel}
            disabled={!canUp}
            onPress={() => {
              tap();
              onChange(value + 1);
            }}
          >
            <Icon as={Plus} className="text-accent-foreground" />
          </Button>
        </View>
      </View>
    );
  }
  return (
    <View className="items-center gap-1">
      {label !== undefined && <Text variant="small">{label}</Text>}
      <View className="flex-row items-center gap-6">
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel={downLabel}
          disabled={!canDown}
          onPress={() => {
            tap();
            onChange(value - 1);
          }}
        >
          <Icon as={Minus} />
        </Button>
        {/* A value, not a heading: drawn as one and heard as what it is. */}
        <Text
          variant="h2"
          role="none"
          className="shrink text-center"
          accessibilityLiveRegion="polite"
        >
          {shown}
        </Text>
        <Button
          variant="outline"
          size="icon"
          accessibilityLabel={upLabel}
          disabled={!canUp}
          onPress={() => {
            tap();
            onChange(value + 1);
          }}
        >
          <Icon as={Plus} />
        </Button>
      </View>
    </View>
  );
}
