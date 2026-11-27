import type { StarredPerson } from "@kuutti/schema";
import { getRandomValues } from "expo-crypto";
import { useRouter } from "expo-router";
import { type Ref, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { LoadFailed } from "@/components/LoadFailed";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { PhotoImage } from "@/features/media";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { DECORATIVE, focusOnMount, MINIMUM_TARGET } from "@/theme/a11y";
import { useHapticTap } from "@/theme/haptics";
import { pressFill } from "@/theme/looks";
import { useLookTraits } from "@/theme/ThemeProvider";
import {
  choose,
  type LaterOrder,
  NO_ORDER,
  pairOf,
  readLaterOrder,
  saveLaterOrder,
  settle,
} from "./later-order";
import { useStars } from "./useStars";

/**
 * The share of the window's height a photo takes: two, one under the other
 * with their names, fit a phone held upright, and one beside the other a window
 * wider than it is high.
 */
const PHOTO_SHARE = { stacked: 0.3, across: 0.55 } as const;

/**
 * Whether a pair is shown turned round, heads or tails from the system's
 * generator (`.claude/rules/mobile.md`), so that the one being placed has no
 * place of their own on the screen.
 */
const turnedRound = (): boolean =>
  getRandomValues(new Uint8Array(1)).some((byte) => byte % 2 === 1);

function Pick({
  person,
  photoHeight,
  across,
  onPick,
  ref,
}: {
  person: StarredPerson;
  photoHeight: number;
  /** Side by side, each of the two takes half the row. */
  across: boolean;
  onPick: () => void;
  ref?: Ref<View>;
}) {
  const { t } = useT();
  const traits = useLookTraits();
  const { name, age, photo } = person;
  const who = t("profile.card.nameAge", { name, years: age });
  // The card's own shape, three wide and four high (`card`, 800 x 1067), and
  // never wider than its half or the screen.
  const frame = { height: photoHeight, aspectRatio: 3 / 4, maxWidth: "100%" } as const;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={who}
      accessibilityHint={t("stars.kumpa.pick.hint")}
      className={cn("items-center gap-2 rounded-xl p-1", across && "flex-1", pressFill(traits))}
      style={MINIMUM_TARGET}
      onPress={onPick}
    >
      {photo ? (
        <View className="overflow-hidden rounded-lg" style={frame}>
          <PhotoImage
            id={photo.id}
            variant="card"
            blurhash={photo.blurhash}
            accessibilityLabel={t("stars.photo.label", { name })}
            style={{ width: "100%", height: "100%" }}
          />
        </View>
      ) : (
        // The edge keeps the shape in the high-contrast sets, whose --muted is the
        // background itself (#467).
        <View className="rounded-lg border border-border bg-muted" style={frame} {...DECORATIVE} />
      )}
      <Text className="text-center font-semibold">{who}</Text>
    </Pressable>
  );
}

/**
 * Kumpa (the maintainer, 26/11/2026; ADR-064 §6): two people of the Later list,
 * one under the other on a phone held upright and side by side on a window
 * wider than it is high, each with the main photo they were shown in the card's
 * shape, and a tap on one puts them before the other, until everybody has a
 * place (`later-order`). Which of the two comes first is drawn again for each
 * pair. The order is the person's own and stays on this phone; nothing here is sent
 * but the photos' addresses asked for, as a card opened from the list asks for
 * them. Nothing is asked ahead of the two on the screen, and nothing counts how
 * far the person is. A screen reader is taken to the next pair after a pick, and
 * to the line that says the list is in order once it is.
 */
export function KumpaScreen() {
  const { t } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const { view, retry } = useStars();
  const [saved, setSaved] = useState<LaterOrder | null>(null);
  const [turned, setTurned] = useState(turnedRound);
  const { width, height } = useWindowDimensions();
  const across = width > height;
  const photoHeight = height * (across ? PHOTO_SHARE.across : PHOTO_SHARE.stacked);
  const first = useRef<View>(null);
  const picked = useRef(false);

  useEffect(() => {
    let live = true;
    void readLaterOrder().then((read) => {
      if (live) setSaved(read);
    });
    return () => {
      live = false;
    };
  }, []);

  const items = view.status === "ready" ? view.items : [];
  const ready = view.status === "ready" && saved !== null;
  const state =
    saved === null
      ? NO_ORDER
      : settle(
          items.map((person) => person.id),
          saved,
        );
  const pair = ready ? pairOf(state) : null;
  const byId = new Map(items.map((person) => [person.id, person]));
  const shown = (pair && turned ? [pair[1], pair[0]] : pair)?.flatMap((id) => {
    const person = byId.get(id);
    return person ? [person] : [];
  });
  const shownKey = shown?.map((person) => person.id).join(" ");

  useEffect(() => {
    if (shownKey !== undefined && picked.current) focusOnMount(first.current);
  }, [shownKey]);

  const pick = (id: string) => {
    tap();
    picked.current = true;
    const next = choose(state, id);
    setSaved(next);
    setTurned(turnedRound());
    void saveLaterOrder(next);
  };

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScreenHeader title={t("stars.kumpa.title")} backLabel={t("stars.card.back")} />
      <ScrollView contentContainerClassName="flex-grow gap-4 p-6">
        {(view.status === "loading" || (view.status === "ready" && saved === null)) && (
          <Text accessibilityLiveRegion="polite">{t("load.loading")}</Text>
        )}
        {view.status === "failed" && <LoadFailed error={view.error} onRetry={retry} />}
        {ready && items.length === 0 && <Text ref={focusOnMount}>{t("stars.none")}</Text>}
        {ready && shown && shown.length === 2 && (
          <View testID="kumpa-pair" className={cn("gap-3", across ? "flex-row" : "flex-col")}>
            {shown.map((person, index) => (
              <Pick
                key={person.id}
                person={person}
                photoHeight={photoHeight}
                across={across}
                ref={index === 0 ? first : undefined}
                onPick={() => pick(person.id)}
              />
            ))}
          </View>
        )}
        {ready && pair === null && items.length > 0 && (
          <View className="gap-4">
            <Text ref={focusOnMount} accessibilityLiveRegion="polite">
              {t("stars.kumpa.done")}
            </Text>
            <Button
              accessibilityLabel={t("stars.card.back")}
              onPress={() => {
                tap();
                router.back();
              }}
            >
              <Text>{t("stars.card.back")}</Text>
            </Button>
            <Button
              variant="outline"
              accessibilityLabel={t("stars.kumpa.again")}
              onPress={() => {
                tap();
                picked.current = true;
                setSaved(NO_ORDER);
                setTurned(turnedRound());
                void saveLaterOrder(NO_ORDER);
              }}
            >
              <Text>{t("stars.kumpa.again")}</Text>
            </Button>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
