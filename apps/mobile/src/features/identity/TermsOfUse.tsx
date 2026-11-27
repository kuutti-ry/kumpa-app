import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { LegalTextLink } from "./LegalTextLink";

/**
 * The terms and the privacy notice as a person accepts them (#681, ADR-010
 * §22): the rules in one line, that an account that breaks them may go, what
 * the press accepts, and the two texts as links, at the versions this app
 * carries, where their summaries were. Before the bank, after the questions,
 * it opens on why the login comes now (`saving`); onboarding's welcome step
 * shows it too, when the acceptances did not land or a wording changed since.
 * The caller draws the button.
 */
export function TermsOfUse({ saving }: { saving: boolean }) {
  const { t } = useT();
  return (
    <View className="gap-4">
      <Text variant="h1" accessibilityRole="header">
        {t("signIn.agree.title")}
      </Text>
      {saving && <Text>{t("signIn.agree.save")}</Text>}
      <Text>{t("signIn.agree.rules")}</Text>
      <Text>{t("signIn.agree.removal")}</Text>
      <Text>{t("signIn.agree.accept")}</Text>
      <View>
        <LegalTextLink kind="terms" label={t("signIn.agree.useLink")} />
        <LegalTextLink kind="privacy" label={t("signIn.agree.noticeLink")} />
      </View>
    </View>
  );
}
