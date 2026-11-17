import { useWindowDimensions, View } from "react-native";
import { Blob, Slab, Sparks, UNSPOKEN } from "@/components/celebration";
import { type BlobShape, GradientBlob, PopHeadline } from "@/components/organic";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { useLookTraits, useTheme } from "@/theme/ThemeProvider";

/** The widest a step's title is drawn, on a tablet or the web preview. */
const ROOM_MAX = 400;
/** A step's title is a question of a few words: smaller than a celebration's two. */
const TITLE_MAX = 40;

/**
 * A step's question, the screen's heading. Today's look draws it plain. The
 * designers' try (outside production, the tech screen's styles) draws it as
 * Sini's screens of 15/11/2026 do: in Neobrutalism in a slab of the accent
 * colour, tilted a little, with sparks at its corner and a soft blob behind;
 * in the pill styles as their display headline. All of it but the words is
 * hidden from a screen reader.
 */
const SHAPE_BY_TURN: readonly BlobShape[] = ["bean", "puddle", "cloud"];

export function StepTitle({ children }: { children: string }) {
  const { ink: loud, headline, backdrop } = useLookTraits();
  const { width } = useWindowDimensions();
  const { scheme } = useTheme();
  if (headline !== "plain") {
    // The pill styles: the question large and in the ink. Organic Pop's comes
    // slanted, with a soft shape from the screen's edge behind its end, a
    // different one from step to step, as Sini's "Kaksi kuvaa sinusta"; Glass
    // and Bold Contrast's in Saiga's italic on their backdrop, Bold Contrast's
    // underlined with a short block of its loudest colour.
    const room = Math.min(width - 48, ROOM_MAX);
    const shape = SHAPE_BY_TURN[children.length % SHAPE_BY_TURN.length] ?? "bean";
    const size = Math.min(TITLE_MAX + 2, Math.floor(room * 0.12));
    if (backdrop !== "blobs") {
      return (
        <View className="gap-3 pb-1 pt-3">
          <PopHeadline size={size}>{children}</PopHeadline>
          {backdrop === "blocks" && (
            <View className="ml-1 h-2.5 w-20 rounded-full bg-flourish" {...UNSPOKEN} />
          )}
        </View>
      );
    }
    return (
      <View className="pb-1 pt-3">
        <GradientBlob
          width={room * 0.62}
          height={room * 0.48}
          shape={shape}
          angle={140}
          // Dark, the shape is a glow, so the light words over its edge still read.
          style={{
            position: "absolute",
            right: -room * 0.24,
            top: -room * 0.1,
            opacity: scheme === "dark" ? 0.3 : 1,
          }}
        />
        <PopHeadline size={size}>{children}</PopHeadline>
      </View>
    );
  }
  if (!loud) {
    return (
      <Text variant="h1" accessibilityRole="header">
        {children}
      </Text>
    );
  }
  const room = Math.min(width - 48, ROOM_MAX);
  return (
    <View className="pb-2 pt-6">
      <View className="absolute" style={{ right: -room * 0.1, top: -room * 0.08 }} {...UNSPOKEN}>
        <Blob size={room * 0.5} colour="text-secondary" />
      </View>
      <View className="self-start" style={{ transform: [{ rotate: "-3deg" }] }}>
        <Slab room={room} max={TITLE_MAX}>
          {children}
        </Slab>
        <View className="absolute" style={{ right: -16, top: -24 }} {...UNSPOKEN}>
          <Sparks size={36} />
        </View>
      </View>
    </View>
  );
}

/**
 * Where a step stands, "Step 3 of 8", said where it changes. The try adds
 * Sini's bar under it, one segment a step, those done in the primary colour;
 * the words say it all, so the bar is not spoken.
 */
export function StepProgress({ step, total }: { step: number; total: number }) {
  const { t } = useT();
  const { ink: loud, pill, backdrop } = useLookTraits();
  const words = (
    <Text variant="muted" accessibilityLiveRegion="polite">
      {t("onboarding.progress", { step, total })}
    </Text>
  );
  if (pill) {
    // Sini's thin bar: the steps done in the primary colour, this one in the
    // ring's (Organic Pop's violet, Glass's teal), or in Bold Contrast's
    // loudest colour, a little thicker.
    return (
      <View className="gap-2.5">
        {words}
        <View className="flex-row gap-1.5" {...UNSPOKEN}>
          {Array.from({ length: total }, (_, at) => (
            <View
              key={at}
              className={cn(
                "flex-1 rounded-full",
                backdrop === "blocks" ? "h-2.5" : "h-1.5",
                at < step - 1
                  ? "bg-primary"
                  : at !== step - 1
                    ? "bg-border"
                    : backdrop === "blocks"
                      ? "bg-flourish"
                      : "bg-ring",
              )}
            />
          ))}
        </View>
      </View>
    );
  }
  if (!loud) return words;
  return (
    <View className="gap-2">
      {words}
      <View className="flex-row gap-1.5" {...UNSPOKEN}>
        {Array.from({ length: total }, (_, at) => (
          <View
            key={at}
            className={cn(
              "h-2.5 flex-1 rounded-full border-solid border-stroke",
              at < step ? "bg-primary" : "bg-card",
            )}
            style={{ borderWidth: 1.5 }}
          />
        ))}
      </View>
    </View>
  );
}
