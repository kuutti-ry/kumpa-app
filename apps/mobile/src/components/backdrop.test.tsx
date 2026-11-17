import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { Card } from "@/components/ui/card";
import { renderWithTheme } from "@/test/render";
import { contrastRatio, hslChannelsToRgb, parseTokenSets } from "@/theme/contrast";
import { LOOK_CLASS, LOOKS, type Look, traitsOf } from "@/theme/looks";
import { BACKDROP_TINTS, Backdrop, MomentGround, momentInk, Patch, type Tint } from "./backdrop";

// NativeWind's colour-scheme setter needs its compiled stylesheet, which the
// test runner has none of: the scheme a test draws in is set here.
let mockColorScheme: "light" | "dark" = "light";
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useColorScheme: () => ({ colorScheme: mockColorScheme, setColorScheme: jest.fn() }),
}));

const SETS = parseTokenSets(readFileSync(resolve(__dirname, "../theme/tokens.css"), "utf8"));

type Rgb = [number, number, number];

const rgbOf = (set: string, token: string): Rgb => {
  const value = SETS[`.${set}`]?.[token];
  const rgb = value === undefined ? null : hslChannelsToRgb(value);
  if (!rgb) throw new Error(`${set} has no ${token}`);
  return rgb;
};

/** A tint laid over a ground, as a screen composites it, channel by channel. */
const over = (ground: Rgb, tint: Rgb, alpha: number): Rgb =>
  ground.map((channel, at) => alpha * (tint[at] ?? 0) + (1 - alpha) * channel) as Rgb;

// What sits on a screen and so on its backdrop: words at 4.5:1 (WCAG 1.4.3),
// a field's outline and the ink at 3:1 (1.4.11).
const WORDS = ["foreground", "muted-foreground", "primary"] as const;
const LINES = ["input", "stroke"] as const;

const grounds = Object.values(LOOK_CLASS).flatMap(({ light, dark }) => [light, dark]);
const withBackdrop = LOOKS.flatMap((look) => {
  const { backdrop } = traitsOf(look, false);
  if (backdrop === "none") return [];
  const { light, dark } = LOOK_CLASS[look];
  return [
    [light as string, "light", BACKDROP_TINTS[backdrop]] as const,
    [dark as string, "dark", BACKDROP_TINTS[backdrop]] as const,
  ];
});

describe("backdrop", () => {
  it("has a set of tokens for every style's light and dark", () => {
    for (const set of grounds) if (set) expect(SETS[`.${set}`]).toBeDefined();
  });

  it("is drawn in the three pill styles and in no other, nor in high contrast", () => {
    expect(withBackdrop.map(([set]) => set)).toEqual([
      "look-organic",
      "look-organic-dark",
      "look-glass",
      "look-glass-dark",
      "look-bold",
      "look-bold-dark",
    ]);
    for (const look of LOOKS) expect(traitsOf(look, true).backdrop).toBe("none");
  });

  describe.each(withBackdrop)("in %s", (set, scheme, { wash, patches }) => {
    const background = rgbOf(set, "background");
    const sky = (tint: Tint | undefined): Rgb =>
      tint ? over(background, rgbOf(set, tint.token), tint[scheme]) : background;
    const ground = sky(wash);
    const places = [
      ["the wash", ground] as const,
      ...patches.map(
        (patch) =>
          [
            `the ${patch.token} patch`,
            over(ground, rgbOf(set, patch.token), patch[scheme]),
          ] as const,
      ),
    ];

    it.each(places)("keeps words at 4.5:1 and lines at 3:1 on %s", (_, place) => {
      const below = [
        ...WORDS.map((token) => [token, contrastRatio(rgbOf(set, token), place), 4.5] as const),
        ...LINES.map((token) => [token, contrastRatio(rgbOf(set, token), place), 3] as const),
      ].filter(([, ratio, required]) => ratio < required);
      expect(below.map(([token, ratio]) => `${token} ${ratio.toFixed(2)}`)).toEqual([]);
    });

    // A pressed row lets the backdrop through its tint of the ink (pressFill),
    // which its words, the name and the line under it, keep their colour on.
    it.each(places)("keeps a pressed row's words at 4.5:1 on %s", (_, place) => {
      const pressed = over(place, rgbOf(set, "foreground"), 0.1);
      const below = (["foreground", "muted-foreground"] as const)
        .map((token) => [token, contrastRatio(rgbOf(set, token), pressed)] as const)
        .filter(([, ratio]) => ratio < 4.5);
      expect(below.map(([token, ratio]) => `${token} ${ratio.toFixed(2)}`)).toEqual([]);
    });
  });
});

// A Glass moment's words sit on a pane of the card at 80% over its bubbles:
// held here, at the pane's thinnest, over each colour that can show through.
describe("a Glass moment's pane", () => {
  it.each(["look-glass", "look-glass-dark"])("keeps the card's words at 4.5:1 in %s", (set) => {
    const card = rgbOf(set, "card");
    const below = (["background", "flourish", "accent", "secondary"] as const)
      .map((token) => [token, over(rgbOf(set, token), card, 0.8)] as const)
      .map(([token, pane]) => [token, contrastRatio(rgbOf(set, "card-foreground"), pane)] as const)
      .filter(([, ratio]) => ratio < 4.5);
    expect(below.map(([token, ratio]) => `${token} ${ratio.toFixed(2)}`)).toEqual([]);
  });
});

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const LOOK = "kuutti.preference.look";
const CONTRAST = "kuutti.preference.highContrast";

type HostNode = { type?: unknown; props?: Record<string, unknown>; children?: unknown };
const nodes = (node: unknown, found: HostNode[] = []): HostNode[] => {
  if (Array.isArray(node)) {
    for (const each of node) nodes(each, found);
    return found;
  }
  if (!node || typeof node !== "object") return found;
  found.push(node as HostNode);
  nodes((node as HostNode).children, found);
  return found;
};
const all = () => nodes(screen.toJSON());
const drawings = () => all().filter((node) => node.type === "RNSVGSvgView");
const classesOf = (node: HostNode) => String(node.props?.className ?? "").split(" ");
/** The blocks drawn: a view filled in a token, with the opacity it is drawn at. */
const blocks = () =>
  all()
    .filter((node) => classesOf(node).some((name) => /^bg-(flourish|accent|secondary)$/.test(name)))
    .map((node) => [
      classesOf(node).find((name) => name.startsWith("bg-")),
      (StyleSheet.flatten(node.props?.style as never) as { opacity?: number }).opacity,
    ]);
const hidden = (node: HostNode | undefined) =>
  expect(node?.props).toMatchObject({
    pointerEvents: "none",
    accessibilityElementsHidden: true,
    importantForAccessibility: "no-hide-descendants",
  });

/** Renders `ui` in `look`, and waits until the stored style is drawn. */
const inLook = async (look: Look, ui: React.ReactElement, drawn: () => void) => {
  store.set(LOOK, look);
  await renderWithTheme(ui);
  await waitFor(drawn);
};

afterEach(() => {
  store.delete(LOOK);
  store.delete(CONTRAST);
  mockColorScheme = "light";
});

describe("Backdrop", () => {
  it("draws nothing with no theme above it, as a part rendered alone", async () => {
    await render(<Backdrop />);
    expect(screen.toJSON()).toBeNull();
  });

  it.each([
    ["today", "theme-root"],
    ["neubrutalism", "look-neubrutalism"],
  ] as const)("draws nothing in the %s style", async (look, rootClass) => {
    store.set(LOOK, look);
    await renderWithTheme(<Backdrop />);
    const root = () => all().find((node) => classesOf(node).includes("theme-root"));
    await waitFor(() => expect(classesOf(root() as HostNode)).toContain(rootClass));
    expect(root()?.children ?? []).toEqual([]);
  });

  it("draws Organic Pop's two soft shapes behind the screen, unspoken and untouched", async () => {
    await inLook("organic", <Backdrop />, () => expect(drawings()).toHaveLength(2));
    hidden(all().find((node) => classesOf(node).includes("inset-0")));
  });

  it("draws Glass's sky and three bubbles", async () => {
    await inLook("glass", <Backdrop />, () => expect(drawings()).toHaveLength(4));
    hidden(all().find((node) => classesOf(node).includes("inset-0")));
  });

  it.each([
    [
      "light",
      [
        ["bg-flourish", 0.3],
        ["bg-secondary", 0.35],
        ["bg-accent", 0.3],
      ],
    ],
    [
      "dark",
      [
        ["bg-flourish", 0.3],
        ["bg-secondary", 0.25],
        ["bg-accent", 0.15],
      ],
    ],
  ] as const)("draws Bold Contrast's three blocks at the %s tints", async (scheme, drawn) => {
    mockColorScheme = scheme;
    await inLook("bold", <Backdrop />, () => expect(blocks()).toEqual(drawn));
    expect(drawings()).toEqual([]);
  });

  it.each(["organic", "glass", "bold"] as const)(
    "draws nothing in the %s style with high contrast on",
    async (look) => {
      store.set(CONTRAST, "true");
      // The card beside it shows the style was read: a pill style's rounding.
      await inLook(
        look,
        <>
          <Backdrop />
          <Card testID="card" />
        </>,
        () => expect(classesOf(screen.getByTestId("card"))).toContain("rounded-3xl"),
      );
      expect(drawings()).toEqual([]);
      expect(blocks()).toEqual([]);
    },
  );
});

describe("MomentGround", () => {
  const ground = <MomentGround width={300} height={180} shape="bean" angle={-12} />;
  const room = () =>
    all().find((node) => {
      const style = StyleSheet.flatten(node.props?.style as never) as
        | { width?: unknown; height?: unknown }
        | undefined;
      return style?.width === 300 && style?.height === 180;
    });

  it("keeps the room and draws nothing in it in today's style", async () => {
    await renderWithTheme(ground);
    hidden(room());
    expect(drawings()).toEqual([]);
    expect(blocks()).toEqual([]);
  });

  it("is Organic Pop's gradient shape", async () => {
    await inLook("organic", ground, () => expect(drawings()).toHaveLength(1));
    hidden(room());
  });

  it("is Glass's frosted pane on two bubbles", async () => {
    await inLook("glass", ground, () => expect(drawings()).toHaveLength(2));
    hidden(room());
    expect(all().some((node) => classesOf(node).includes("bg-card/80"))).toBe(true);
  });

  it("is Bold Contrast's accent block on a block of the flourish", async () => {
    await inLook("bold", ground, () =>
      expect(blocks().map(([fill]) => fill)).toEqual(["bg-flourish", "bg-accent"]),
    );
    hidden(room());
  });
});

describe("momentInk", () => {
  it.each([
    ["none", "text-foreground"],
    ["blobs", "text-accent-foreground"],
    ["bubbles", "text-card-foreground"],
    ["blocks", "text-accent-foreground"],
  ] as const)("names the words' colour on the %s ground: %s", (backdrop, ink) => {
    expect(momentInk(backdrop)).toBe(ink);
  });
});

describe("Patch", () => {
  it.each([
    ["soft", ["bg-accent", "rounded-full"]],
    ["lavender", ["bg-secondary", "rounded-[28px]"]],
  ] as const)("is a block in Bold Contrast, %s in its colour and shape", async (run, drawn) => {
    await inLook(
      "bold",
      <Patch width={100} height={100} shape="puddle" run={run} angle={24} />,
      () => expect(blocks()).toHaveLength(1),
    );
    const block = all().find((node) => classesOf(node).includes(drawn[0]));
    expect(classesOf(block as HostNode)).toEqual(expect.arrayContaining([...drawn]));
    expect(StyleSheet.flatten(block?.props?.style as never)).toMatchObject({
      width: 80,
      height: 80,
      transform: [{ rotate: "2deg" }],
    });
  });

  it("is a bubble in Glass", async () => {
    await inLook("glass", <Patch width={120} height={90} shape="puddle" run="soft" />, () =>
      expect(drawings().map((node) => [node.props?.width, node.props?.height])).toEqual([[90, 90]]),
    );
  });

  it("is a gradient blob elsewhere", async () => {
    await renderWithTheme(<Patch width={120} height={90} shape="puddle" run="lavender" />);
    expect(drawings().map((node) => [node.props?.width, node.props?.height])).toEqual([[120, 90]]);
  });
});
