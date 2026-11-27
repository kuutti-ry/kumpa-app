import { createI18n, typedT } from "@kuutti/i18n";
import { FishSpecies, TipKind } from "@kuutti/schema";
import { act, fireEvent, renderHook, screen } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { View } from "react-native";
import { LocaleProvider, useT } from "@/lib/locale";
import { renderWithTheme, underProviders } from "@/test/render";
import { PhotoTip, tipText } from "./tips";

// The words for what the API names by kind (#56, #287): every tip has its own
// text, and the fish tip names the fish. A tip is said once, remembered
// on the device: those about the main photo for it (#297), the
// others for the photos there are (#681).

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const SEEN = "kuutti.preference.photoTipsSeen";
/** The screen without the tip: leaving it, to the component. */
const nothing = <View />;
const seen = () => JSON.parse(store.get(SEEN) ?? "{}") as unknown;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

async function english() {
  const { result } = await renderHook(() => useT(), { wrapper: LocaleProvider });
  return result.current.t;
}

describe("tipText", () => {
  it("has its own words for every kind of tip, never the key", async () => {
    const t = await english();
    expect(tipText(t, "sunglasses")).toBe(
      "Try a photo where your eyes are clear, without sunglasses.",
    );
    expect(tipText(t, "mirror_selfie")).toBe("Try a photo that is not a mirror selfie.");
    expect(tipText(t, "tight_crop")).toBe(
      "Try a photo that shows a little more of you than a close-up face.",
    );
    expect(tipText(t, "group_photo")).toBe(
      "Try a photo where you are the only person in the frame.",
    );
    expect(tipText(t, "poor_lighting")).toBe("Try a photo taken in clearer light.");
    expect(tipText(t, "blurry")).toBe("Try a sharper photo.");
    expect(tipText(t, "few_photos")).toBe(
      "More approved photos would help others get a fuller picture of you.",
    );
    for (const kind of TipKind.options) expect(tipText(t, kind)).not.toMatch(/^profile\./);
  });

  it("names the fish of the fish tip in each language, and keeps the plain tip without one (#253)", async () => {
    const t = await english();
    expect(tipText(t, "fish", "pike")).toBe(
      "A mighty catch, and we are proud of you! Is that a pike? For the main photo, though, try one without the catch, and let the fish come second.",
    );
    expect(tipText(t, "fish", "eel")).toContain("Is that an eel?");
    expect(tipText(t, "fish")).toBe(tipText(t, "fish", null));
    expect(tipText(t, "fish")).toContain("A fish in the main photo is a classic.");
    // A species is named only on the fish tip.
    expect(tipText(t, "sunglasses", "pike")).toBe(tipText(t, "sunglasses"));
    const fi = typedT(createI18n({ locale: "fi" }), "fi");
    const sv = typedT(createI18n({ locale: "sv" }), "sv");
    expect(tipText(fi, "fish", "pike")).toContain("Onko se hauki?");
    expect(tipText(sv, "fish", "pike")).toContain("Är det en gädda?");
    // Every species has its own word in every language, never the fallback.
    for (const species of FishSpecies.options) {
      expect(tipText(t, "fish", species)).not.toContain("a fish?");
      expect(tipText(fi, "fish", species)).not.toContain("Onko se kala?");
      expect(tipText(sv, "fish", species)).not.toContain("en fisk?");
    }
  });
});

describe("PhotoTip", () => {
  beforeEach(() => store.delete(SEEN));
  const PHOTOS = ["photo-c", "photo-a", "photo-b"];
  const KEY = "photo-a,photo-b,photo-c";
  const tipFor = (
    tips: TipKind[],
    mainId: string | null,
    photoIds = PHOTOS,
    species: FishSpecies | null = null,
  ) => <PhotoTip tips={tips} fishSpecies={species} mainId={mainId} photoIds={photoIds} />;

  it("says a tip about the main photo once for it (#297): not again once the screen was left, again when another photo was main meanwhile; a dismissal counts too", async () => {
    const fish = tipFor(["fish"], "photo-a");
    const view = await renderWithTheme(fish);
    await settle();
    expect(screen.getByText(/A fish in the main photo is a classic/)).toBeTruthy();
    // Leaving the screen with the tip on counts as having heard it.
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({ mainId: "photo-a", kinds: ["fish"], photos: KEY, photoKinds: [] });

    await view.rerender(underProviders(fish));
    await settle();
    expect(screen.queryByText("A tip for your photos")).toBeNull();
    await view.rerender(underProviders(nothing));

    // Another photo made the main one starts afresh even with no tip of its own,
    // so the fish photo chosen again earns its tip again (the maintainer, 15/10/2026).
    await view.rerender(underProviders(tipFor([], "photo-c")));
    await settle();
    expect(screen.queryByText("A tip for your photos")).toBeNull();
    expect(seen()).toEqual({ mainId: "photo-c", kinds: [], photos: KEY, photoKinds: [] });
    await view.rerender(underProviders(fish));
    await settle();
    expect(screen.getByText(/A fish in the main photo is a classic/)).toBeTruthy();
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({ mainId: "photo-a", kinds: ["fish"], photos: KEY, photoKinds: [] });

    // Tips about every photo: the first is said, and a dismissal brings the next.
    await view.rerender(underProviders(tipFor(["blurry", "few_photos"], "photo-b")));
    await settle();
    expect(screen.getByText("Try a sharper photo.")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    await settle();
    expect(screen.getByText(/fuller picture/)).toBeTruthy();
    expect(seen()).toEqual({ mainId: "photo-b", kinds: [], photos: KEY, photoKinds: ["blurry"] });
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({
      mainId: "photo-b",
      kinds: [],
      photos: KEY,
      photoKinds: ["blurry", "few_photos"],
    });

    // The fish photo chosen again, named this time; the others' record stands.
    await view.rerender(underProviders(tipFor(["fish"], "photo-a", PHOTOS, "pike")));
    await settle();
    expect(screen.getByText(/Is that a pike\?/)).toBeTruthy();
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({
      mainId: "photo-a",
      kinds: ["fish"],
      photos: KEY,
      photoKinds: ["blurry", "few_photos"],
    });
  });

  it("keeps a tip about every photo said through a new order, and says it again once a photo is added or removed (#681)", async () => {
    const two = ["photo-a", "photo-b"];
    const view = await renderWithTheme(tipFor(["tight_crop"], "photo-a", two));
    await settle();
    expect(screen.getByText(/than a close-up face/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    await settle();
    expect(screen.queryByText("A tip for your photos")).toBeNull();

    // The photos reordered: another main photo, the same photos, and no tip back.
    for (const order of [["photo-b", "photo-a"], two, ["photo-b", "photo-a"]]) {
      await view.rerender(underProviders(tipFor(["tight_crop"], order[0] ?? null, order)));
      await settle();
      expect(screen.queryByText("A tip for your photos")).toBeNull();
    }
    expect(seen()).toEqual({
      mainId: "photo-b",
      kinds: [],
      photos: "photo-a,photo-b",
      photoKinds: ["tight_crop"],
    });

    // A photo added is other photos, and so is one removed.
    await view.rerender(underProviders(tipFor(["tight_crop"], "photo-b", [...two, "photo-c"])));
    await settle();
    expect(screen.getByText(/than a close-up face/)).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Got it" }));
    await settle();
    await view.rerender(underProviders(tipFor(["tight_crop"], "photo-b", ["photo-b"])));
    await settle();
    expect(screen.getByText(/than a close-up face/)).toBeTruthy();
  });

  it("reads nothing into a stored value it does not understand, and says nothing without a tip", async () => {
    store.set(SEEN, "not json");
    const view = await renderWithTheme(tipFor(["blurry"], "photo-a"));
    await settle();
    expect(screen.getByText("Try a sharper photo.")).toBeTruthy();
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({ mainId: "photo-a", kinds: [], photos: KEY, photoKinds: ["blurry"] });
    // Only kinds this build knows survive a read.
    store.set(
      SEEN,
      JSON.stringify({
        mainId: "photo-a",
        kinds: ["nonsense"],
        photos: KEY,
        photoKinds: ["blurry", "nonsense", 7],
      }),
    );
    await view.rerender(underProviders(tipFor(["blurry", "fish"], "photo-a")));
    await settle();
    expect(screen.getByText(/A fish in the main photo is a classic/)).toBeTruthy();
    await view.rerender(underProviders(nothing));
    await settle();
    expect(seen()).toEqual({
      mainId: "photo-a",
      kinds: ["fish"],
      photos: KEY,
      photoKinds: ["blurry"],
    });
    // A record from before #681 keeps its main photo's part, and has no photos' part.
    store.set(SEEN, JSON.stringify({ mainId: "photo-a", kinds: ["fish", "blurry"] }));
    await view.rerender(underProviders(tipFor(["fish", "blurry"], "photo-a")));
    await settle();
    expect(screen.getByText("Try a sharper photo.")).toBeTruthy();
    await view.rerender(underProviders(nothing));
    await settle();
    for (const odd of [
      "[]",
      JSON.stringify({ fish: "photo-a" }),
      JSON.stringify({ mainId: 1, kinds: [] }),
    ]) {
      store.set(SEEN, odd);
      await view.rerender(underProviders(tipFor(["fish"], "photo-a")));
      await settle();
      expect(screen.getByText(/A fish in the main photo is a classic/)).toBeTruthy();
      await view.rerender(underProviders(nothing));
      await settle();
    }
    await view.rerender(underProviders(tipFor([], null)));
    await settle();
    expect(screen.queryByText("A tip for your photos")).toBeNull();
  });
});
