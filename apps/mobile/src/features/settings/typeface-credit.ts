import { getLoadedFonts } from "expo-font";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

/**
 * Saiga's credit on the licences screen (#405): Teo Tuominen of Spoke Type
 * is named as its designer for as long as Kumpa uses it (the maintainer,
 * 08/11/2026), in the form the website's About page gives him. Spoke's
 * licence is an e-mail to Kuutti ry, not a public text (ADR-052), so the row
 * names the designer and nothing of the terms.
 */
export const TYPEFACE_CREDIT = {
  name: "Saiga",
  designer: "Teo Tuominen",
  foundry: "Spoke Type",
} as const;

/**
 * Whether this build carries Saiga. A build made without `pnpm fonts`, a
 * fork's among them, is in the system font and runs the same JavaScript
 * (withSaiga.js), so the credit asks the phone: iOS names the faces
 * (Saiga-Regular and on), Android the family, at once. On the web target
 * expo-font reads only the rules it injected itself, never global.css's, and
 * a face loads after the first render, so there the browser is asked to load
 * one: it finds a face where Metro serves the files, from this computer's
 * cache, and fails where it does not.
 */
export function useCarriesSaiga(): boolean {
  const [carries, setCarries] = useState(
    () =>
      Platform.OS !== "web" &&
      getLoadedFonts().some((font) => font === "Saiga" || font.startsWith("Saiga-")),
  );
  useEffect(() => {
    if (Platform.OS !== "web") return;
    document.fonts.load("16px Saiga").then(
      (faces) => setCarries(faces.length > 0),
      () => setCarries(false),
    );
  }, []);
  return carries;
}
