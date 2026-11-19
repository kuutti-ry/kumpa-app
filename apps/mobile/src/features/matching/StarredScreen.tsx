import type { StarredPerson } from "@kuutti/schema";
import { useRouter } from "expo-router";
import ListMinus from "lucide-react-native/icons/list-minus";
import { Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { LoadFailed } from "@/components/LoadFailed";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { PhotoImage } from "@/features/media";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { DECORATIVE, MINIMUM_TARGET } from "@/theme/a11y";
import { useHapticTap } from "@/theme/haptics";
import { pressFill } from "@/theme/looks";
import { useLookTraits } from "@/theme/ThemeProvider";
import { useStars } from "./useStars";

function Row({ person, onClear }: { person: StarredPerson; onClear: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const traits = useLookTraits();
  const { name, age, photo } = person;
  const who = t("profile.card.nameAge", { name, years: age });
  return (
    <View className="flex-row items-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={who}
        className={cn("flex-1 flex-row items-center gap-3 rounded-lg px-2 py-2", pressFill(traits))}
        style={MINIMUM_TARGET}
        onPress={() => {
          tap();
          router.push(`/stars/${person.id}`);
        }}
      >
        {photo ? (
          <PhotoImage
            id={photo.id}
            variant="thumb"
            blurhash={photo.blurhash}
            accessibilityLabel={t("stars.photo.label", { name })}
            style={{ width: 48, height: 48, borderRadius: 24 }}
          />
        ) : (
          // The edge keeps the circle in the high-contrast sets, whose --muted is
          // the background itself (#467).
          <View className="h-12 w-12 rounded-full border border-border bg-muted" {...DECORATIVE} />
        )}
        <Text className="flex-1 font-semibold">{who}</Text>
      </Pressable>
      <Button
        variant="ghost"
        size="icon"
        accessibilityLabel={t("stars.clear.label", { name })}
        onPress={() => {
          tap();
          onClear();
        }}
      >
        <Icon as={ListMinus} />
      </Button>
    </View>
  );
}

/**
 * The Later list (#575, ADR-064, #681): the people the person chose Later on, the
 * latest first and in no other order, each with their name, their age and a photo
 * they were shown. A row opens the card, with Like, the flower and Pass, spending
 * what those spend anywhere else (`QueueScreen`), and its button takes the person
 * off the list, drawn as a list with a minus, never the cross that is Pass's. Only
 * the person ever sees it. Somebody the list leaves out goes with no word why, and
 * nothing counts them: no number and no order but when they were put on it.
 */
export function StarredScreen() {
  const { t } = useT();
  const { view, clearFailed, clear, retry } = useStars();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScreenHeader title={t("stars.title")} backLabel={t("stars.back")} />
      {clearFailed && (
        <Text accessibilityLiveRegion="polite" className="px-6 pt-4">
          {t("load.failed.press")}
        </Text>
      )}
      <ScrollView contentContainerClassName="flex-grow gap-4 p-6">
        {view.status === "loading" && (
          <Text accessibilityLiveRegion="polite">{t("load.loading")}</Text>
        )}
        {view.status === "failed" && <LoadFailed error={view.error} onRetry={retry} />}
        {view.status === "ready" && view.items.length === 0 && <Text>{t("stars.none")}</Text>}
        {view.status === "ready" && view.items.length > 0 && (
          <View className="gap-1">
            {view.items.map((person) => (
              <Row key={person.id} person={person} onClear={() => void clear(person.id)} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
