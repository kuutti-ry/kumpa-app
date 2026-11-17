import { screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { renderWithTheme } from "@/test/render";
import { StepProgress, StepTitle } from "./step-heading";

// A step's question and where the walk stands (onboarding, #581), in today's
// look and in the designers' tries of the tech screen (outside production):
// the words are what a screen reader reads, the same in every look, and the
// shapes, sparks and bar drawn around them are never read.

let mockColorScheme: "light" | "dark" = "light";
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useColorScheme: () => ({ colorScheme: mockColorScheme, setColorScheme: jest.fn() }),
}));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const LOOK = "kuutti.preference.look";
const QUESTION = "Whom are you looking for?";

type HostNode = { type?: string; props?: Record<string, unknown>; children?: unknown };

/** Walks the drawn tree, telling each node whether a screen reader is kept out of it. */
const walk = (visit: (node: HostNode, hidden: boolean) => void) => {
  const go = (node: unknown, hidden: boolean): void => {
    if (Array.isArray(node)) {
      for (const each of node) go(each, hidden);
      return;
    }
    if (!node || typeof node !== "object") return;
    const host = node as HostNode;
    const props = host.props ?? {};
    const under =
      hidden ||
      props.accessibilityElementsHidden === true ||
      props.importantForAccessibility === "no-hide-descendants";
    visit(host, under);
    go(host.children, under);
  };
  go(screen.toJSON(), false);
};

/** The drawings on the screen, and those of them a screen reader would reach. */
const drawings = () => {
  const all: string[] = [];
  const spoken: string[] = [];
  walk((node, hidden) => {
    if (typeof node.type !== "string" || node.type !== "RNSVGSvgView") return;
    all.push(node.type);
    if (!hidden) spoken.push(node.type);
  });
  return { all, spoken };
};

/** The bar's segments, by the token each is filled with, and whether any is read. */
const segments = () => {
  const fills: string[] = [];
  let spoken = 0;
  walk((node, hidden) => {
    const className = String(node.props?.className ?? "");
    if (!/\bflex-1 rounded-full\b/.test(className)) return;
    fills.push(className.match(/\bbg-(primary|ring|border|card)\b/)?.[1] ?? "none");
    if (!hidden) spoken += 1;
  });
  return { fills, spoken };
};

describe.each(["today", "neubrutalism", "organic"] as const)(
  "A step's heading in %s's look",
  (look) => {
    beforeEach(() => {
      if (look !== "today") store.set(LOOK, look);
    });
    afterEach(() => {
      store.delete(LOOK);
      mockColorScheme = "light";
    });

    /** Renders, and waits until the stored look has been read and drawn. */
    const shown = async (ui: React.ReactElement, drawn: () => boolean) => {
      await renderWithTheme(ui);
      if (look !== "today") await waitFor(() => expect(drawn()).toBe(true));
    };

    it("reads the step's question as the screen's one heading, and none of what is drawn round it", async () => {
      await shown(<StepTitle>{QUESTION}</StepTitle>, () => drawings().all.length > 0);
      expect(screen.getAllByRole("heading").map((each) => each.props.children)).toEqual([QUESTION]);
      expect(drawings().spoken).toEqual([]);
    });

    it("says where the walk stands where it changes, and never reads the bar", async () => {
      await shown(<StepProgress step={3} total={8} />, () => segments().fills.length > 0);
      expect(screen.getByText("Step 3 of 8").props.accessibilityLiveRegion).toBe("polite");
      expect(segments().spoken).toBe(0);
    });
  },
);

describe("The bar under a step's progress", () => {
  afterEach(() => store.delete(LOOK));

  it("has none in today's look: the words alone", async () => {
    await renderWithTheme(<StepProgress step={3} total={8} />);
    expect(screen.getByText("Step 3 of 8")).toBeTruthy();
    expect(segments().fills).toEqual([]);
  });

  it("fills a segment for every step reached in the neubrutalism try, this one among them", async () => {
    store.set(LOOK, "neubrutalism");
    await renderWithTheme(<StepProgress step={3} total={8} />);
    await waitFor(() => expect(segments().fills).toHaveLength(8));
    expect(segments().fills).toEqual([...Array(3).fill("primary"), ...Array(5).fill("card")]);
  });

  it("fills the steps done in Organic Pop and marks this one apart, as Sini's bar", async () => {
    store.set(LOOK, "organic");
    await renderWithTheme(<StepProgress step={3} total={8} />);
    await waitFor(() => expect(segments().fills).toHaveLength(8));
    expect(segments().fills).toEqual(["primary", "primary", "ring", ...Array(5).fill("border")]);
  });
});

describe("Organic Pop's shape behind a step's question", () => {
  beforeEach(() => store.set(LOOK, "organic"));
  afterEach(() => {
    store.delete(LOOK);
    mockColorScheme = "light";
  });

  /** The opacity of the shape's own view, the one that holds the drawing. */
  const shapeOpacity = () => {
    let opacity: unknown;
    walk((node) => {
      const style = StyleSheet.flatten(node.props?.style as never) as
        | { position?: string; opacity?: number }
        | undefined;
      if (style?.position === "absolute" && opacity === undefined) opacity = style.opacity;
    });
    return opacity;
  };

  it.each([
    ["light", 1],
    ["dark", 0.3],
  ] as const)(
    "is drawn at %s's strength, so the words over its edge still read",
    async (scheme, opacity) => {
      mockColorScheme = scheme;
      await renderWithTheme(<StepTitle>{QUESTION}</StepTitle>);
      await waitFor(() => expect(drawings().all.length).toBeGreaterThan(0));
      expect(shapeOpacity()).toBe(opacity);
    },
  );
});
