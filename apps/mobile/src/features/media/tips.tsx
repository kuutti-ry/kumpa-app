import { type FishSpecies, TipKind } from "@kuutti/schema";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useT } from "@/lib/locale";
import { readPreference, storedObject, writePreference } from "@/lib/preferences";
import { useHapticTap } from "@/theme/haptics";

/**
 * One advisory tip for the owner (#56); kinds are the API's, words are the
 * client's. The fish tip names the fish when the API is sure of it (#253).
 */
export function tipText(
  t: ReturnType<typeof useT>["t"],
  kind: TipKind,
  fishSpecies: FishSpecies | null = null,
): string {
  switch (kind) {
    case "sunglasses":
      return t("profile.tip.sunglasses");
    case "mirror_selfie":
      return t("profile.tip.mirror_selfie");
    case "tight_crop":
      return t("profile.tip.tight_crop");
    case "group_photo":
      return t("profile.tip.group_photo");
    case "poor_lighting":
      return t("profile.tip.poor_lighting");
    case "blurry":
      return t("profile.tip.blurry");
    case "few_photos":
      return t("profile.tip.few_photos");
    case "revealing":
      return t("profile.tip.revealing");
    case "fish":
      return fishSpecies
        ? t("profile.tip.fish_species", { species: fishSpecies })
        : t("profile.tip.fish");
  }
}

/**
 * The tips said already (#297, #681): on the device, beside the theme and the
 * language, never sent anywhere. Two tips are about the main photo alone
 * (`MAIN_PHOTO_TIPS`): said once for it, whether dismissed or left on the
 * screen, and not again while that photo stays the main one; another photo
 * made the main one starts them afresh, so a fish photo chosen again earns its
 * tip again, as the maintainer asked (15/10/2026). The other seven are about
 * every photo or their number: said once for the photos there are, so a new
 * order never brings one back, and a photo added or removed starts them
 * afresh (#681, the bug he found on 18/11/2026). Without a main photo its id
 * is empty.
 */
export type SeenTips = {
  mainId: string;
  kinds: TipKind[];
  /** The photos' ids, sorted and joined: which photos the other tips were said for. */
  photos: string;
  photoKinds: TipKind[];
};
const SEEN_KEY = "photoTipsSeen";
const NOTHING_SEEN: SeenTips = { mainId: "", kinds: [], photos: "", photoKinds: [] };

/** The API's tips about the main photo alone (`mainPhoto` in apps/api/src/media/tips.ts). */
const MAIN_PHOTO_TIPS: readonly TipKind[] = ["revealing", "fish"];
const aboutMain = (kind: TipKind) => MAIN_PHOTO_TIPS.includes(kind);

/** Which photos there are, whatever their order. */
function photosKey(ids: readonly string[]): string {
  return [...ids].sort().join(",");
}

// Writes queue behind one another, and a read waits for them, so a dismissal
// and the screen's closing moments later never read the same old value and
// lose one.
let pendingWrite: Promise<void> = Promise.resolve();

function writeSeenTips(next: SeenTips): Promise<void> {
  pendingWrite = pendingWrite.then(() => writePreference(SEEN_KEY, JSON.stringify(next)));
  return pendingWrite;
}

const known = (kinds: unknown): TipKind[] =>
  Array.isArray(kinds)
    ? kinds.filter((kind): kind is TipKind => TipKind.safeParse(kind).success)
    : [];

async function readSeenTips(): Promise<SeenTips> {
  await pendingWrite;
  const raw = await readPreference(SEEN_KEY);
  const stored = storedObject(raw);
  if (!stored) return NOTHING_SEEN;
  const { mainId, kinds, photos, photoKinds } = stored;
  if (typeof mainId !== "string" || !Array.isArray(kinds)) return NOTHING_SEEN;
  // Only kinds this build knows: anything else stored is dropped. A record
  // from before #681 has no photos' part, which reads as none said yet.
  return {
    mainId,
    kinds: known(kinds),
    photos: typeof photos === "string" ? photos : "",
    photoKinds: typeof photos === "string" ? known(photoKinds) : [],
  };
}

/** The record with one tip more, for the main photo or for the photos as its kind is about. */
function withSaid(seen: SeenTips, kind: TipKind, mainId: string, photos: string): SeenTips {
  const add = (kinds: TipKind[]) => (kinds.includes(kind) ? kinds : [...kinds, kind]);
  if (aboutMain(kind)) {
    return { ...seen, mainId, kinds: add(seen.mainId === mainId ? seen.kinds : []) };
  }
  return { ...seen, photos, photoKinds: add(seen.photos === photos ? seen.photoKinds : []) };
}

async function markTipSeen(kind: TipKind, mainId: string, photos: string): Promise<void> {
  await writeSeenTips(withSaid(await readSeenTips(), kind, mainId, photos));
}

/**
 * One tip at a time, where the photos are (#287): the first that applies and
 * was not yet said (#297, #681), said as soon as the check has decided the
 * photo. Dismissing it, or leaving the screen with it on, counts as having
 * heard it.
 */
export function PhotoTip({
  tips,
  fishSpecies,
  mainId,
  photoIds,
}: {
  tips: readonly TipKind[];
  fishSpecies: FishSpecies | null;
  /** The main photo (ADR-009 §4), the one two of the tips are about; null while there is none. */
  mainId: string | null;
  /** Every photo there is, in any order: the one the other tips are about. */
  photoIds: readonly string[];
}) {
  const { t } = useT();
  const tap = useHapticTap();
  const main = mainId ?? "";
  const photos = photosKey(photoIds);
  // Null until the device has answered what was said already: nothing is said
  // before that. A record of another main photo, or of other photos, is over
  // for its part, whether or not a tip applies now.
  const [seen, setSeen] = useState<SeenTips | null>(null);
  useEffect(() => {
    let live = true;
    void readSeenTips().then((read) => {
      if (!live) return;
      const fresh: SeenTips = {
        mainId: main,
        kinds: read.mainId === main ? read.kinds : [],
        photos,
        photoKinds: read.photos === photos ? read.photoKinds : [],
      };
      setSeen(fresh);
      if (read.mainId !== main || read.photos !== photos) void writeSeenTips(fresh);
    });
    return () => {
      live = false;
    };
  }, [main, photos]);
  const said = (kind: TipKind) =>
    seen !== null &&
    (aboutMain(kind)
      ? seen.mainId === main && seen.kinds.includes(kind)
      : seen.photos === photos && seen.photoKinds.includes(kind));
  const tip = seen ? (tips.find((kind) => !said(kind)) ?? null) : null;
  // Whatever was on the screen is remembered as said when it gives way: to a
  // dismissal, to another main photo or other photos, or to the screen closing.
  useEffect(() => {
    if (!tip) return;
    return () => void markTipSeen(tip, main, photos);
  }, [tip, main, photos]);
  if (!tip) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("profile.tip.title")}</CardTitle>
      </CardHeader>
      <CardContent className="gap-3">
        <Text>{tipText(t, tip, fishSpecies)}</Text>
        <Button
          variant="outline"
          onPress={() => {
            tap();
            setSeen((previous) => withSaid(previous ?? NOTHING_SEEN, tip, main, photos));
          }}
        >
          {t("profile.tip.dismiss")}
        </Button>
      </CardContent>
    </Card>
  );
}
