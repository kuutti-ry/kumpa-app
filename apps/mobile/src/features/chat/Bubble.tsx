import type { ReactNode } from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { DECORATIVE } from "@/theme/a11y";
import { useLookTraits } from "@/theme/ThemeProvider";
import { timeOf } from "./time";

/**
 * The person's own messages in the primary colour, the other's in the
 * secondary, or in the designers' try's Glass (outside production) on a
 * frosted pane; `shape` is the style's corners, its tail the corner nearest
 * the speaker: Neobrutalism's ink outline, the pill styles' round bubble.
 */
export function useBubble(mine: boolean): { box: string; text: string; shape: string } {
  const { ink, pill, glass } = useLookTraits();
  const colours = mine
    ? { box: "bg-primary", text: "text-primary-foreground" }
    : glass
      ? { box: "border border-solid border-card bg-card/70", text: "text-card-foreground" }
      : { box: "bg-secondary", text: "text-secondary-foreground" };
  const shape = ink
    ? cn("rounded-xl border-2 border-solid border-stroke", mine ? "rounded-br-sm" : "rounded-bl-sm")
    : pill
      ? cn("rounded-3xl", mine ? "rounded-br-md" : "rounded-bl-md")
      : "rounded-2xl";
  return { ...colours, shape };
}

/**
 * Where a message stands (#348): the person's own on the right, the other's on
 * the left, the time under it silent (the message's label says it), then a
 * note such as Read or Sending…, politely live where it changes as it goes.
 */
export function MessageFrame({
  mine,
  at,
  note,
  live = false,
  children,
}: {
  mine: boolean;
  at: string;
  note: string | null;
  live?: boolean;
  children: ReactNode;
}) {
  const { locale } = useT();
  return (
    <View
      className={cn("max-w-[85%] gap-1", mine ? "items-end self-end" : "items-start self-start")}
    >
      {children}
      <Text variant="muted" {...DECORATIVE}>
        {timeOf(locale, at)}
      </Text>
      {note && (
        <Text variant="muted" accessibilityLiveRegion={live ? "polite" : undefined}>
          {note}
        </Text>
      )}
    </View>
  );
}

/** A text message, read as who, when and what. */
export function TextBubble({
  mine,
  who,
  body,
  at,
  note,
}: {
  mine: boolean;
  who: string;
  body: string;
  at: string;
  note: string | null;
}) {
  const { t, locale } = useT();
  const colours = useBubble(mine);
  return (
    <MessageFrame mine={mine} at={at} note={note}>
      <View
        accessible
        accessibilityLabel={t("chat.message.label", { who, time: timeOf(locale, at), text: body })}
        className={cn("px-3 py-2", colours.shape, colours.box)}
      >
        <Text className={colours.text}>{body}</Text>
      </View>
    </MessageFrame>
  );
}
