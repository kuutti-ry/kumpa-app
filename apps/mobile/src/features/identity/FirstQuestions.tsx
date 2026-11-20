import { realLocale } from "@kuutti/i18n";
import type { Gender, ProfileFields } from "@kuutti/schema";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Platform, type ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { KeyboardScrollView } from "@/components/KeyboardScrollView";
import { StepProgress, StepTitle } from "@/components/step-heading";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import {
  GenderChips,
  IdentityLabelChips,
  NameEditor,
  PlacePicker,
  SeeksChips,
} from "@/features/profile";
import { useT } from "@/lib/locale";
import { useHapticTap } from "@/theme/haptics";
import { type HeldAnswers, holdAnswers } from "./held-answers";
import { LegalTextLink } from "./LegalTextLink";
import { bundledVersion, consentLocale } from "./onboarding/client";

type Question = "name" | "gender" | "identityLabel" | "seeks" | "home";

/** The four numbered questions; the identity label shares the gender's number. */
const NUMBERED: Question[] = ["name", "gender", "seeks", "home"];

/** Where a walk picks up again: the first question without an answer. */
function firstOpen(held: HeldAnswers | null): Question {
  if (!held?.name?.trim()) return "name";
  if (!held.gender) return "gender";
  if (!held.seeks || !held.specialCategory) return "seeks";
  return "home";
}

/**
 * The questions the app cannot be used without, before any login (#681,
 * ADR-010 §22): the name, the gender (and a label after non-binary), whom one
 * seeks with the consent for sensitive answers on the same screen (ADR-019
 * §4), and the home. None needs the server: the postal list is on the phone.
 * Each answer is held on the phone as Continue leaves its screen
 * (`holdAnswers`), so an app the system ends while the bank is open loses
 * none but the consent, which onboarding asks again, and nothing is sent: the
 * bank login saves them. The consent is the person's at the phone: the switch
 * goes off when the app leaves the screen, and turning it off withdraws what
 * was held. The arrow, and Android's back, go to the question before, and
 * from the first to the first screen.
 */
export function FirstQuestions({
  held,
  start,
  onHeld,
  onDone,
  onBack,
}: {
  held: HeldAnswers | null;
  /** The question to open on; the first unanswered one by default. */
  start?: Question;
  onHeld: (held: HeldAnswers) => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useT();
  const tap = useHapticTap();
  const [question, setQuestion] = useState<Question>(start ?? firstOpen(held));
  const [name, setName] = useState(held?.name ?? "");
  const [gender, setGender] = useState<Gender | null>(held?.gender ?? null);
  const [label, setLabel] = useState<ProfileFields["identityLabel"]>(held?.identityLabel);
  const [seeks, setSeeks] = useState<Gender[]>(held?.seeks ?? []);
  const [consented, setConsented] = useState(held?.specialCategory !== undefined);
  const [busy, setBusy] = useState(false);

  const previous = (): Question | null => {
    switch (question) {
      case "name":
        return null;
      case "gender":
        return "name";
      case "identityLabel":
        return "gender";
      case "seeks":
        return gender === "non_binary" ? "identityLabel" : "gender";
      case "home":
        return "seeks";
    }
  };
  const back = () => {
    const before = previous();
    if (before) setQuestion(before);
    else onBack();
  };
  const backRef = useRef(back);
  backRef.current = back;
  // Android's back key steps back as the arrow does; no other platform has the key, and the web warns at a listener.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      backRef.current();
      return true;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") setConsented(false);
    });
    return () => subscription.remove();
  }, []);

  // Each question starts at its top, as onboarding's steps do.
  const scroll = useRef<ScrollView>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [question]);

  /** Holds the answer, then goes on. */
  const hold = async (patch: Parameters<typeof holdAnswers>[0], next: Question | "done") => {
    tap();
    setBusy(true);
    try {
      onHeld(await holdAnswers(patch));
    } finally {
      setBusy(false);
    }
    if (next === "done") onDone();
    else setQuestion(next);
  };

  const position = NUMBERED.indexOf(question === "identityLabel" ? "gender" : question) + 1;
  const specialVersion = bundledVersion("special_category");

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <KeyboardScrollView ref={scroll} contentContainerClassName="flex-grow gap-4 p-6">
        <View className="flex-row items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            accessibilityLabel={t("signIn.stage.back")}
            onPress={() => {
              tap();
              back();
            }}
          >
            <Icon as={ArrowLeft} />
          </Button>
          <View className="flex-1">
            <StepProgress step={position} total={NUMBERED.length} />
          </View>
        </View>

        {question === "name" && (
          <View className="gap-4">
            <StepTitle>{t("onboarding.name.title")}</StepTitle>
            <NameEditor value={name} onChange={setName} />
            <Button
              onward
              disabled={busy || name.trim().length === 0}
              onPress={() => void hold({ name: name.trim() }, "gender")}
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {question === "gender" && (
          <View className="gap-4">
            <StepTitle>{t("onboarding.gender.title")}</StepTitle>
            <Text>{t("onboarding.gender.explain")}</Text>
            <GenderChips chosen={gender} onChoose={setGender} />
            <Button
              onward
              disabled={busy || gender === null}
              onPress={() => {
                if (!gender) return;
                // The label is offered after a non-binary gender only, by design (ADR-019 §1).
                const nonBinary = gender === "non_binary";
                if (!nonBinary) setLabel(undefined);
                void hold(
                  { gender, identityLabel: nonBinary ? label : undefined },
                  nonBinary ? "identityLabel" : "seeks",
                );
              }}
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {question === "identityLabel" && (
          <View className="gap-4">
            <StepTitle>{t("onboarding.identityLabel.title")}</StepTitle>
            <Text>{t("onboarding.identityLabel.explain")}</Text>
            <IdentityLabelChips chosen={label} onChange={setLabel} />
            <Button
              onward
              disabled={busy || label === undefined}
              onPress={() => void hold({ identityLabel: label }, "seeks")}
            >
              {t("onboarding.continue")}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onPress={() => {
                setLabel(undefined);
                void hold({ identityLabel: undefined }, "seeks");
              }}
            >
              {t("onboarding.identityLabel.skip")}
            </Button>
          </View>
        )}

        {question === "seeks" && (
          <View className="gap-4">
            <StepTitle>{t("onboarding.seeks.title")}</StepTitle>
            <Text>{t("onboarding.seeks.explain")}</Text>
            <SeeksChips chosen={seeks} onChange={setSeeks} />
            {/* Article 9: the consent on the screen that collects the answer (ADR-019 §4), held with it. */}
            <Card>
              <CardHeader>
                <CardTitle>{t("legal.special_category.title")}</CardTitle>
              </CardHeader>
              <CardContent className="gap-2">
                <Text>{t("legal.special_category.summary")}</Text>
                {/* The English binds, and only the Finnish is a translation of it (#208, ADR-010 §9). */}
                {realLocale(locale) === "fi" && (
                  <Text variant="muted">{t("onboarding.consents.binding")}</Text>
                )}
                <LegalTextLink kind="special_category" />
                <View className="flex-row items-center justify-between gap-3">
                  <Text variant="small" className="flex-1">
                    {t("onboarding.seeks.allow")}
                  </Text>
                  <Switch
                    accessibilityLabel={t("onboarding.seeks.allow")}
                    checked={consented}
                    disabled={busy}
                    onCheckedChange={(on) => {
                      tap();
                      setConsented(on);
                      if (!on && held?.specialCategory !== undefined) {
                        void holdAnswers({ specialCategory: undefined }).then(onHeld);
                      }
                    }}
                  />
                </View>
              </CardContent>
            </Card>
            <Button
              onward
              disabled={busy || seeks.length === 0 || !consented}
              onPress={() =>
                void hold(
                  {
                    seeks,
                    specialCategory: { version: specialVersion, locale: consentLocale(locale) },
                  },
                  "home",
                )
              }
            >
              {t("onboarding.continue")}
            </Button>
          </View>
        )}

        {question === "home" && (
          <View className="gap-4">
            <StepTitle>{t("onboarding.home.title")}</StepTitle>
            <Text>{t("profile.place.explain")}</Text>
            <PlacePicker busy={busy} onPick={(postalCode) => void hold({ postalCode }, "done")} />
          </View>
        )}
      </KeyboardScrollView>
    </SafeAreaView>
  );
}
