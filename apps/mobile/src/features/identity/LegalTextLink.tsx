import { CONSENT_VERSIONS, type LegalTextKind, legalLinkPath } from "@kuutti/i18n";
import ExternalLink from "lucide-react-native/icons/external-link";
import { Linking } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { apiBaseUrl } from "@/lib/api-url";
import { useT } from "@/lib/locale";

/**
 * The line under a legal summary (#208, ADR-010 §4): the version this app
 * carries, as a link to the full text on the website at the anchor of that
 * version. The summary is what the person accepts here; the site's text
 * binds, under the same version, and CI holds the two to one version
 * (`pnpm check:legal-versions`). The link is the API's `/legal/<page>`, which
 * sends the browser on to the site, so where the texts are published can
 * change without a build of the app (amendment of 2026-11-17). The browser
 * opens the public site, never a page of the product (rule 8), as the
 * source-code offer does.
 */
export function LegalTextLink({ kind, label: named }: { kind: LegalTextKind; label?: string }) {
  const { t } = useT();
  const version = CONSENT_VERSIONS[kind] ?? "";
  // The terms screen names the text alone (#681): the version is still the one opened and recorded.
  const label = named ?? t("onboarding.consents.fullText", { version });
  return (
    <Button
      variant="ghost"
      accessibilityRole="link"
      accessibilityLabel={label}
      className="self-start px-0"
      onPress={() => void Linking.openURL(`${apiBaseUrl()}${legalLinkPath(kind, version)}`)}
    >
      <Text className="shrink text-primary underline">{label}</Text>
      <Icon as={ExternalLink} className="text-primary" size={16} />
    </Button>
  );
}
