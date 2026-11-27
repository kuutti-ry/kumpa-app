import { realLocale } from "@kuutti/i18n";
import { POSTAL_AREAS_CREDIT } from "@kuutti/schema/postal-areas";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { RowGroup } from "@/components/RowGroup";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { IMAGE_CREDITS } from "./image-credits";
import { LICENCES } from "./licences";
import { licenseGroups } from "./license-families";
import { SettingsPage } from "./SettingsPage";
import { TYPEFACE_CREDIT, useCarriesSaiga } from "./typeface-credit";

const GROUPS = licenseGroups(LICENCES.packages);

/**
 * The packages whose code ships in this build, with their licences
 * (scripts/licenses.ts), in every build (#177, #287): in families by name,
 * each under a heading a screen reader can jump between (#376). Each package
 * is a row that opens nothing (#512), its name, then who provides it, its
 * version and its licence, read together as one sentence; a package that
 * names nobody has no provider. The data the app carries follows the
 * packages (ADR-061 §4): where it comes from, on what terms and what Kuutti
 * changed, as the list itself says it, in Finnish or English, and CC BY 4.0
 * asks no more languages. The images whose terms ask for credit follow the
 * data (#405), each set read as one sentence: who made it, where it was
 * found, and its licence with the licence's address. The typeface follows
 * the images, in a build that carries it: Saiga and its designer (#405). The
 * texts the licences ask to go with every copy are behind the last row.
 */
export function LicensesScreen() {
  const { t, locale } = useT();
  const router = useRouter();
  const tap = useHapticTap();
  const saiga = useCarriesSaiga();
  const credit = realLocale(locale) === "fi" ? POSTAL_AREAS_CREDIT.fi : POSTAL_AREAS_CREDIT.en;
  return (
    <SettingsPage title={t("tech.licenses.title")}>
      {GROUPS.map((group) => (
        <View key={group.family ?? "other"} className="gap-2">
          <Text variant="h3" accessibilityRole="header">
            {group.family ?? t("tech.licenses.other")}
          </Text>
          <RowGroup
            rows={group.entries.map(({ name, provider, version, license }) => ({
              key: `${name}@${version}`,
              title: name,
              summary: provider
                ? t("tech.licenses.provided", { provider, version, license })
                : t("tech.licenses.version", { version, license }),
            }))}
          />
        </View>
      ))}
      <View className="gap-2">
        <Text variant="h3" accessibilityRole="header">
          {t("tech.licenses.data")}
        </Text>
        <RowGroup
          rows={[
            {
              key: "postal-areas",
              title: t("tech.licenses.postalAreas"),
              summary: `${credit.source} ${credit.changes}`,
            },
          ]}
        />
      </View>
      <View className="gap-2">
        <Text variant="h3" accessibilityRole="header">
          {t("tech.licenses.images")}
        </Text>
        <RowGroup
          rows={IMAGE_CREDITS.map(({ title, author, source, licence, licenceUrl }) => ({
            key: title,
            title: t(title),
            summary: t("tech.licenses.credit", { author, source, licence, licenceUrl }),
          }))}
        />
      </View>
      {saiga && (
        <View className="gap-2">
          <Text variant="h3" accessibilityRole="header">
            {t("tech.licenses.typeface")}
          </Text>
          <RowGroup
            rows={[
              {
                key: "saiga",
                title: TYPEFACE_CREDIT.name,
                summary: t("tech.licenses.typefaceCredit", {
                  designer: TYPEFACE_CREDIT.designer,
                  foundry: TYPEFACE_CREDIT.foundry,
                }),
              },
            ]}
          />
        </View>
      )}
      <RowGroup
        rows={[
          {
            key: "texts",
            title: t("tech.licenses.texts"),
            onPress: () => {
              tap();
              router.push("/settings/licenses/texts");
            },
          },
        ]}
      />
    </SettingsPage>
  );
}
