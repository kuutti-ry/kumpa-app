import type { StarredPerson } from "@kuutti/schema";
import { useRouter } from "expo-router";
import { type Ref, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
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

/** The card's own shape, three wide and four high (`card`, 800 x 1067). */
const PHOTO = { width: "100%", aspectRatio: 3 / 4 } as const;

function Pick({
  person,
  onPick,
  ref,
}: {
  person: StarredPerson;
  onPick: () => void;
  ref?: Ref<View>;
}) {
  const { t } = useT();
  const traits = useLookTraits();
  const { name, age, photo } = person;
  const who = t("profile.card.nameAge", { name, years: age });
  return (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={who}
      accessibilityHint={t("stars.kumpa.pick.hint")}
      className={cn("flex-1 gap-2 rounded-xl p-1", pressFill(traits))}
      style={MINIMUM_TARGET}
      onPress={onPick}
    >
      {photo ? (
        <View className="overflow-hidden rounded-lg" style={PHOTO}>
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
        <View className="rounded-lg border border-border bg-muted" style={PHOTO} {...DECORATIVE} />
      )}
      <Text className="font-semibold">{who}</Text>
    </Pressable>
  );
}

/**
 * Kumpa (the maintainer, 26/11/2026; ADR-064 §6): two people of the Later list
 * side by side, the main photo each was shown at the card's size, and a tap on
 * one puts them before the other, until everybody has a place (`later-order`).
 * The order is the person's own and stays on this phone; nothing here is sent
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
  const shown = pair?.flatMap((id) => {
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
          <View className="flex-row gap-3">
            {shown.map((person, index) => (
              <Pick
                key={person.id}
                person={person}
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
