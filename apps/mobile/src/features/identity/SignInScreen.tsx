import { formatDate, type PlainMessageKey, realLocale, sanctionStatement } from "@kuutti/i18n";
import { SanctionReason } from "@kuutti/schema";
import { useFocusEffect, useRouter } from "expo-router";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Linking, Platform, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { apiBaseUrl, codeOf } from "@/lib/api";
import { useT } from "@/lib/locale";
import { markLoginStarted, takeLoginStarted } from "@/lib/session";
import { useHapticTap } from "@/theme/haptics";
import {
  agreedOnThisPhone,
  agreementsOf,
  bindAgreements,
  dropAgreements,
  dropUnboundAgreements,
  heldAgreements,
  holdAgreements,
  recordAgreements,
  takeAgreements,
} from "./agreements";
import { FirstQuestions } from "./FirstQuestions";
import {
  answeredAll,
  bindHeldAnswers,
  dropHeldAnswers,
  dropUnboundConsent,
  type HeldAnswers,
  readHeldAnswers,
  releaseConsent,
  takeHeldAnswers,
} from "./held-answers";
import { Intro } from "./Intro";
import { saveHeldAnswers } from "./onboarding/save-held";
import { useSession } from "./session";
import { TermsOfUse } from "./TermsOfUse";
import { challengeOf, newVerifier } from "./verifier";

/**
 * What the deep link `fi.kumpa://auth` may carry: a one-time code, or the
 * refusal's code, its date, and a suspension's or a ban's reason (#715).
 */
export type SignInParams = { code?: string; error?: string; until?: string; reason?: string };

type Failure = { code: string; until?: string; reason?: string };

type Phase = { kind: "idle" } | { kind: "exchanging" } | ({ kind: "error" } & Failure);

/**
 * Where a person signed out stands (#681, ADR-010 §22): what Kumpa is, the
 * questions, the terms, the bank. `reading` while the phone is asked for
 * answers held from before.
 */
type Stage = "reading" | "intro" | "questions" | "terms" | "identify";

/** A newcomer walks the questions; somebody with an account goes past them. */
type Path = "new" | "account";

/** The refusals a sanction explains (#715, ADR-073 §1): their reason, when the link carries one. */
const SANCTIONED = new Set(["auth_suspended", "auth_banned"]);

/**
 * The refusals with a fact of their own, the API's through the deep link and
 * the app's own, each with its text. Anything else, a link gone stale or a
 * failure on the way, is one thing, it did not work, go again, which the card's
 * title and Try again say (#581). A Map, so a crafted link (`?error=toString`)
 * finds nothing rather than a prototype member. The sign-in's rate limit
 * refuses a start through the link and an exchange with a 429 (ADR-026 §4):
 * one text for both, since both ask for the same wait.
 */
const REFUSALS: ReadonlyMap<string, PlainMessageKey> = new Map([
  ["auth_under_18", "signIn.error.auth_under_18"],
  ["auth_banned", "signIn.error.auth_banned"],
  ["auth_suspended", "signIn.error.auth_suspended"],
  ["auth_cancelled", "signIn.error.auth_cancelled"],
  ["auth_rate_limited", "signIn.error.auth_rate_limited"],
  ["rate_limited", "signIn.error.auth_rate_limited"],
  ["unexpected_link", "signIn.error.unexpected_link"],
  ["attestation_refused", "signIn.error.attestation_refused"],
]);

/**
 * The refusals that rest on the person, not on the attempt: another try today
 * only repeats them, and every try is a bank identification (#466). Their
 * button says what it does rather than that trying again may help, and it
 * stays, since the phone may be somebody else's.
 */
const LASTING_REFUSALS: ReadonlySet<string> = new Set([
  "auth_under_18",
  "auth_banned",
  "auth_suspended",
  "auth_cooldown",
]);

/**
 * The way in for somebody signed out (#681, ADR-010 §22): what Kumpa is
 * (`Intro`), the questions the app cannot be used without, held on the phone
 * (`FirstQuestions`), the terms and the privacy notice (`TermsOfUse`), then
 * the bank login, which saves the answers. Somebody with an account goes from
 * the first screen to the bank, through the terms where this phone has not
 * recorded them; the lock's and a break's notices, a refusal and a code
 * coming back open on the bank's screen.
 *
 * The bank login's two halves on the phone (#36, rules/mobile.md Auth): the
 * button opens the API's /auth/start in the system browser (never a WebView:
 * the bank's cookies stay out of the app), and the return through the deep
 * link lands here with a one-time code that becomes this device's session.
 * Only a code for a login this device started is exchanged, and never over a
 * session that exists: a link someone else minted is refused (login CSRF).
 * The code is bound to this phone too: the start carries the SHA-256 of a
 * verifier kept with the mark, and the exchange sends the verifier, so a code
 * another app reads off the link is refused without it (ADR-027).
 * The API's language follows the browser's, which follows the phone.
 * The bank is reached only past the terms and the privacy notice (#418,
 * ADR-010 §15): accepted in this run, or recorded by this phone before for
 * somebody with an account. The acceptances and the answers go with one
 * attempt, and become the account's rows right after the exchange, before the
 * screen goes home, where the account is first read (#681, ADR-010 §22).
 */
export function SignInScreen({ code, error, until, reason }: SignInParams) {
  const { t, locale } = useT();
  const session = useSession();
  const router = useRouter();
  const tap = useHapticTap();
  const [phase, setPhase] = useState<Phase>(() =>
    error ? { kind: "error", code: error, until, reason } : { kind: "idle" },
  );
  // A code is exchanged once, however often the screen re-renders with it.
  const exchanged = useRef<string | null>(null);
  const { signIn } = session;
  // A notice, a refusal or a code is about the bank: the screen opens there.
  const notice = session.status === "signed-out" ? session.notice : undefined;
  const [stage, setStage] = useState<Stage>(() =>
    code || error || notice ? "identify" : "reading",
  );
  const [path, setPath] = useState<Path>(() => (code || error || notice ? "account" : "new"));
  // A notice that comes while the screen is up (the lock's way out, a break
  // begun here) is about the bank too, and is never left behind the first screen.
  useEffect(() => {
    if (!notice) return;
    setStage("identify");
    setPath("account");
  }, [notice]);
  const [held, setHeld] = useState<HeldAnswers | null>(null);
  // Back from the terms opens the last question, not the first.
  const [questionsFrom, setQuestionsFrom] = useState<"home" | undefined>(undefined);
  // Read once, as the screen opens. The bank's return opens a screen of its
  // own (`/auth`): answers carried into a bank attempt are then the person's
  // who went there, and go with the next try (#681). A refusal that lasts
  // removes them (below), so there is nothing to read.
  const returning = code !== undefined || error !== undefined;
  const lasting = error !== undefined && LASTING_REFUSALS.has(error);
  const opening = useRef({ returning, lasting });
  useEffect(() => {
    let live = true;
    const { returning: back, lasting: gone } = opening.current;
    void (gone ? Promise.resolve(null) : readHeldAnswers()).then((answers) => {
      if (!live) return;
      setHeld(answers);
      if (back && answers?.attempt !== undefined) setPath("new");
      setStage((now) => (now === "reading" ? "intro" : now));
    });
    return () => {
      live = false;
    };
  }, []);
  // The store can lose the answers under this screen: their hour runs out, or
  // the bank's screen over it removes them at a refusal that lasts. Read again
  // when the screen has the focus back and when the app does, and nothing of
  // them shows once they went. A read only ever clears here, so one that
  // finishes after a removal brings nothing back.
  const heldNow = useRef(held);
  heldNow.current = held;
  const recheck = useCallback(() => {
    void readHeldAnswers().then((answers) => {
      if (answers !== null || heldNow.current === null) return;
      setHeld(null);
      setStage((now) => (now === "questions" ? "intro" : now));
    });
  }, []);
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) recheck();
      focusedOnce.current = true;
    }, [recheck]),
  );
  // Acceptances and the consent for sensitive answers not yet carried to the
  // bank end when the app leaves the screen (#418, #681): whoever comes back
  // gives them. The answers are kept on the phone, within their hour.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active") recheck();
      if (next !== "background") return;
      dropUnboundAgreements();
      if (dropUnboundConsent()) {
        setHeld((now) => (now === null ? null : { ...now, specialCategory: undefined }));
      }
    });
    return () => subscription.remove();
  }, [recheck]);

  // A refusal can arrive while this screen is shown: the button opens the
  // browser from here, and the link comes back to the same screen with its
  // answer, which the first state alone would miss.
  // A refusal also ends the acceptances held for that attempt (#418), and
  // one that lasts the answers too (#681): another try only repeats it. After
  // any other, the consent may go with the next try.
  useEffect(() => {
    if (!error) return;
    setPhase({ kind: "error", code: error, until, reason });
    setStage("identify");
    dropAgreements();
    if (LASTING_REFUSALS.has(error)) {
      void dropHeldAnswers();
      setHeld(null);
    } else releaseConsent();
  }, [error, until, reason]);

  const status = session.status;
  useEffect(() => {
    if (!code || status === "loading" || exchanged.current === code) return;
    exchanged.current = code;
    setPhase({ kind: "exchanging" });
    setStage("identify");
    void (async () => {
      const verifier = await takeLoginStarted();
      if (!verifier || status === "signed-in") {
        setPhase({ kind: "error", code: "unexpected_link" });
        return;
      }
      const attempt = challengeOf(verifier);
      try {
        await signIn(code, verifier);
        // Before the status is read: home reads it only once it has the focus,
        // which the replace below gives it, so onboarding finds these saved.
        const agreements = takeAgreements(attempt);
        if (agreements) await recordAgreements(agreements);
        await saveHeldAnswers(await takeHeldAnswers(attempt));
        // "Signing you in…" stands until the next screen takes over, home or the first open step (#581).
        router.replace("/");
      } catch (failure: unknown) {
        setPhase({
          kind: "error",
          code: codeOf(failure) || "generic",
        });
        dropAgreements();
        releaseConsent();
      }
    })();
  }, [code, status, signIn, router]);

  const back = () => {
    if (stage === "identify") setStage(path === "new" ? "terms" : "intro");
    else if (stage === "terms" && path === "new") {
      setQuestionsFrom("home");
      setStage("questions");
    } else setStage("intro");
    setPhase({ kind: "idle" });
  };
  // Android's back key steps back through the screens before the bank, and leaves the app from the
  // first; no other platform has the key, and the web warns at a listener.
  const backRef = useRef(back);
  backRef.current = back;
  const stepsBack = stage === "terms" || stage === "identify";
  useEffect(() => {
    if (!stepsBack || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      backRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [stepsBack]);

  /** Somebody with an account: the bank, through the terms unless this phone recorded them. */
  const haveAccount = async () => {
    setPath("account");
    setStage(heldAgreements() !== null || (await agreedOnThisPhone()) ? "identify" : "terms");
  };

  const open = async () => {
    tap();
    // Never past the terms: accepted in this run, or for somebody with an
    // account recorded by this phone before; otherwise back to them.
    const recorded = path === "account" && (await agreedOnThisPhone());
    if (heldAgreements() === null && !recorded) {
      setStage("terms");
      setPhase({ kind: "idle" });
      return;
    }
    // The browser covers the screen as it opens, so a refusal shown just goes (#581).
    setPhase({ kind: "idle" });
    // What the last link said is put away, so that the next one is news even
    // when it says the same: the same refusal twice is two refusals.
    router.setParams({ code: undefined, error: undefined, until: undefined, reason: undefined });
    try {
      // A verifier for this attempt alone: a second tap replaces the first's,
      // and a code from the first's browser tab is refused (ADR-027).
      const verifier = newVerifier();
      const now = Date.now();
      // The acceptances go with this attempt; carried into another already,
      // they are asked again.
      if (heldAgreements() !== null && !bindAgreements(challengeOf(verifier), now)) {
        if (!recorded) setStage("terms");
        return;
      }
      // So do a newcomer's answers: only this attempt's exchange saves them.
      // A consent another attempt carried is no longer held: the screen shows so.
      if (path === "new") {
        await bindHeldAnswers(challengeOf(verifier), now);
        setHeld(await readHeldAnswers(now));
      }
      await markLoginStarted(verifier, now);
      // The bank's chooser in the app's language, which can differ from the
      // phone's and so from the browser's (#55); en-XA asks for English, Stadi
      // for Finnish.
      const bankLocale = realLocale(locale);
      await Linking.openURL(
        `${apiBaseUrl()}/auth/start?platform=${Platform.OS}&locale=${bankLocale}&code_challenge=${challengeOf(verifier)}`,
      );
    } catch {
      setPhase({ kind: "error", code: "generic" });
    }
  };
  const refusalText = (failure: Failure): string | null => {
    const day = failure.until ? new Date(failure.until) : null;
    const valid = day !== null && !Number.isNaN(day.getTime());
    if (failure.code === "auth_cooldown") {
      return t("signIn.error.auth_cooldown", { date: valid ? formatDate(locale, day) : "" });
    }
    // A suspension ends at the start of a day in Finland (ADR-024 §5): that
    // day, read in Finland's zone, so a phone abroad names the same one.
    // Without a day the plain sentence, as an older API sends it.
    if (failure.code === "auth_suspended" && valid) {
      return t("signIn.error.auth_suspended_until", {
        date: formatDate(locale, day, { timeZone: "Europe/Helsinki" }),
      });
    }
    const words = REFUSALS.get(failure.code);
    return words ? t(words) : null;
  };
  const refusal = phase.kind === "error" ? refusalText(phase) : null;
  // Why a suspension or a ban, the rule it rests on and how to contest it
  // (#715, ADR-073 §1): only a reason of the closed list, so a crafted link
  // shows nothing more; a moderator always decided these two.
  const sanctionReason =
    phase.kind === "error" && SANCTIONED.has(phase.code)
      ? SanctionReason.safeParse(phase.reason)
      : null;
  const statement = sanctionReason?.success ? sanctionStatement(t, sanctionReason.data) : [];

  const buttonText =
    phase.kind === "error" && !LASTING_REFUSALS.has(phase.code)
      ? t("load.retry")
      : t("signIn.button");

  if (stage === "reading") return <SafeAreaView className="flex-1 bg-background" />;
  if (stage === "intro") {
    return (
      <Intro
        resuming={held !== null}
        onStart={() => {
          setPath("new");
          setQuestionsFrom(undefined);
          setStage(answeredAll(held) ? "terms" : "questions");
        }}
        onStartOver={() => {
          // The next person on a shared phone too: nothing of the last one's is carried on.
          void dropHeldAnswers();
          dropAgreements();
          setHeld(null);
          setPath("new");
          setQuestionsFrom(undefined);
          setStage("questions");
        }}
        onHaveAccount={() => void haveAccount()}
      />
    );
  }
  if (stage === "questions") {
    return (
      <FirstQuestions
        held={held}
        start={questionsFrom}
        onHeld={setHeld}
        onDone={() => setStage("terms")}
        onBack={() => setStage("intro")}
      />
    );
  }

  const backArrow = (
    <Button
      variant="ghost"
      size="icon"
      accessibilityLabel={t("signIn.stage.back")}
      className="self-start"
      onPress={() => {
        tap();
        back();
      }}
    >
      <Icon as={ArrowLeft} />
    </Button>
  );

  if (stage === "terms") {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <Backdrop />
        <ScrollView contentContainerClassName="flex-grow gap-4 p-6">
          {backArrow}
          <TermsOfUse saving={path === "new"} />
          <Button
            onward
            onPress={() => {
              tap();
              holdAgreements(agreementsOf(locale));
              setStage("identify");
            }}
          >
            {t("signIn.agree.button")}
          </Button>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScrollView contentContainerClassName="flex-grow items-center justify-center gap-4 p-6">
        {phase.kind !== "exchanging" && <View className="w-full max-w-md">{backArrow}</View>}
        <View className="w-full max-w-md gap-3">
          <Text variant="h1" accessibilityRole="header">
            {t("signIn.identify.title")}
          </Text>
          <Text>{t("signIn.identify.why")}</Text>
          <Text>{t("signIn.identify.notPayment")}</Text>
          <Text>{t("signIn.identify.kept")}</Text>
        </View>

        {/* Right after the lock signed this phone out (#418): why, and that the lock is off now. */}
        {session.status === "signed-out" && session.notice === "lock" && (
          <Card className="w-full max-w-md">
            <View accessibilityLabel={t("signIn.lock.title")} className="gap-6">
              <CardHeader>
                <CardTitle>{t("signIn.lock.title")}</CardTitle>
                <CardDescription>{t("signIn.lock.body")}</CardDescription>
              </CardHeader>
            </View>
          </Card>
        )}

        {/* Right after a break began on this device (#170): why the sign-in is back. */}
        {session.status === "signed-out" && session.notice === "paused" && (
          <Card className="w-full max-w-md">
            <View accessibilityLabel={t("signIn.paused.title")} className="gap-6">
              <CardHeader>
                <CardTitle>{t("signIn.paused.title")}</CardTitle>
              </CardHeader>
            </View>
          </Card>
        )}

        {phase.kind === "error" && (
          <Card className="w-full max-w-md">
            {/* The words carry the state; the colour only repeats it. */}
            <View accessibilityLabel={t("signIn.error.title")} className="gap-6">
              <CardHeader>
                <CardTitle className="text-destructive">{t("signIn.error.title")}</CardTitle>
                {refusal !== null && <CardDescription>{refusal}</CardDescription>}
                {statement.map((line) => (
                  <CardDescription key={line}>{line}</CardDescription>
                ))}
              </CardHeader>
            </View>
          </Card>
        )}

        {phase.kind === "exchanging" && (
          <Card className="w-full max-w-md">
            <CardContent>
              <Text accessibilityLiveRegion="polite">{t("signIn.exchanging")}</Text>
            </CardContent>
          </Card>
        )}

        {/* The bank sends the browser back to the app's scheme, which a web
            page does not have (AuthPlatform): no button that cannot work. */}
        {Platform.OS === "web" && (
          <Text className="w-full max-w-md text-center">{t("signIn.unavailable")}</Text>
        )}

        {Platform.OS !== "web" && phase.kind !== "exchanging" && (
          <Button
            accessibilityLabel={buttonText}
            className="w-full max-w-md"
            // Never past the terms: a refusal shown on a phone that has not
            // accepted them goes back to them first (`open`).
            onPress={() => void open()}
          >
            <Text>{buttonText}</Text>
          </Button>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
