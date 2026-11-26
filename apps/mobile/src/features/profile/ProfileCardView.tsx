import { formatHeight } from "@kuutti/i18n";
import {
  CARD_FIELD_KEYS,
  DEAL_BREAKER_FIELDS,
  type DistanceBand,
  type GuildOption,
  HOBBY_GROUPS,
  type HobbyGroup,
  PROFILE_FIELDS,
  type ProfileCard,
  type ProfileFieldKey,
} from "@kuutti/schema";
import { Image } from "expo-image";
import { Fragment, type ReactNode, useState } from "react";
import { type AccessibilityActionEvent, View, type ViewStyle } from "react-native";
import Svg, { Path } from "react-native-svg";
import { useInSight } from "@/components/InSight";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Text, TextClassContext } from "@/components/ui/text";
import { captionKey, type OnRefused, PhotoDescriptionText, PhotoImage } from "@/features/media";
import { SafetyActions } from "@/features/safety";
import { useT } from "@/lib/locale";
import { usePhotoDescriptionText } from "@/lib/photo-descriptions";
import { cn } from "@/lib/utils";
import { DECORATIVE } from "@/theme/a11y";
import { useTokenColour } from "@/theme/shadow";
import { useLookTraits } from "@/theme/ThemeProvider";
import { FIELD_ICONS, HOBBY_GROUP_ICONS } from "./fieldIcons";
import { OptionGlyph, optionGlyph } from "./glyphs";
import {
  fieldLabelKey,
  genderKey,
  guildWords,
  optionKey,
  placeName,
  presetKey,
  promptKey,
} from "./keys";
import { PROFILE_SECTIONS, type SectionItem, sectionTitleKey } from "./sections";

/** The card's own accessibility action, by name; its label is the heard one. */
const SAFETY_ACTION = "blockOrReport";

/**
 * The answers the card shows as chips after its first photo (#644, the
 * maintainer's of 07/11/2026): what the person is here for and the six a
 * deal-breaker can be set on, the answers people care enough about to filter
 * on, in the registry's order.
 */
const KEY_FACTS: readonly ProfileFieldKey[] = CARD_FIELD_KEYS.filter(
  (key) => key === "intent" || DEAL_BREAKER_FIELDS.includes(key),
);

const isCardField = (item: SectionItem): item is ProfileFieldKey =>
  (CARD_FIELD_KEYS as readonly string[]).includes(item);

/**
 * The rest of a card's answers, at its end, under the profile's own sections
 * and in their order (#644), the one the person fills them in: the key facts
 * stand above, and the identity label in the header.
 */
const WHOLE_SECTIONS = PROFILE_SECTIONS.map((section) => ({
  id: section.id,
  fields: (section.items as readonly SectionItem[])
    .filter(isCardField)
    .filter((key) => !KEY_FACTS.includes(key) && key !== "identityLabel"),
})).filter((section) => section.fields.length > 0);

/** Each hobby's group, whose icon stands before the hobby on its chip. */
const HOBBY_GROUP_OF: ReadonlyMap<string, HobbyGroup> = new Map(
  (Object.entries(HOBBY_GROUPS) as [HobbyGroup, readonly string[]][]).flatMap(([group, hobbies]) =>
    hobbies.map((hobby) => [hobby, group] as const),
  ),
);

/**
 * One answer as a chip (#644): the person's own words, as the field's own
 * screen offered them, and how a screen reader hears it, which the icon
 * before the words cannot say.
 */
type Chip = {
  id: string;
  field: ProfileFieldKey;
  option: string | null;
  text: string;
  /** Both the viewer and the subject answered it (#150): filled and in bold, never a colour alone. */
  shared: boolean;
  /** A field that reads as the work beside it says both answers, with both icons. */
  withWork: boolean;
  heard: string;
};
type Unheard = Omit<Chip, "heard">;

/**
 * A field and a work that read the same are one chip with both icons (#644,
 * the maintainer's of 07/11/2026): two chips of "Arts and culture" told the
 * two answers apart by their icons alone. Matched by the words the reader
 * sees, so a pair that differs in a language stays two there. The fields come
 * before the work in their section, so the work's chip is taken as its field's
 * twin is reached.
 */
function mergeFieldAndWork(chips: readonly Unheard[]): Unheard[] {
  const taken = new Set<string>();
  return chips.flatMap((chip) => {
    if (taken.has(chip.id)) return [];
    if (chip.field !== "field") return [chip];
    const work = chips.find(
      (other) => other.field === "occupation" && other.text === chip.text && !taken.has(other.id),
    );
    if (!work) return [chip];
    taken.add(work.id);
    return [{ ...chip, withWork: true }];
  });
}

/**
 * A card as others see it (#47, #150), one scroll the way Hinge has it (the
 * maintainer's of 26/11/2026, after the two depths of #644): the name with the
 * age, then the gender with the identity label after it, the name of the home
 * and, in a queue, how far it is in words (ADR-061 §3, §5), on one line with
 * no digits, no kilometres and no meaning in a colour; the first photo; the key
 * facts as chips; then each further photo with the next of the person's own
 * words after it, the first prompt, the bio, the other prompts (the field
 * sheet's Hinge takeaway, ADR-009 §7); whatever is left of either after the
 * other ran out; and last the rest of the answers under the profile's own
 * section titles. Nothing is folded away and nothing is tapped through: the
 * card is read by scrolling, and a new card starts at its top.
 *
 * A chip is an answer in the person's own words with the field's icon before
 * it, or the option's own glyph (#213), Hinge's way ("<cigarette> Never"),
 * the maintainer's call: the icon is decorative, so a field's first chip is
 * heard with its question ("Smoking: Never"). An answer both people gave is
 * filled and in bold, heard as shared, never a count or a score (ADR-009 §7);
 * the words "you too" went for reading like "me too".
 *
 * A photo is asked for when it first comes into sight on the screen, never
 * before (rules/mobile.md Images: prefetch counts as exposure), its blurhash
 * standing in until then, and stays once it has: at most one card-size URL per
 * photo while the card is on the screen (ADR-008, ADR-041 §1). The screen's
 * scroll tells the card when it moves (`useSightScroll`). Each photo carries
 * its caption and the description under it, and is heard with its place.
 *
 * Someone else's card carries "Block or report" (#84, ADR-030 §11): an icon
 * button beside the name, and the same as an accessibility action on the
 * name. Only a screen that passes `onGone` shows it, so the owner's preview
 * never does. Its report may name one of the card's photos (#476), each
 * named as the card names it.
 */
export function ProfileCardView({
  card,
  distance,
  onRefused,
  onGone,
  bleed = false,
}: {
  card: ProfileCard;
  /** Kumpa's poster only: the first photo runs to the edges of a screen padded 24 pt on each side (the queue's). */
  bleed?: boolean;
  /** How far the person lives, as their queue entry froze it (ADR-061 §5); a card outside a queue has none. */
  distance?: DistanceBand | null;
  /** A photo URL the API refused (#52 budget or another code): the screen says so instead of a silent placeholder. */
  onRefused?: OnRefused;
  /** Someone else's card: the person blocked or reported them, and the screen takes the card away. */
  onGone?: (accountId: string) => void;
}) {
  const { t, locale } = useT();
  const { poster } = useLookTraits();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const described = usePhotoDescriptionText();
  const [firstPrompt, ...morePrompts] = card.prompts;
  const total = card.photos.length;
  /** A photo's place on the card and the owner's line, as the report step shows it (#476). */
  const photoText = (photo: ProfileCard["photos"][number], position: number) =>
    photo.caption
      ? t("profile.card.photoLabelCaption", {
          position,
          total,
          caption: t(captionKey(photo.caption)),
        })
      : t("profile.card.photoLabel", { position, total });
  // A photo's label says its caption too (#296), so a screen reader hears the
  // owner's line with the picture, and then what the check saw in it.
  const photoLabel = (photo: ProfileCard["photos"][number], position: number) =>
    described.label(photoText(photo, position), photo.description);
  const fields = card.fields as Record<string, unknown>;
  const identityLabel = typeof fields.identityLabel === "string" ? fields.identityLabel : null;
  /** The header's one line (#644): each word its own text, heard on its own. */
  const line = [
    card.gender ? t(genderKey(card.gender)) : null,
    identityLabel ? t(optionKey("identityLabel", identityLabel)) : null,
    card.place ? placeName(card.place, locale) : null,
    distance ? t(optionKey("distance", distance)) : null,
  ].filter((word): word is string => word !== null);

  /** A field's answers as chips, one an option; none for what the card never shows (a setting). */
  const chipsOf = (key: ProfileFieldKey): Unheard[] => {
    const value = fields[key];
    const spec = PROFILE_FIELDS[key];
    if (value === undefined || spec.kind === "flag") return [];
    const answers: { option: string | null; text: string }[] =
      spec.kind === "text"
        ? [{ option: null, text: String(value) }]
        : spec.kind === "number"
          ? [{ option: null, text: formatHeight(locale, Number(value)) }]
          : (Array.isArray(value) ? value : [value]).map((option) => ({
              option: String(option),
              text:
                key === "guild"
                  ? guildWords(t, option as GuildOption)
                  : t(optionKey(key, String(option))),
            }));
    // "Another guild" of two schools is one chip: the card does not say whose (#677).
    const once =
      key === "guild"
        ? answers.filter((a, i) => answers.findIndex((b) => b.text === a.text) === i)
        : answers;
    const shared: readonly string[] =
      key === "hobbies" || key === "languages" || key === "university" || key === "guild"
        ? card.shared[key]
        : [];
    return once.map((answer) => ({
      ...answer,
      id: `${key}.${answer.option ?? "value"}`,
      field: key,
      shared: answer.option !== null && shared.includes(answer.option),
      withWork: false,
    }));
  };
  /**
   * How each chip is heard: a field's first chip of its own names its question,
   * which the icon says only to the eye, and a field read as the work names both.
   */
  const heardAll = (chips: readonly Unheard[]): Chip[] => {
    const asked = new Set<ProfileFieldKey>();
    return chips.map((chip) => {
      const answer = chip.shared ? t("profile.card.shared", { option: chip.text }) : chip.text;
      if (chip.withWork) return { ...chip, heard: t("profile.card.fieldAndWork", { answer }) };
      const first = !asked.has(chip.field);
      asked.add(chip.field);
      return {
        ...chip,
        heard: first
          ? t("profile.card.fact", { question: t(fieldLabelKey(chip.field)), answer })
          : answer,
      };
    });
  };
  const keyChips = heardAll(KEY_FACTS.flatMap(chipsOf));
  const sections = WHOLE_SECTIONS.map((section) => ({
    id: section.id,
    chips: heardAll(mergeFieldAndWork(section.fields.flatMap(chipsOf))),
  })).filter((section) => section.chips.length > 0);
  // What the person wrote wins over a ready line, an empty bio being none.
  const bio = card.bio || (card.bioPreset ? t(presetKey(card.bioPreset)) : null);
  const panel = cn("gap-2 rounded-3xl border border-border bg-card p-5", !poster && "rounded-xl");
  /** The person's own words in the card's order: the first prompt, the bio, the other prompts. */
  const words: ReactNode[] = [
    ...(firstPrompt ? [firstPrompt] : []).map((answer) => (
      <Prompt key={answer.key} answer={answer} className={panel} />
    )),
    ...(bio
      ? [
          <Text key="bio" className={panel}>
            {bio}
          </Text>,
        ]
      : []),
    ...morePrompts.map((answer) => <Prompt key={answer.key} answer={answer} className={panel} />),
  ];
  const photoAt = (at: number) => {
    const photo = card.photos[at];
    if (!photo) return null;
    const under = described.under(photo.description);
    const edge = poster && bleed && at === 0;
    return (
      <View key={photo.id} className="gap-1.5">
        <CardPhoto
          photo={photo}
          label={photoLabel(photo, at + 1)}
          onRefused={onRefused}
          style={edge ? POSTER_BLEED : PHOTO_FRAME}
          className={
            edge ? undefined : poster ? "overflow-hidden rounded-3xl" : "overflow-hidden rounded-xl"
          }
          wave={poster && at === 0}
        />
        {photo.caption ? <Caption text={t(captionKey(photo.caption))} /> : null}
        {under ? <PhotoDescriptionText text={under} /> : null}
      </View>
    );
  };
  // The first photo and the key facts, then each further photo with the next of
  // the person's words under it, then what is left of either: a card with one
  // photo or none still has its facts and all its words.
  const stream: ReactNode[] = [photoAt(0)];
  if (keyChips.length > 0) stream.push(<Chips key="facts" chips={keyChips} poster={poster} />);
  for (let at = 1; at < Math.max(total, words.length + 1); at += 1) {
    stream.push(photoAt(at), words[at - 1] ?? null);
  }
  const rest = sections.map((section) => (
    <View key={section.id} className="gap-2">
      <Text variant="small" role="heading">
        {t(sectionTitleKey(section.id))}
      </Text>
      <Chips chips={section.chips} poster={poster} />
    </View>
  ));

  // The name and the line under it in one column, Block or report beside both,
  // so its 44 pt target puts no gap between them (#644).
  const title = (
    <View className="flex-row items-start gap-2">
      <View className="flex-1 gap-1.5">
        {/* The age in the title, as visible as the name: every account is bank-verified,
            so the card does not say so (#239). */}
        <CardTitle
          className={poster ? POSTER_TITLE : undefined}
          {...(onGone && {
            // A screen reader reaches block or report from the name too.
            accessibilityActions: [{ name: SAFETY_ACTION, label: t("safety.actions.title") }],
            onAccessibilityAction: (event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === SAFETY_ACTION) setSafetyOpen(true);
            },
          })}
        >
          {t("profile.card.nameAge", { name: card.displayName, years: card.age.years })}
        </CardTitle>
        {line.length > 0 && <HeaderLine words={line} />}
      </View>
      {onGone && (
        <SafetyActions
          accountId={card.accountId}
          // The report may name one of these (#476): named as here, in the variant
          // painted here, so the phone's cache has each the card showed and nothing
          // is signed again; one never shown is its blurhash.
          photos={card.photos.map((photo, at) => ({
            id: photo.id,
            variant: "card",
            blurhash: photo.blurhash,
            label: photoLabel(photo, at + 1),
            text: photoText(photo, at + 1),
          }))}
          open={safetyOpen}
          onOpenChange={setSafetyOpen}
          onGone={onGone}
        />
      )}
    </View>
  );

  // Kumpa's poster (the HS design): the name, large, then the first photo at the
  // screen's edges where the screen asks for it, and the rest, with no card
  // around them. The design draws the name under the photo; on a phone the
  // queue's floating buttons would cover it there, so it keeps the card's
  // order, name and line on top, in view without a scroll (#644).
  if (poster) {
    return (
      <View className="gap-4">
        {title}
        {stream}
        {rest}
      </View>
    );
  }
  return (
    <Card>
      <CardHeader>{title}</CardHeader>
      <CardContent className="gap-4">
        {stream}
        {rest}
      </CardContent>
    </Card>
  );
}

/** One prompt and its answer, the answer in the person's own words. */
function Prompt({
  answer,
  className,
}: {
  answer: ProfileCard["prompts"][number];
  className: string;
}) {
  const { t } = useT();
  return (
    <View className={className}>
      <Text variant="small">{t(promptKey(answer.key))}</Text>
      <Text>{answer.answer}</Text>
    </View>
  );
}

/**
 * One of the card's photos: its blurhash until it comes into sight, then the
 * photo itself, asked for then and kept (ADR-008). Heard as an image with its
 * place on the card either way.
 */
function CardPhoto({
  photo,
  label,
  onRefused,
  style,
  className,
  wave,
}: {
  photo: ProfileCard["photos"][number];
  label: string;
  onRefused?: OnRefused;
  style: ViewStyle;
  className?: string;
  wave: boolean;
}) {
  const { ref, onLayout, inSight } = useInSight();
  const fill = { width: "100%", height: "100%" } as const;
  return (
    <View
      ref={ref}
      onLayout={onLayout}
      style={style}
      className={className}
      testID={`card-photo-${photo.id}`}
    >
      {inSight ? (
        <PhotoImage
          id={photo.id}
          variant="card"
          blurhash={photo.blurhash}
          accessibilityLabel={label}
          style={fill}
          onRefused={onRefused}
        />
      ) : (
        <Image
          source={null}
          placeholder={{ blurhash: photo.blurhash }}
          placeholderContentFit="cover"
          style={fill}
          accessible
          accessibilityRole="image"
          accessibilityLabel={label}
        />
      )}
      {wave && <PosterWave />}
    </View>
  );
}

const PHOTO_FRAME: ViewStyle = { width: "100%", aspectRatio: 3 / 4 };
// Kumpa's poster in the queue: the first photo to the screen's sides, out through the
// queue's 24 pt padding, since a width of 100 % would keep it. Its top stays,
// under the card's reason label.
const POSTER_BLEED: ViewStyle = { aspectRatio: 3 / 4, marginHorizontal: -24 };
const POSTER_TITLE = "text-[40px] leading-[46px] font-bold";
const POSTER_TONES = ["bg-chip-1", "bg-chip-2", "bg-chip-3"] as const;

/** The poster photo's wavy end, in the ground's colour, drawn over the photo's last strip. */
function PosterWave() {
  const ground = useTokenColour("background");
  if (!ground) return null;
  return (
    <Svg
      width="100%"
      height={44}
      viewBox="0 0 400 44"
      preserveAspectRatio="none"
      style={{ position: "absolute", left: 0, right: 0, bottom: -1 }}
      pointerEvents="none"
      {...DECORATIVE}
    >
      <Path d="M0 22 C 60 -4 140 2 205 22 S 335 50 400 12 L 400 45 L 0 45 Z" fill={ground} />
    </Svg>
  );
}

/**
 * The header's words on one line (#644), apart by a drawn dot that is no
 * text: the gender, the identity label, the home, the band. Each stays a
 * text of its own and no sentence is built around the place's name (TD-17).
 */
function HeaderLine({ words }: { words: readonly string[] }) {
  return (
    <View testID="card-line" className="flex-row flex-wrap items-center gap-x-2">
      {words.map((word, at) => (
        <Fragment key={word}>
          {at > 0 && (
            <View
              testID="card-line-dot"
              className="h-1 w-1 rounded-full bg-muted-foreground"
              {...DECORATIVE}
            />
          )}
          <Text variant="muted">{word}</Text>
        </Fragment>
      ))}
    </View>
  );
}

/** Chips that wrap onto as many lines as they need, never a sideways scroll (#644). */
function Chips({ chips, poster }: { chips: readonly Chip[]; poster: boolean }) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {chips.map((chip, at) => (
        <FactChip key={chip.id} chip={chip} tone={poster ? POSTER_TONES[at % 3] : undefined} />
      ))}
    </View>
  );
}

/**
 * One answer: the option's glyph where it has one (#213), a hobby's group
 * icon, else the field's, then the words. A shared answer is filled and in
 * bold, so the meaning never rests on the colour (CLAUDE.md Accessibility),
 * and the chip is heard as one element.
 */
function FactChip({ chip, tone }: { chip: Chip; tone?: string }) {
  const group =
    chip.field === "hobbies" && chip.option ? HOBBY_GROUP_OF.get(chip.option) : undefined;
  const inner = (
    <>
      {chip.option !== null && optionGlyph(chip.field, chip.option) !== null ? (
        // What can be shared (hobbies, languages, a school, a guild) has no glyph.
        <OptionGlyph field={chip.field} option={chip.option} className="h-4 w-4 text-foreground" />
      ) : (
        // The icon keeps its size beside a name that wraps, a guild's (#677); a browser would squeeze it.
        <Icon
          as={group ? HOBBY_GROUP_ICONS[group] : FIELD_ICONS[chip.field]}
          size={16}
          className="shrink-0"
          testID={group ? `hobby-group-icon-${group}` : `field-icon-${chip.field}`}
        />
      )}
      {chip.withWork && (
        <Icon
          as={FIELD_ICONS.occupation}
          size={16}
          className="shrink-0"
          testID="field-icon-occupation"
        />
      )}
      <Text className="shrink">{chip.text}</Text>
    </>
  );
  return (
    <View
      accessible
      accessibilityLabel={chip.heard}
      testID={`chip-${chip.id}`}
      className={cn(
        // A pill while its words fit a line or two. A full pill's curve would cross the words of a
        // name on three lines at the largest text, a guild's (#677), so the corner stops here.
        "max-w-full flex-row items-center gap-1.5 rounded-3xl border px-3 py-1",
        // The outline stays on a shared chip: the high-contrast sets' fill is their
        // background, and there the bold alone tells it, still a chip.
        "border-border",
        chip.shared && "bg-secondary",
        // Kumpa's pastels, in turn; a shared one keeps its bold and takes the ink's outline.
        tone && cn("py-1.5", tone, chip.shared ? "border-2 border-stroke" : "border-transparent"),
      )}
    >
      {chip.shared ? (
        // On a pastel, a shared chip's words are the ink, as every chip's are.
        <TextClassContext.Provider
          value={cn("font-semibold", tone ? "text-foreground" : "text-secondary-foreground")}
        >
          {inner}
        </TextClassContext.Provider>
      ) : (
        inner
      )}
    </View>
  );
}

/**
 * The owner's line under a photo (#296), for the eye. The photo's own label
 * already says it to a screen reader, so the text is not an element of its
 * own there: the line is heard once, with the picture.
 */
function Caption({ text }: { text: string }) {
  return (
    <Text
      variant="small"
      className="text-muted-foreground"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {text}
    </Text>
  );
}
