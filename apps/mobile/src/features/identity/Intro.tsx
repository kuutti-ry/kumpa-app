import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";

/**
 * The app's first screen for somebody signed out (#681, ADR-010 §22): what
 * Kumpa is and why it asks for a bank ID, that it is for adults, and that the
 * answers stay on the phone until there is an account, with one button to
 * start. No legal text. Somebody with an account goes past the questions by
 * the quieter button. While answers wait on the phone (within their hour),
 * the button goes on from them, and Start over removes them, for the next
 * person on a shared phone too.
 */
export function Intro({
  resuming,
  onStart,
  onStartOver,
  onHaveAccount,
}: {
  resuming: boolean;
  onStart: () => void;
  onStartOver: () => void;
  onHaveAccount: () => void;
}) {
  const { t } = useT();
  const tap = useHapticTap();
  const press = (then: () => void) => () => {
    tap();
    then();
  };
  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScrollView contentContainerClassName="flex-grow justify-center gap-6 p-6">
        <Text variant="h1" accessibilityRole="header">
          {t("signIn.start.title")}
        </Text>
        <View className="gap-3">
          <Text>{t("signIn.start.verified")}</Text>
          <Text>{t("signIn.start.bankId")}</Text>
          <Text>{t("signIn.start.free")}</Text>
          <Text variant="muted">{t("signIn.start.phoneOnly")}</Text>
        </View>
        <View className="gap-3">
          <Button onward onPress={press(onStart)}>
            {t(resuming ? "signIn.start.resume" : "signIn.start.begin")}
          </Button>
          {resuming && (
            <Button variant="outline" onPress={press(onStartOver)}>
              {t("signIn.start.over")}
            </Button>
          )}
          <Button variant="ghost" onPress={press(onHaveAccount)}>
            {t("signIn.start.haveAccount")}
          </Button>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
