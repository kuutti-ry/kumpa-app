import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { contrastRatio, hslChannelsToRgb, parseTokenSets } from "@/theme/contrast";
import { LOOK_CLASS, LOOKS, PRESS_FILL, pressFill, traitsOf } from "@/theme/looks";

const SETS = parseTokenSets(readFileSync(resolve(__dirname, "tokens.css"), "utf8"));

type Rgb = [number, number, number];

const rgbOf = (selector: string, token: string): Rgb => {
  const value = SETS[selector]?.[token];
  const rgb = value === undefined ? null : hslChannelsToRgb(value);
  if (!rgb) throw new Error(`${selector} has no ${token}`);
  return rgb;
};

/** A tint laid over a ground, as a screen composites it, channel by channel. */
const over = (ground: Rgb, tint: Rgb, alpha: number): Rgb =>
  ground.map((channel, at) => alpha * (tint[at] ?? 0) + (1 - alpha) * channel) as Rgb;

describe("pressTint", () => {
  it.each([false, true])("is today's --accent, with high contrast %s", (highContrast) => {
    expect(traitsOf("today", highContrast).pressTint).toBe(false);
    expect(pressFill(traitsOf("today", highContrast))).toBe(PRESS_FILL.accent);
  });

  it.each(
    LOOKS.filter((look) => look !== "today").flatMap((look) => [
      [look, false],
      [look, true],
    ]),
  )("is the ink's tint in %s, with high contrast %s", (look, highContrast) => {
    expect(traitsOf(look, highContrast).pressTint).toBe(true);
    expect(pressFill(traitsOf(look, highContrast))).toBe(PRESS_FILL.tint);
  });

  it("fills with the ink at a tenth when pressed and a twentieth when hovered", () => {
    // What the contrast below is held at: a change of either alpha changes it.
    expect(PRESS_FILL.tint).toContain("active:bg-foreground/10");
    expect(PRESS_FILL.tint).not.toContain("bg-accent");
    expect(PRESS_FILL.accent).toContain("active:bg-accent");
  });
});

// A pressed row's words keep their colour on its ground tinted with the ink:
// every try set, and the high-contrast pair, which a try style with high
// contrast on draws with, at 4.5:1 and 7:1, on the screen and on a card,
// unpressed, hovered and pressed.
describe("the words on a pressed row", () => {
  const trySets = Object.values(LOOK_CLASS).flatMap(({ light, dark }) =>
    [light, dark].filter((set): set is string => set !== undefined).map((set) => `.${set}`),
  );
  const cases = [
    ...trySets.map((selector) => [selector, 4.5] as const),
    [".high-contrast", 7] as const,
    [".high-contrast-dark", 7] as const,
  ];

  it("covers every try set", () => {
    expect(trySets).toHaveLength(10);
    for (const selector of trySets) expect(SETS[selector]).toBeDefined();
  });

  it.each(cases)("read in %s at %s:1", (selector, floor) => {
    const ink = rgbOf(selector, "foreground");
    const failures = (["background", "card"] as const).flatMap((groundToken) =>
      [0, 0.05, 0.1].flatMap((alpha) => {
        const ground = over(rgbOf(selector, groundToken), ink, alpha);
        return (["foreground", "muted-foreground"] as const)
          .map((word) => [word, groundToken, alpha, contrastRatio(rgbOf(selector, word), ground)])
          .filter(([, , , ratio]) => (ratio as number) < floor);
      }),
    );
    expect(failures).toEqual([]);
  });
});

describe("the look a phone starts in", () => {
  it("is Kumpa, the one look whose card is a poster (the HS design, 20/11/2026)", () => {
    // jest.setup.js pins the suite to today's look; the real module says what a phone gets.
    const actual = jest.requireActual<typeof import("@/theme/looks")>("@/theme/looks");
    expect(actual.DEFAULT_LOOK).toBe("kumpa");
    expect(LOOKS.filter((look) => traitsOf(look, false).poster)).toEqual(["kumpa"]);
    expect(LOOKS.filter((look) => traitsOf(look, true).poster)).toEqual(["kumpa"]);
  });
});
