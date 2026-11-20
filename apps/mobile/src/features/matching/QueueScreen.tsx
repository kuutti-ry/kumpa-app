import type { PlainMessageKey } from "@kuutti/i18n";
import type { QueueChoice, QueueReason } from "@kuutti/schema";
import { useFocusEffect, useRouter } from "expo-router";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import Star from "lucide-react-native/icons/star";
import Undo2 from "lucide-react-native/icons/undo-2";
import { type ReactNode, type Ref, useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Backdrop } from "@/components/backdrop";
import { LoadFailed } from "@/components/LoadFailed";
import { useSpokenOnIos } from "@/components/Notice";
import { ScreenHeader } from "@/components/ScreenHeader";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { CachedPhoto, OwnPhoto, photoRefusalKey } from "@/features/media";
import { fieldLabelKey, ProfileCardView, SEEK_PATH } from "@/features/profile";
import { useDecisionButtons } from "@/lib/decision-buttons";
import { useT } from "@/lib/locale";
import { cn } from "@/lib/utils";
import { focusOnMount } from "@/theme/a11y";
import { useHapticTap } from "@/theme/haptics";
import { HARD_SHADOW, useHardShadow, useLift } from "@/theme/shadow";
import { useLookTraits, useTheme } from "@/theme/ThemeProvider";
import { useReducedMotion } from "@/theme/useReducedMotion";
import { Dandelion } from "./dandelion";
import { DECISION_ICONS, type DecisionIcons } from "./faceButtons";
import { MatchHello } from "./MatchHello";
import { MatchPop } from "./MatchPop";
import { ShortPool } from "./ShortPool";
import { StarsButton } from "./StarsButton";
import { type QueueCard, useQueue } from "./useQueue";

/**
 * Why a card is in the queue, in words (TD-12): the label every card carries,
 * never a score. A relaxed card says the deal-breaker it came in by instead,
 * which the database holds it to (queue_entry' check, #581).
 */
const REASON: Readonly<Record<Exclude<QueueReason, "relaxed">, PlainMessageKey>> = {
  matches_filters: "queue.reason.matches_filters",
  liked_you: "queue.reason.liked_you",
  seen_before: "queue.reason.seen_before",
  fish: "queue.reason.fish",
};

/** The line above a card Undo brought back, by the decision it holds (ADR-034 §5). */
const REVISIT: Readonly<Record<QueueChoice, PlainMessageKey>> = {
  like: "queue.revisit.like",
  pass: "queue.revisit.pass",
  skip: "queue.revisit.skip",
  fish: "queue.revisit.fish",
};

/** A card that answers somebody's like takes a like back, never a fish (ADR-039 §2). */
const ANSWERS_A_LIKE: ReadonlySet<QueueReason> = new Set(["liked_you", "fish"]);

/**
 * From this OS font scale, Undo in the header is its icon alone (#467, the
 * maintainer's of 28/10/2026): its word grows with the text and the title
 * beside it shrinks to fit, below body text from x1.45 on a 360 pt phone in
 * Finnish. Android's 130 % and iOS's largest standard size. It keeps its
 * spoken label and its 44 pt target; one-handed, at the thumb, it keeps its
 * word, having the room.
 */
const WORDLESS_UNDO_FONT_SCALE = 1.3;

/**
 * How what floats over the card stands off it (#681): a drawn button in a style
 * of hard shadows keeps its own, and everything else, a drawn button elsewhere
 * and the plain pieces with the ground's fill, takes the lift.
 */
function useFloat(): { drawn: ViewStyle | undefined; plain: ViewStyle } {
  const { ink } = useLookTraits();
  const lift = useLift();
  const hard = useHardShadow(HARD_SHADOW.control);
  return { drawn: ink ? undefined : lift, plain: ink ? hard : lift };
}

/**
 * The queue (#379, #502, ADR-034, ADR-062): one card at a time through the card
 * others see (#47), with why it is there above it, and Block or report on it
 * (ADR-030 §11), as far as the person likes, to the end of who fits them. Like
 * and pass are buttons at the bottom, never a swipe: pass an outlined rectangle
 * at the left, like a filled pill at the right, each with its word and its
 * icon, no red and green; the flower, the fish until #681 (#378), a like with
 * a mark, a filled rounded square above them, on a card that answers nobody's
 * like, while one can go today and on the card that holds it (#475): once the
 * week's is sent it is left out, as on a liked-you card, and nothing says when
 * the next comes, which is Monday's (the maintainer's of 29/10/2026). Later,
 * beside the flower, moves on, costs nobody anything (ADR-062 §3) and puts the
 * person on the Later list (#681, ADR-064): the first there says that only the
 * person sees it, and at the most the list may hold a line says the card comes
 * back another day. Beside them the bar says in words how many of the day's
 * likes are left (#524). The bar floats over the card, which scrolls under it
 * and whose end scrolls clear (#681). Undo in the header brings the last card
 * back. Where they sit is the person's (#82): for the right hand as above, or
 * mirrored for the left; and one-handed, Undo, the flower, Later, Pass and Like
 * in one column at the bottom on that side, Undo brought down from the header,
 * within a thumb's reach. A like that makes a match says so and leads to the
 * conversation; one refused over the conversations waiting says how many, and
 * the card stays (ADR-062 §5). In the designers' try (the tech screen's
 * neubrutalism or Organic Pop, outside production) the match is a hello
 * instead, `MatchHello` or `MatchPop`, with the same two ways on. The queue's
 * end says so, with no count and nothing about tomorrow, which in a thin set
 * would be false for a month; then the way to the Later list while it shows
 * somebody, what may be relaxed for today (#99, ADR-042), and one plain way
 * into What you seek, the same words for everybody (ADR-062 §11). Each relaxed
 * card says the deal-breaker it came in by and undoes it in one tap, and every
 * card names the person's deal-breakers its person did not answer.
 *
 * Given `star`, the id of one on the Later list, the screen is that one card,
 * and what comes after it is the way back to the list.
 *
 * As a card, the end or a match takes the place of what had the focus, the
 * screen reader is taken to its first line, and from a card of the Later list
 * that is gone, to the way back (#581); a notice is spoken where it appears,
 * under the header, in sight however far the card was scrolled.
 */
export function QueueScreen({ star }: { star?: string }) {
  const { t } = useT();
  const { poster } = useLookTraits();
  const router = useRouter();
  const tap = useHapticTap();
  const queue = useQueue(star);
  const { view, current, notice, match } = queue;
  // A photo URL the API refused (the day's photos, #52), for the card it was
  // refused on, by its day and place: a new day's card there starts without it.
  const [refused, setRefused] = useState<{ day: string; position: number; code: string } | null>(
    null,
  );

  // The conversation is pushed over the queue, which stays mounted under it:
  // the match stays in front of the next card until the queue is in sight
  // again, so that card is neither shown nor reported seen meanwhile (ADR-034 §2).
  const away = useRef(false);
  const { closeMatch } = queue;
  useFocusEffect(
    useCallback(() => {
      if (!away.current) return;
      away.current = false;
      closeMatch();
    }, [closeMatch]),
  );

  const words =
    notice === null
      ? null
      : typeof notice === "string"
        ? t(notice)
        : t("queue.yourTurn.refused", notice);
  useSpokenOnIos(words);
  // A read past the last card takes the place of the button the focus was on: iOS
  // has no live region for the line to speak through.
  useSpokenOnIos(queue.readingOn ? t("load.loading") : null);

  const entries = view.status === "ready" ? view.queue.entries : undefined;
  const entry = current?.entry;
  // The card the last like or fish went to: the one a match is with, for the
  // try's hello, which shows its person beside the reader.
  const [liked, setLiked] = useState<QueueCard | null>(null);
  const choose = (card: QueueCard, decision: QueueChoice) => {
    tap();
    if (decision === "like" || decision === "fish") setLiked(card);
    void queue.choose(card, decision);
  };
  // The designers' try (outside production): a match is a hello. Read here, long
  // before a match, so the setting is known when the hello mounts.
  const still = useReducedMotion();
  const { moment } = useLookTraits();
  const { highContrast } = useTheme();
  const hello = moment !== "plain" && match !== null ? liked?.entry.card : undefined;
  const helloPhoto = hello?.photos[0];
  // The pill styles' hello is Sini's, its way on a pill of the accent colour.
  // High contrast makes the accent the background's colour, which would leave
  // the way on as bare words, so there it is the plain button.
  const pop = hello !== undefined && moment === "pop";
  const lime = pop && !highContrast;
  const Hello = pop ? MatchPop : MatchHello;

  // Where the decision buttons sit (#82): for the right hand or the left,
  // and one-handed in a column on that side with Undo among them.
  const { settings: placement } = useDecisionButtons();
  const float = useFloat();
  // The floating bar's height, which the card's end scrolls clear of (#681).
  const [barHeight, setBarHeight] = useState(0);
  const { fontScale } = useWindowDimensions();
  // Android sends its scale as a float: 130 % arrives as 1.2999999523.
  const wordless = !placement.oneHanded && fontScale >= Math.fround(WORDLESS_UNDO_FONT_SCALE);
  const undo = queue.canUndo && (
    <Button
      variant="ghost"
      size={wordless ? "icon" : "default"}
      className={cn(placement.oneHanded && "w-full rounded-full")}
      accessibilityLabel={t("queue.undo.label")}
      onPress={() => {
        tap();
        queue.undo();
      }}
    >
      <Icon as={Undo2} />
      {!wordless && <Text>{t("queue.undo")}</Text>}
    </Button>
  );
  // The decisions over a card, or one-handed Undo alone once none is left.
  const floating =
    match === null &&
    ((current && view.status === "ready") || (!current && placement.oneHanded && !!undo));
  const backToStars = (ref?: Ref<View>) => (
    <Button
      ref={ref}
      variant="outline"
      onPress={() => {
        tap();
        router.back();
      }}
    >
      {t("stars.card.back")}
    </Button>
  );

  return (
    <SafeAreaView className="flex-1 bg-background">
      <Backdrop />
      <ScreenHeader
        title={t(star ? "stars.title" : "queue.title")}
        backLabel={t(star ? "stars.card.back" : "queue.back")}
      >
        {!placement.oneHanded && undo}
      </ScreenHeader>
      {words !== null && (
        <Text accessibilityLiveRegion="polite" className="px-6 pt-4">
          {words}
        </Text>
      )}
      <View className="flex-1">
        {/* Keyed by the card, so each one starts at its top. */}
        <ScrollView
          key={match ?? entry?.position ?? "queue"}
          contentContainerClassName="flex-grow gap-4 p-6"
        >
          {view.status === "loading" && (
            <Text accessibilityLiveRegion="polite">{t("load.loading")}</Text>
          )}
          {view.status === "failed" && <LoadFailed error={view.error} onRetry={queue.retry} />}
          {view.status === "budget" && (
            <Text ref={focusOnMount} accessibilityLiveRegion="polite">
              {t("errors.card_budget_exceeded")}
            </Text>
          )}
          {view.status === "gone" && (
            <>
              <Text ref={focusOnMount} accessibilityLiveRegion="polite">
                {t("queue.gone")}
              </Text>
              {backToStars()}
            </>
          )}
          {entries === null && <Text ref={focusOnMount}>{t("queue.none")}</Text>}
          {match !== null && (
            <View className="gap-4">
              {hello ? (
                <Hello
                  name={hello.displayName}
                  still={still}
                  you={<OwnPhoto label={t("queue.hello.you")} />}
                  them={
                    helloPhoto && (
                      <CachedPhoto
                        id={helloPhoto.id}
                        variant="card"
                        blurhash={helloPhoto.blurhash}
                        style={{ width: "100%", height: "100%" }}
                      />
                    )
                  }
                />
              ) : (
                <Text ref={focusOnMount} variant="h2" accessibilityLiveRegion="polite">
                  {t("queue.match.title")}
                </Text>
              )}
              <Button
                size={hello ? "lg" : "default"}
                className={
                  lime ? "bg-accent active:bg-accent/85 web:hover:bg-accent/90" : undefined
                }
                accessibilityLabel={t(hello ? "queue.hello.open" : "queue.match.open")}
                onPress={() => {
                  tap();
                  away.current = true;
                  router.push(`/chats/${match}`);
                }}
              >
                <Text className={lime ? "text-accent-foreground" : undefined}>
                  {t(hello ? "queue.hello.open" : "queue.match.open")}
                </Text>
                {hello && (
                  <Icon as={ArrowRight} className={lime ? "text-accent-foreground" : undefined} />
                )}
              </Button>
              {star ? (
                backToStars()
              ) : (
                <Button
                  variant="outline"
                  onPress={() => {
                    tap();
                    queue.closeMatch();
                  }}
                >
                  {t("queue.match.continue")}
                </Button>
              )}
            </View>
          )}
          {match === null && current && (
            <View className="gap-3">
              <View className="flex-row flex-wrap items-center justify-between gap-2">
                <Text
                  ref={focusOnMount}
                  variant="small"
                  className="rounded-full bg-secondary px-3 py-1 text-secondary-foreground"
                >
                  {current.entry.relaxedField
                    ? t("queue.reason.relaxedField", {
                        field: t(fieldLabelKey(current.entry.relaxedField)),
                      })
                    : t(REASON[current.entry.reason as Exclude<QueueReason, "relaxed">])}
                </Text>
              </View>
              {(current.entry.notAnswered ?? []).map((field) => (
                <Text key={field} variant="muted">
                  {t("queue.notAnswered", { field: t(fieldLabelKey(field)) })}
                </Text>
              ))}
              {current.entry.relaxedField && current.entry.decision === null && (
                <Button
                  variant="ghost"
                  className="self-start"
                  disabled={queue.busy}
                  accessibilityLabel={t("queue.relaxed.undo", {
                    field: t(fieldLabelKey(current.entry.relaxedField)),
                  })}
                  onPress={() => {
                    tap();
                    const field = current.entry.relaxedField;
                    if (field) void queue.unrelax(current.day, field);
                  }}
                >
                  {t("queue.relaxed.undo", { field: t(fieldLabelKey(current.entry.relaxedField)) })}
                </Button>
              )}
              {current.entry.decision !== null && <Text>{t(REVISIT[current.entry.decision])}</Text>}
              <ProfileCardView
                bleed={poster}
                card={current.entry.card}
                distance={current.entry.distance}
                // No block or report while a decision is on its way: one finishing
                // after the next card took this one's place would never take the
                // blocked person off, and Undo would bring them back (ADR-030 §11).
                onGone={
                  queue.busy ? undefined : () => queue.drop(current.day, current.entry.position)
                }
                onRefused={(code) =>
                  setRefused({
                    day: current.day,
                    position: current.entry.position,
                    code: code ?? "",
                  })
                }
              />
              {refused?.day === current.day && refused.position === current.entry.position && (
                <Text variant="muted" accessibilityLiveRegion="polite">
                  {t(photoRefusalKey(refused.code))}
                </Text>
              )}
            </View>
          )}
          {/* A card of the Later list, decided or blocked: the way back is all that stands, and the reader is taken to it (#581). */}
          {star &&
            match === null &&
            !entry &&
            entries &&
            view.status === "ready" &&
            backToStars(focusOnMount)}
          {/* The queue's end (ADR-062 §11): the line the reader is taken to, the way into the Later list while it shows somebody (#681), what may be relaxed for today (#99, ADR-042), and the same way into What you seek for everybody. */}
          {!star && match === null && !entry && entries && view.status === "ready" && (
            <>
              <Text ref={focusOnMount}>{t("queue.done")}</Text>
              <StarsButton replace />
              <ShortPool
                day={view.queue.day}
                busy={queue.busy}
                onRelax={(relaxation) => queue.relax(view.queue.day, relaxation)}
                onUndo={(field) => queue.unrelax(view.queue.day, field)}
              />
              <Button
                variant="outline"
                onPress={() => {
                  tap();
                  router.push(SEEK_PATH);
                }}
              >
                {t("profile.seek.title")}
              </Button>
            </>
          )}
          {/* The card's end scrolls clear of the buttons floating over it (#681). */}
          {floating && <View testID="queue-float-room" style={{ height: barHeight }} />}
        </ScrollView>
        {floating && (
          <View
            testID="queue-float"
            pointerEvents="box-none"
            className="absolute bottom-0 left-0 right-0 px-6 pb-3"
            onLayout={(event) => setBarHeight(event.nativeEvent.layout.height)}
          >
            {match === null && current && view.status === "ready" ? (
              <DecisionBar
                card={current}
                fishToSend={view.queue.fishToSend}
                likesLeft={view.queue.likesLeft}
                busy={queue.busy}
                left={placement.hand === "left"}
                oneHanded={placement.oneHanded}
                icons={DECISION_ICONS[placement.style]}
                poster={poster}
                undo={undo}
                float={float}
                onChoose={choose}
              />
            ) : (
              // One-handed, Undo stays at the thumb when no card is left to decide:
              // after the queue's last decision it can still be taken back (ADR-034 §5).
              <View
                testID="queue-one-handed"
                pointerEvents="box-none"
                className={cn("w-2/3", placement.hand === "left" ? "self-start" : "self-end")}
              >
                <Afloat className="rounded-full" style={float.plain}>
                  {undo}
                </Afloat>
              </View>
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

/**
 * A piece of what floats over the card (#681): the ground's fill in the piece's
 * shape, so its words read over any photo, a busy button's too, which is drawn
 * with no fill of its own, and the lift that stands it off the card.
 */
function Afloat({
  className,
  style,
  children,
}: {
  className: string;
  style: ViewStyle | undefined;
  children: ReactNode;
}) {
  return (
    <View className={cn("bg-background", className)} style={style}>
      {children}
    </View>
  );
}

/**
 * Like, Pass, Later and the flower over the bottom of the card (#82, #681): in
 * a row for the right hand (Pass, Like) or mirrored for the left, the flower,
 * Later and the likes left in a smaller row above on the hand's side; one-handed,
 * a column on that side, Undo first and Like last, nearest the thumb. Each keeps
 * its shape, word and icon wherever it sits, and floats on its own fill with no
 * band behind the bar, so the card shows between them and scrolls under them
 * (the maintainer's of 18/11/2026). The flower is there while one can go today,
 * and on the card that holds it, read back selected and open to change (#475).
 * Later is there on every card, plainer than the two that decide, no outline: it
 * spends nothing and answers nobody (ADR-062 §3), and a wide word in the row of
 * two would take their room, so it sits with the flower and wraps with it, never
 * on a line of its own while there is room beside the flower. How many of the
 * day's likes are left is plain text beside those two, above them where they do
 * not fit on one row, the same at ten as at one: no colour, no motion, and
 * nothing announces it after a decision (#524).
 */
function DecisionBar({
  card,
  fishToSend,
  likesLeft,
  busy,
  left,
  oneHanded,
  icons,
  poster,
  undo,
  float,
  onChoose,
}: {
  card: QueueCard;
  /** Whether a flower can go today, as the queue and each decision's answer say (#475). */
  fishToSend: boolean;
  /** How many of the day's likes are left, as the queue and each decision's answer say (#524). */
  likesLeft: number;
  busy: boolean;
  left: boolean;
  oneHanded: boolean;
  /** Like's and Pass's icons, in the person's style (#520); nothing else changes with it. */
  icons: DecisionIcons;
  /** Kumpa's poster (the HS design): Pass, Like and Later as round buttons in a row of their own. */
  poster: boolean;
  /** Undo, which comes down from the header in one-handed mode; nothing while there is nothing to undo. */
  undo: ReactNode;
  /** How the pieces stand off the card (`useFloat`). */
  float: { drawn: ViewStyle | undefined; plain: ViewStyle };
  onChoose: (card: QueueCard, decision: QueueChoice) => void;
}) {
  const { t } = useT();
  const { entry } = card;
  const likes = (
    <Afloat
      className={cn("rounded-lg px-3 py-1", oneHanded && (left ? "self-start" : "self-end"))}
      style={float.plain}
    >
      <Text variant="muted" className={cn(!left && "text-right")}>
        {t("queue.likesLeft", { likes: likesLeft })}
      </Text>
    </Afloat>
  );
  // A flower counts in the day's likes, so with none left it can go only on a
  // card whose like is paid for (#503, the maintainer's of 01/11/2026).
  const fishCanGo = fishToSend && (likesLeft > 0 || entry.decision === "like");
  const fish = !ANSWERS_A_LIKE.has(entry.reason) && (fishCanGo || entry.decision === "fish") && (
    <Afloat className="rounded-lg" style={float.drawn}>
      <Button
        variant="secondary"
        className="rounded-lg"
        disabled={busy}
        accessibilityLabel={t("queue.fish")}
        accessibilityState={{ selected: entry.decision === "fish" }}
        onPress={() => onChoose(card, "fish")}
      >
        <Icon as={Dandelion} />
        <Text>{t("queue.fish")}</Text>
      </Button>
    </Afloat>
  );
  const later = (
    <Afloat className="rounded-full" style={float.plain}>
      <Button
        variant="ghost"
        className="rounded-full"
        disabled={busy}
        accessibilityLabel={t("queue.skip")}
        accessibilityState={{ selected: entry.decision === "skip" }}
        onPress={() => onChoose(card, "skip")}
      >
        {t("queue.skip")}
      </Button>
    </Afloat>
  );
  const pass = (
    <Afloat key="pass" className={cn("rounded-md", !oneHanded && "flex-1")} style={float.drawn}>
      <Button
        variant="outline"
        size="lg"
        className="rounded-md"
        disabled={busy}
        accessibilityLabel={t("queue.pass")}
        accessibilityState={{ selected: entry.decision === "pass" }}
        onPress={() => onChoose(card, "pass")}
      >
        <Icon as={icons.pass} />
        <Text>{t("queue.pass")}</Text>
      </Button>
    </Afloat>
  );
  const like = (
    <Afloat key="like" className={cn("rounded-full", !oneHanded && "flex-1")} style={float.drawn}>
      <Button
        size="lg"
        className="rounded-full"
        disabled={busy}
        accessibilityLabel={t("queue.like")}
        accessibilityState={{ selected: entry.decision === "like" }}
        onPress={() => onChoose(card, "like")}
      >
        <Icon as={icons.like} />
        <Text>{t("queue.like")}</Text>
      </Button>
    </Afloat>
  );
  const round = poster && !oneHanded;
  const rounds = round && [
    <RoundChoice
      key="pass"
      label={t("queue.pass")}
      icon={icons.pass}
      selected={entry.decision === "pass"}
      disabled={busy}
      onPress={() => onChoose(card, "pass")}
    />,
    <RoundChoice
      key="like"
      label={t("queue.like")}
      icon={icons.like}
      filled
      selected={entry.decision === "like"}
      disabled={busy}
      onPress={() => onChoose(card, "like")}
    />,
    <RoundChoice
      key="later"
      label={t("queue.skip")}
      icon={Star}
      selected={entry.decision === "skip"}
      disabled={busy}
      onPress={() => onChoose(card, "skip")}
    />,
  ];
  return (
    <View pointerEvents="box-none" className="gap-3">
      {oneHanded ? (
        <View
          testID="queue-one-handed"
          pointerEvents="box-none"
          className={cn("w-2/3 gap-3", left ? "self-start" : "self-end")}
        >
          {undo && (
            <Afloat className="rounded-full" style={float.plain}>
              {undo}
            </Afloat>
          )}
          {likes}
          {fish}
          {later}
          {pass}
          {like}
        </View>
      ) : (
        <>
          <View
            testID="queue-likes-row"
            pointerEvents="box-none"
            className={cn(
              "flex-row flex-wrap items-center justify-end gap-x-4 gap-y-3",
              left && "flex-row-reverse",
            )}
          >
            {likes}
            {/* Held to the row's width, or a View, which does not shrink, never
                wraps and runs off the screen's edge: "Send a flower" at 320 pt. */}
            <View
              pointerEvents="box-none"
              className={cn(
                "max-w-full shrink flex-row flex-wrap items-center justify-end gap-x-4 gap-y-3",
                left && "flex-row-reverse",
              )}
            >
              {fish}
              {!round && later}
            </View>
          </View>
          {rounds ? (
            <View pointerEvents="box-none" className="flex-row items-start justify-center gap-5">
              {left ? [...rounds].reverse() : rounds}
            </View>
          ) : (
            <View pointerEvents="box-none" className="flex-row gap-4">
              {left ? [like, pass] : [pass, like]}
            </View>
          )}
        </>
      )}
    </View>
  );
}

/** Where a pressed round button sits: in its own hard shadow, which it covers. */
const ROUND_SHADOW = 4;
const ROUND_PRESSED: ViewStyle = {
  transform: [{ translateX: ROUND_SHADOW }, { translateY: ROUND_SHADOW }],
};

/**
 * Kumpa's round buttons (the HS design): a disc in the ink's outline on its
 * hard shadow, Like filled in the blue, each with its word under it on the
 * ground's fill, so the meaning rests on neither the icon nor the colour. The
 * word is inside the press, so a tap on it decides as a tap on the disc does,
 * and a screen reader meets one button. Busy, the disc is drawn as every
 * disabled control is, a dashed outline with no fill, never faded.
 */
function RoundChoice({
  label,
  icon,
  filled = false,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  icon: DecisionIcons["like"];
  filled?: boolean;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const shadow = useHardShadow(ROUND_SHADOW);
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      className="max-w-[92px] flex-1 items-center gap-2"
    >
      <View
        className={cn(
          "aspect-square w-full items-center justify-center rounded-full border-[2.5px]",
          disabled
            ? "border-dashed border-input bg-transparent"
            : cn("border-solid border-stroke", filled ? "bg-primary" : "bg-card"),
        )}
        style={pressed || disabled ? ROUND_PRESSED : shadow}
      >
        <Icon
          as={icon}
          size={34}
          strokeWidth={2.5}
          className={
            disabled
              ? "text-muted-foreground"
              : filled
                ? "text-primary-foreground"
                : "text-foreground"
          }
        />
      </View>
      <Afloat className="rounded-full px-2" style={undefined}>
        <Text
          variant="small"
          className={cn("text-center font-sans", disabled && "text-muted-foreground")}
        >
          {label}
        </Text>
      </Afloat>
    </Pressable>
  );
}
