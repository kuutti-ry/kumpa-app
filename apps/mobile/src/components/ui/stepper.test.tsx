import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { AccessibilityInfo, Platform, StyleSheet } from "react-native";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { hasCutText } from "@/test/layout";
import { renderWithTheme, underProviders } from "@/test/render";
import { Stepper } from "./stepper";

// A number between a minus and a plus (ADR-010 §9, #146, #148): both answers
// are labelled buttons that stand well clear of the number (#581), the number
// is announced as it changes, and a step past either end is not offered.

function show(props: Partial<React.ComponentProps<typeof Stepper>> = {}) {
  const onChange = jest.fn();
  return renderWithTheme(
    <Stepper
      label="Height"
      value={170}
      shown="170 cm"
      downLabel="One centimetre less"
      upLabel="One centimetre more"
      canDown
      canUp
      onChange={onChange}
      {...props}
    />,
  ).then(() => onChange);
}

describe("Stepper", () => {
  it("names the number and steps it down and up by one", async () => {
    const onChange = await show();
    expect(screen.getByText("Height")).toBeTruthy();
    expect(screen.getByText("170 cm").props.accessibilityLiveRegion).toBe("polite");
    await fireEvent.press(screen.getByRole("button", { name: "One centimetre less" }));
    await fireEvent.press(screen.getByRole("button", { name: "One centimetre more" }));
    expect(onChange.mock.calls).toEqual([[169], [171]]);
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it("is no heading, drawn as large as one, and keeps its live region (#542)", async () => {
    await show();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("170 cm").props.accessibilityLiveRegion).toBe("polite");
  });

  it("does not step below the lower end", async () => {
    const onChange = await show({ canDown: false });
    const down = screen.getByRole("button", { name: "One centimetre less" });
    expect(down.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(down);
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "One centimetre more" }).props.accessibilityState
        ?.disabled,
    ).toBe(false);
  });

  it("does not step above the upper end", async () => {
    const onChange = await show({ canUp: false });
    const up = screen.getByRole("button", { name: "One centimetre more" });
    expect(up.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(up);
    expect(onChange).not.toHaveBeenCalled();
  });

  // The class of the stepper's own root, found by the classes it always has.
  const rootClass = () =>
    JSON.stringify(screen.toJSON()).match(/"className":"([^"]*\bitems-center gap-1\b[^"]*)"/)?.[1];

  it("takes no flex of its own, so a column cannot shrink it under what follows (#238)", async () => {
    await show();
    expect(rootClass()).toBeDefined();
    expect(rootClass()).not.toMatch(/\bflex-1\b/);
  });

  it("stands its minus and plus well clear of the number (#581)", async () => {
    await show();
    const minus = screen.getByRole("button", { name: "One centimetre less" });
    const number = screen.getByText("170 cm");
    // The minus, the number and the plus are the one row's three children.
    const row = minus.parent;
    expect(row?.props.className).toMatch(/\bflex-row\b/);
    expect(row?.props.className).toMatch(/\bgap-6\b/);
    expect(row?.props.className).not.toMatch(/\bgap-[0-5]\b/);
    expect(number.parent).toBe(row);
    expect(screen.getByRole("button", { name: "One centimetre more" }).parent).toBe(row);
  });

  it("lets what it shows wrap before its buttons do, never cut at the largest text (#581)", async () => {
    await show({ shown: "No answer yet, and a long way from one" });
    const shown = screen.getByText("No answer yet, and a long way from one");
    expect(shown.props.className).toMatch(/\bshrink\b/);
    expect(hasCutText(screen.toJSON() as HostNode)).toBe(false);
  });

  /** The children of every host Text drawn: a label left empty still takes a line of the column. */
  const texts = () => {
    const found: unknown[] = [];
    const visit = (node: HostNode | string) => {
      if (typeof node === "string") return;
      if (node.type === "Text") found.push(node.children ?? []);
      for (const child of node.children ?? []) visit(child);
    };
    visit(screen.toJSON() as HostNode);
    return found;
  };

  it("draws no label of its own where the field above names the number (#238)", async () => {
    await show({ label: undefined });
    // The number is the one text: no empty label line above it.
    expect(texts()).toEqual([["170 cm"]]);
    expect(screen.getByRole("button", { name: "One centimetre more" })).toBeTruthy();
  });

  describe("said aloud as it changes (#542)", () => {
    const stepper = (value: number, shown: string) => (
      <Stepper
        value={value}
        shown={shown}
        downLabel="One centimetre less"
        upLabel="One centimetre more"
        canDown
        canUp
        onChange={jest.fn()}
      />
    );
    /** What was said, spied from now on: the default platform in a test is iOS, so each test names its own. */
    const hearing = (os: "ios" | "android") => {
      jest.replaceProperty(Platform, "OS", os);
      const said = jest.spyOn(AccessibilityInfo, "announceForAccessibilityWithOptions");
      said.mockClear();
      return said;
    };

    afterEach(() => jest.restoreAllMocks());

    it("says the number on iOS, which has no live region, queued behind the button's name", async () => {
      const said = hearing("ios");
      const view = await renderWithTheme(stepper(170, "170 cm"));
      await view.rerender(underProviders(stepper(171, "171 cm")));
      expect(said.mock.calls).toEqual([["171 cm", { queue: true }]]);
    });

    it("says nothing when the screen opens", async () => {
      const said = hearing("ios");
      await renderWithTheme(stepper(170, "170 cm"));
      expect(said).not.toHaveBeenCalled();
    });

    it("says nothing while what is shown stays, whatever else renders", async () => {
      const said = hearing("ios");
      const view = await renderWithTheme(stepper(170, "No answer yet"));
      await view.rerender(underProviders(stepper(170, "No answer yet")));
      // Unset, the value moves and the words do not: nothing a person would hear change.
      await view.rerender(underProviders(stepper(171, "No answer yet")));
      expect(said).not.toHaveBeenCalled();
    });

    it("says each change, the number it came from too", async () => {
      const said = hearing("ios");
      const view = await renderWithTheme(stepper(170, "170 cm"));
      await view.rerender(underProviders(stepper(171, "171 cm")));
      await view.rerender(underProviders(stepper(170, "170 cm")));
      expect(said.mock.calls.map(([words]) => words)).toEqual(["171 cm", "170 cm"]);
    });

    it("leaves it to the live region on Android, which would say it twice", async () => {
      const said = hearing("android");
      const view = await renderWithTheme(stepper(170, "170 cm"));
      await view.rerender(underProviders(stepper(171, "171 cm")));
      expect(said).not.toHaveBeenCalled();
      expect(screen.getByText("171 cm").props.accessibilityLiveRegion).toBe("polite");
    });
  });
});

// The designers' tries of the tech screen (outside production) draw the stepper
// as Sini's age screen: a card with a tab for its label in neubrutalism, a pill
// on a soft shape in Organic Pop. What it says and does is today's.
describe.each([
  ["neubrutalism", "rounded-2xl border-solid border-stroke"],
  ["organic", "rounded-[32px]"],
  ["glass", "rounded-[32px]"],
  ["bold", "rounded-[32px]"],
] as const)("Stepper in the %s try", (look, drawnBy) => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  beforeEach(() => store.set("kuutti.preference.look", look));
  afterEach(() => store.delete("kuutti.preference.look"));

  const drawn = async (props: Partial<React.ComponentProps<typeof Stepper>> = {}) => {
    const onChange = await show(props);
    await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain(drawnBy));
    return onChange;
  };

  it("names the number, says it as it changes, and steps it down and up by one", async () => {
    const onChange = await drawn();
    expect(screen.getByText("Height")).toBeTruthy();
    expect(screen.getByText("170 cm").props.accessibilityLiveRegion).toBe("polite");
    expect(screen.queryByRole("heading")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "One centimetre less" }));
    await fireEvent.press(screen.getByRole("button", { name: "One centimetre more" }));
    expect(onChange.mock.calls).toEqual([[169], [171]]);
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it.each([
    ["below the lower end", { canDown: false }, "One centimetre less"],
    ["above the upper end", { canUp: false }, "One centimetre more"],
  ] as const)("does not step %s", async (_where, props, name) => {
    const onChange = await drawn(props);
    const button = screen.getByRole("button", { name });
    expect(button.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("draws no label of its own where the field above names the number", async () => {
    await drawn({ label: undefined });
    expect(screen.queryByText("Height")).toBeNull();
    expect(screen.getByText("170 cm")).toBeTruthy();
  });
});

describe("Stepper's tone in the neubrutalism try", () => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  beforeEach(() => store.set("kuutti.preference.look", "neubrutalism"));
  afterEach(() => store.delete("kuutti.preference.look"));

  it.each([
    ["the card's", "card", "bg-card", "text-card-foreground"],
    ["the secondary colour's", "secondary", "bg-secondary", "text-secondary-foreground"],
  ] as const)(
    "fills its card with %s and writes the number in its ink",
    async (_what, tone, fill, ink) => {
      await show({ tone });
      await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain("border-stroke"));
      expect(JSON.stringify(screen.toJSON())).toMatch(
        new RegExp(`border-stroke[^"]*\\b${fill}\\b`),
      );
      expect(screen.getByText("170 cm").props.className).toMatch(new RegExp(`\\b${ink}\\b`));
    },
  );
});

// The pill styles write the number as their headline: Organic Pop's slanted
// Saiga Extrabold, Glass's and Bold Contrast's Saiga italic; Glass's pill and
// tab are frosted panes over the backdrop, solid again in high contrast.
describe.each([
  ["organic", "font-extrabold", [{ skewX: "-9deg" }], "bg-card"],
  ["glass", "italic", undefined, "bg-card/70"],
  ["bold", "italic", undefined, "bg-card"],
] as const)("Stepper's number and pane in the %s try", (look, face, transform, pane) => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  beforeEach(() => store.set("kuutti.preference.look", look));
  afterEach(() => {
    store.delete("kuutti.preference.look");
    store.delete("kuutti.preference.highContrast");
  });

  /** The classes of the pill and of the tab above it. */
  const panes = () =>
    JSON.stringify(screen.toJSON()).match(/"className":"[^"]*rounded-(\[32px\]|t-2xl)[^"]*"/g) ??
    [];

  it("writes the number in the style's face", async () => {
    await show();
    await waitFor(() => expect(JSON.stringify(screen.toJSON())).toContain("rounded-[32px]"));
    const number = screen.getByText("170 cm");
    expect(String(number.props.className).split(" ")).toContain(face);
    expect(StyleSheet.flatten(number.props.style).transform).toEqual(transform);
  });

  it("draws its pill and tab on the style's pane", async () => {
    await show();
    await waitFor(() => expect(panes()).toHaveLength(2));
    for (const each of panes()) expect(each.split(/[\s"]/)).toContain(pane);
  });

  it("draws them solid with high contrast on", async () => {
    store.set("kuutti.preference.highContrast", "true");
    await show();
    await waitFor(() => expect(panes()).toHaveLength(2));
    for (const each of panes()) {
      expect(each.split(/[\s"]/)).toContain("bg-card");
      expect(each).not.toContain("bg-card/70");
    }
  });
});
