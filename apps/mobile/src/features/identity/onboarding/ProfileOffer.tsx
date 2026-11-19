import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { StepTitle } from "@/components/step-heading";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";

/**
 * The rest of the profile as an offer (#681, ADR-010 §22): after the bank and
 * what a card needs, once on this phone, the reason a fuller profile is worth
 * it in the maintainer's words, and the two ways on, the profile or home as
 * the profile is. It never comes back: no push, no badge, no prompt that
 * returns, since a reminder to finish a profile is engagement push (CLAUDE.md,
 * Product constraints); the profile's own screen carries the rest.
 */
export function ProfileOffer({ onFinish, onLater }: { onFinish: () => void; onLater: () => void }) {
  const { t } = useT();
  const tap = useHapticTap();
  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScrollView contentContainerClassName="flex-grow justify-center gap-6 p-6">
        <StepTitle>{t("onboarding.offer.title")}</StepTitle>
        <Text>{t("onboarding.offer.body")}</Text>
        <View className="gap-3">
          <Button
            onward
            onPress={() => {
              tap();
              onFinish();
            }}
          >
            {t("onboarding.offer.finish")}
          </Button>
          <Button
            variant="outline"
            onPress={() => {
              tap();
              onLater();
            }}
          >
            {t("onboarding.offer.later")}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
