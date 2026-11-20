import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import X from "lucide-react-native/icons/x";
import { useContext } from "react";
import { Text as RNText, StyleSheet } from "react-native";
import { renderWithTheme, underProviders } from "@/test/render";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text, TextClassContext } from "./text";

// The ink a phone reads from the root view's token set; the test runner has no
// compiled stylesheet to read it from.
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useUnstableNativeVariable: (name: string) =>
    name === "--stroke" ? [222, "40%", "14%"] : undefined,
}));

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

// The button (#12, TD-9): a 44 pt target whatever its size, a role a screen
// reader announces, plain text that labels itself, and a disabled state that
// is said and not only drawn.

describe("Button", () => {
  it("wraps plain text so it labels itself, and presses", async () => {
    const pressed = jest.fn();
    await renderWithTheme(<Button onPress={pressed}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(button.props.accessibilityState).toEqual({ disabled: false });
    expect(screen.getByText("Save").props.className).toMatch(/text-primary-foreground/);
    await fireEvent.press(button);
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("says it is disabled, looks it, and ignores presses", async () => {
    const pressed = jest.fn();
    await renderWithTheme(
      <Button disabled onPress={pressed}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.props.accessibilityState).toEqual({ disabled: true });
    await fireEvent.press(button);
    expect(pressed).not.toHaveBeenCalled();
  });

  // Drawn, not faded (#467): opacity took the label to about 3:1 in the
  // high-contrast sets. Every variant, disabled, is the same shape.
  it.each(["default", "destructive", "outline", "secondary", "ghost"] as const)(
    "draws the %s variant disabled as a dashed outline with a muted label, never faded",
    async (variant) => {
      await renderWithTheme(
        <Button variant={variant} disabled>
          Save
        </Button>,
      );
      const classes = screen.getByRole("button", { name: "Save" }).props.className as string;
      expect(classes).not.toMatch(/opacity-/);
      expect(classes).toMatch(/(^| )border( |$)/);
      expect(classes).toMatch(/\bborder-dashed\b/);
      expect(classes).not.toMatch(/\bborder-solid\b/);
      expect(classes).toMatch(/\bborder-input\b/);
      expect(classes).toMatch(/(^| )bg-transparent( |$)/);
      expect(classes).not.toMatch(/(^| )bg-(primary|destructive|secondary|background)( |$)/);
      // No pressed fill either, which the web also draws under a hover.
      expect(classes).toMatch(/\bactive:bg-transparent\b/);
      expect(classes).not.toMatch(/\bactive:bg-(primary|destructive|secondary|accent)\b/);
      const label = screen.getByText("Save").props.className as string;
      expect(label).toMatch(/\btext-muted-foreground\b/);
      expect(label).not.toMatch(/\btext-(primary|destructive|secondary)-foreground\b/);
    },
  );

  // Android keeps a border's dash when its style goes away, so a button enabled
  // again has to say solid, on the same element (#548).
  it.each(["default", "destructive", "outline", "secondary", "ghost"] as const)(
    "says solid when the %s variant is enabled again, so Android drops the dash",
    async (variant) => {
      const { rerender } = await renderWithTheme(
        <Button variant={variant} disabled>
          Save
        </Button>,
      );
      await rerender(underProviders(<Button variant={variant}>Save</Button>));
      const classes = screen.getByRole("button", { name: "Save" }).props.className as string;
      expect(classes).toMatch(/\bborder-solid\b/);
      expect(classes).not.toMatch(/\bborder-dashed\b/);
    },
  );

  it("hands an icon of a disabled button the muted colour too, through the text class", async () => {
    // Icon takes its colour from TextClassContext, which jest cannot see on the
    // svg once NativeWind has turned it into style: read the context itself.
    function Probe() {
      return <RNText testID="probe">{useContext(TextClassContext)}</RNText>;
    }
    await renderWithTheme(
      <Button variant="outline" size="icon" accessibilityLabel="Fewer" disabled>
        <Icon as={X} />
        <Probe />
      </Button>,
    );
    expect(screen.getByTestId("probe").props.children).toMatch(/\btext-muted-foreground\b/);
    expect(screen.getByRole("button", { name: "Fewer" }).props.className).toMatch(
      /\bborder-dashed\b/,
    );
  });

  it("draws an enabled button solid and in its own colours", async () => {
    await renderWithTheme(<Button variant="outline">Cancel</Button>);
    const classes = screen.getByRole("button", { name: "Cancel" }).props.className as string;
    expect(classes).not.toMatch(/\bborder-dashed\b/);
    expect(classes).toMatch(/\bbg-background\b/);
    expect(screen.getByText("Cancel").props.className).toMatch(/(^| )text-foreground( |$)/);
  });

  it("takes a caller's role and state, keeping its own disabled flag", async () => {
    await renderWithTheme(
      <Button accessibilityRole="radio" accessibilityState={{ selected: true }}>
        Dark
      </Button>,
    );
    expect(screen.getByRole("radio", { name: "Dark" }).props.accessibilityState).toEqual({
      selected: true,
      disabled: false,
    });
  });

  it("labels an icon-only button with the label it was given, and keeps the child as it is", async () => {
    await renderWithTheme(
      <Button variant="outline" size="icon" accessibilityLabel="Close">
        <Icon as={X} />
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
  });

  it.each(["destructive", "secondary", "ghost"] as const)(
    "gives the %s variant the same transparent 1 px border, so disabling it never resizes it (#239, #467)",
    async (variant) => {
      await renderWithTheme(<Button variant={variant}>Block</Button>);
      const classes = screen.getByRole("button", { name: "Block" }).props.className as string;
      expect(classes).toMatch(/(^| )border( |$)/);
      expect(classes).toMatch(/\bborder-transparent\b/);
    },
  );

  it("draws a chosen choice (default) and an unchosen one (outline) the same size: both have a 1 px border (#239)", async () => {
    await renderWithTheme(
      <>
        <Button accessibilityState={{ selected: true }}>Gemini</Button>
        <Button variant="outline" accessibilityState={{ selected: false }}>
          Cancer
        </Button>
      </>,
    );
    const chosen = screen.getByRole("button", { name: "Gemini" }).props.className;
    const unchosen = screen.getByRole("button", { name: "Cancer" }).props.className;
    expect(chosen).toMatch(/(^| )border( |$)/);
    expect(chosen).toMatch(/\bborder-transparent\b/);
    expect(unchosen).toMatch(/(^| )border( |$)/);
  });

  // Saiga Regular, as dark as the system font's Semibold, the weight a phone
  // gives a button's words (#408).
  it("draws its words in Saiga Regular on one line at body size", async () => {
    await renderWithTheme(<Button>Save</Button>);
    const words = String(screen.getByText("Save").props.className).split(" ");
    expect(words).toEqual(expect.arrayContaining(["font-sans", "text-control", "font-normal"]));
    expect(words).not.toContain("font-system");
    expect(words).not.toContain("font-semibold");
  });

  it.each([
    ["destructive", /text-destructive-foreground/],
    ["outline", /text-foreground/],
    ["secondary", /text-secondary-foreground/],
    ["ghost", /text-foreground/],
  ] as const)("hands the %s variant's text colour to its text", async (variant, pattern) => {
    await renderWithTheme(
      <Button variant={variant} accessibilityLabel="Label">
        <Text>Label</Text>
      </Button>,
    );
    expect(screen.getByText("Label").props.className).toMatch(pattern);
  });

  // A label wrapped at the largest text sat to the left of a centred button
  // (#250): a drawn button centres its lines as it centres its content.
  it.each(["default", "destructive", "outline", "secondary"] as const)(
    "centres the %s variant's words, plain or composed, enabled or disabled",
    async (variant) => {
      await renderWithTheme(
        <>
          <Button variant={variant}>Save</Button>
          <Button variant={variant} accessibilityLabel="Retry">
            <Icon as={X} />
            <Text>Retry</Text>
          </Button>
          <Button variant={variant} disabled>
            Wait
          </Button>
        </>,
      );
      for (const words of ["Save", "Retry", "Wait"]) {
        expect(String(screen.getByText(words).props.className).split(" ")).toContain("text-center");
      }
    },
  );

  // A ghost button is a row or a link, and reads from the start.
  it("leaves a ghost button's words where its row or link puts them", async () => {
    await renderWithTheme(<Button variant="ghost">Back</Button>);
    expect(screen.getByText("Back").props.className).not.toMatch(/\btext-(center|left)\b/);
  });

  // A drawn button laid out from the start, a row of a list, says so on its words.
  it("lets a caller's words read from the start inside a drawn button", async () => {
    await renderWithTheme(
      <Button variant="outline" className="justify-start" accessibilityLabel="00100 Helsinki">
        <Text className="flex-1 text-left">Helsinki</Text>
      </Button>,
    );
    const words = String(screen.getByText("Helsinki").props.className).split(" ");
    expect(words).toContain("text-left");
    expect(words).not.toContain("text-center");
  });
});

// Today's look, the tech screen's since Kumpa: no hard shadow, no press offset.
describe("Button in today's look", () => {
  it("lies flat and stays put when pressed", async () => {
    await renderWithTheme(<Button>Send</Button>);
    const button = () => screen.getByRole("button", { name: "Send" });
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeUndefined();
    await fireEvent(button(), "pressIn");
    expect(StyleSheet.flatten(button().props.style).transform).toBeUndefined();
  });
});

// The designers' try, chosen on the tech screen outside production: a 2 px
// stroke in the ink, and a hard shadow the button moves into when pressed.
describe("Button in the neubrutalism try", () => {
  beforeEach(() => store.set("kuutti.preference.look", "neubrutalism"));
  afterEach(() => store.delete("kuutti.preference.look"));

  const shown = async (ui: React.ReactElement, name: string) => {
    await renderWithTheme(ui);
    const button = () => screen.getByRole("button", { name });
    await waitFor(() => expect(String(button().props.className).split(" ")).toContain("border-2"));
    return button;
  };

  it.each([
    ["default", "border-stroke"],
    ["destructive", "border-stroke"],
    ["outline", "border-stroke"],
    ["secondary", "border-stroke"],
    ["ghost", "border-transparent"],
  ] as const)("gives the %s variant the same 2 px border, here %s", async (variant, colour) => {
    const button = await shown(<Button variant={variant}>Block</Button>, "Block");
    const classes = String(button().props.className).split(" ");
    expect(classes).toContain(colour);
    expect(classes).not.toContain("border");
  });

  it("lies on its hard shadow, and pressed moves down into it", async () => {
    const button = await shown(<Button>Send</Button>, "Send");
    expect(StyleSheet.flatten(button().props.style)).toMatchObject({
      boxShadow: "2px 2px 0px 0px hsl(222, 40%, 14%)",
      minHeight: 44,
    });
    await fireEvent(button(), "pressIn");
    const pressed = StyleSheet.flatten(button().props.style);
    expect(pressed.boxShadow).toBeUndefined();
    expect(pressed.transform).toEqual([{ translateX: 2 }, { translateY: 2 }]);
    await fireEvent(button(), "pressOut");
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBe(
      "2px 2px 0px 0px hsl(222, 40%, 14%)",
    );
  });

  it("still tells a caller's own press handlers", async () => {
    const pressIn = jest.fn();
    const pressOut = jest.fn();
    const button = await shown(
      <Button onPressIn={pressIn} onPressOut={pressOut}>
        Send
      </Button>,
      "Send",
    );
    await fireEvent(button(), "pressIn");
    await fireEvent(button(), "pressOut");
    expect(pressIn).toHaveBeenCalledTimes(1);
    expect(pressOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a ghost button, a row or a link", { variant: "ghost" as const }],
    ["a disabled button, which lies flat", { disabled: true }],
  ])("draws no shadow on %s", async (_what, props) => {
    const button = await shown(<Button {...props}>Later</Button>, "Later");
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeUndefined();
    await fireEvent(button(), "pressIn");
    expect(StyleSheet.flatten(button().props.style).transform).toBeUndefined();
  });
});

/** The drawings inside a node, and those a screen reader would reach. */
const drawingsIn = (node: unknown, hidden = false): { all: number; spoken: number } => {
  if (Array.isArray(node)) {
    return node.reduce(
      (sum, each) => {
        const found = drawingsIn(each, hidden);
        return { all: sum.all + found.all, spoken: sum.spoken + found.spoken };
      },
      { all: 0, spoken: 0 },
    );
  }
  if (!node || typeof node !== "object") return { all: 0, spoken: 0 };
  const host = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown };
  const props = host.props ?? {};
  const under =
    hidden ||
    props.accessibilityElementsHidden === true ||
    props.importantForAccessibility === "no-hide-descendants" ||
    props["aria-hidden"] === true;
  const here = host.type === "RNSVGSvgView" ? 1 : 0;
  const below = drawingsIn(host.children, under);
  return { all: here + below.all, spoken: (here && !under ? 1 : 0) + below.spoken };
};

// A step's Continue (onward): the designers' tries draw an arrow at its end, as
// Sini's screens do; today's look draws the words alone. The arrow is never read.
describe("The way on, a step's Continue", () => {
  afterEach(() => store.delete("kuutti.preference.look"));

  it("is the words alone in today's look", async () => {
    await renderWithTheme(<Button onward>Continue</Button>);
    const button = screen.getByRole("button", { name: "Continue" });
    expect(drawingsIn(screen.toJSON()).all).toBe(0);
    expect(String(button.props.className).split(" ")).not.toContain("px-14");
  });

  it.each([
    ["neubrutalism", "border-2"],
    ["organic", "rounded-full"],
  ] as const)(
    "carries an arrow in the %s try, unheard, the words still its name and centred",
    async (look, drawnBy) => {
      store.set("kuutti.preference.look", look);
      await renderWithTheme(<Button onward>Continue</Button>);
      const button = () => screen.getByRole("button", { name: "Continue" });
      await waitFor(() => expect(String(button().props.className).split(" ")).toContain(drawnBy));
      expect(drawingsIn(screen.toJSON())).toEqual({ all: 1, spoken: 0 });
      // Room at both ends, so the words stay at the middle and clear of the arrow.
      expect(String(button().props.className).split(" ")).toContain("px-14");
      expect(String(screen.getByText("Continue").props.className).split(" ")).toContain(
        "text-center",
      );
    },
  );

  it.each(["neubrutalism", "organic"] as const)(
    "draws no arrow on a button that is not the way on, in the %s try",
    async (look) => {
      store.set("kuutti.preference.look", look);
      await renderWithTheme(<Button>Later</Button>);
      const button = () => screen.getByRole("button", { name: "Later" });
      await waitFor(() =>
        expect(String(button().props.className).split(" ")).toContain(
          look === "organic" ? "rounded-full" : "border-2",
        ),
      );
      expect(drawingsIn(screen.toJSON()).all).toBe(0);
      expect(String(button().props.className).split(" ")).not.toContain("px-14");
    },
  );
});

// Organic Pop (outside production): pills, Sini's, with no hard shadow and a
// press that only darkens; outline is the one variant with a visible stroke.
describe("Button in the Organic Pop try", () => {
  beforeEach(() => store.set("kuutti.preference.look", "organic"));
  afterEach(() => store.delete("kuutti.preference.look"));

  const shown = async (ui: React.ReactElement, name: string) => {
    await renderWithTheme(ui);
    const button = () => screen.getByRole("button", { name });
    await waitFor(() =>
      expect(String(button().props.className).split(" ")).toContain("rounded-full"),
    );
    return button;
  };

  it("is a pill on no shadow, and pressed stays where it is", async () => {
    const button = await shown(<Button>Send</Button>, "Send");
    expect(StyleSheet.flatten(button().props.style)).toMatchObject({ minHeight: 44 });
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeUndefined();
    await fireEvent(button(), "pressIn");
    expect(StyleSheet.flatten(button().props.style).transform).toBeUndefined();
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeUndefined();
  });

  it.each([
    ["default", "bg-primary"],
    ["destructive", "bg-destructive"],
    ["outline", "border-foreground"],
    ["secondary", "bg-secondary"],
  ] as const)("draws the %s variant in its own colour, here %s", async (variant, colour) => {
    const button = await shown(<Button variant={variant}>Block</Button>, "Block");
    expect(String(button().props.className).split(" ")).toContain(colour);
  });

  it("still says it is disabled, and ignores presses", async () => {
    const onPress = jest.fn();
    const button = await shown(
      <Button disabled onPress={onPress}>
        Send
      </Button>,
      "Send",
    );
    expect(button().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button());
    expect(onPress).not.toHaveBeenCalled();
  });
});

// Glass and Bold Contrast (outside production) are pills too, each with its own
// outline variant: Glass's a frosted pane in the primary's line, Bold
// Contrast's a thicker ink on a taller pill, its words in Saiga Medium.
describe.each([
  ["glass", ["border-primary", "bg-card/60"], "min-h-12"],
  ["bold", ["border-2", "border-foreground", "bg-transparent"], "min-h-14"],
] as const)("Button in the %s try", (look, outline, height) => {
  beforeEach(() => store.set("kuutti.preference.look", look));
  afterEach(() => store.delete("kuutti.preference.look"));

  const shown = async (ui: React.ReactElement, name: string) => {
    await renderWithTheme(ui);
    const button = () => screen.getByRole("button", { name });
    await waitFor(() =>
      expect(String(button().props.className).split(" ")).toContain("rounded-full"),
    );
    return button;
  };

  it("is a pill of its own height on no shadow", async () => {
    const button = await shown(<Button>Send</Button>, "Send");
    expect(String(button().props.className).split(" ")).toContain(height);
    expect(StyleSheet.flatten(button().props.style).boxShadow).toBeUndefined();
    await fireEvent(button(), "pressIn");
    expect(StyleSheet.flatten(button().props.style).transform).toBeUndefined();
  });

  it("draws its outline variant in its own way", async () => {
    const button = await shown(<Button variant="outline">Later</Button>, "Later");
    expect(String(button().props.className).split(" ")).toEqual(
      expect.arrayContaining([...outline]),
    );
  });

  it("weighs its words as the style asks", async () => {
    await shown(<Button>Send</Button>, "Send");
    const words = String(screen.getByText("Send").props.className).split(" ");
    if (look === "bold") expect(words).toContain("font-medium");
    else expect(words).not.toContain("font-medium");
  });

  it("is still drawn disabled, dashed and unfilled, and ignores presses", async () => {
    const onPress = jest.fn();
    const button = await shown(
      <Button disabled onPress={onPress}>
        Send
      </Button>,
      "Send",
    );
    expect(String(button().props.className).split(" ")).toEqual(
      expect.arrayContaining(["border-dashed", "bg-transparent"]),
    );
    expect(button().props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(button());
    expect(onPress).not.toHaveBeenCalled();
  });

  it("carries the arrow on a step's Continue, unheard", async () => {
    await shown(<Button onward>Continue</Button>, "Continue");
    expect(drawingsIn(screen.toJSON())).toEqual({ all: 1, spoken: 0 });
  });
});

// A pressed or hovered ghost or outline keeps its words' colour (text-foreground)
// and so needs a ground they are paired with: today's --accent is a neutral
// grey, while a try's --accent and --secondary are its loud colours, white on
// lavender in Neobrutalism's dark set. The try tints with the ink instead,
// which looks.test.ts holds the words to; Glass's outline presses to its card.
describe("A ghost or outline pressed", () => {
  afterEach(() => store.delete("kuutti.preference.look"));

  const classes = (name: string) =>
    String(screen.getByRole("button", { name }).props.className).split(" ");

  it.each(["ghost", "outline"] as const)(
    "fills with --accent in today's look, %s",
    async (variant) => {
      await renderWithTheme(<Button variant={variant}>Later</Button>);
      expect(classes("Later")).toContain("active:bg-accent");
      expect(classes("Later")).not.toContain("active:bg-foreground/10");
    },
  );

  it.each([
    ["neubrutalism", "ghost"],
    ["neubrutalism", "outline"],
    ["organic", "ghost"],
    ["organic", "outline"],
    ["glass", "ghost"],
    ["bold", "ghost"],
    ["bold", "outline"],
  ] as const)("tints with the ink in the %s try, %s", async (look, variant) => {
    store.set("kuutti.preference.look", look);
    await renderWithTheme(<Button variant={variant}>Later</Button>);
    await waitFor(() => expect(classes("Later")).toContain("active:bg-foreground/10"));
    expect(classes("Later").filter((name) => /^active:bg-(accent|secondary)\b/.test(name))).toEqual(
      [],
    );
  });

  it("presses to its card in the glass try, outline", async () => {
    store.set("kuutti.preference.look", "glass");
    await renderWithTheme(<Button variant="outline">Later</Button>);
    await waitFor(() => expect(classes("Later")).toContain("active:bg-card"));
    expect(classes("Later")).not.toContain("active:bg-accent");
  });

  it.each(["neubrutalism", "organic", "glass", "bold"] as const)(
    "lies unfilled when disabled in the %s try",
    async (look) => {
      store.set("kuutti.preference.look", look);
      await renderWithTheme(
        <>
          <Button variant="ghost">Later</Button>
          <Button variant="ghost" disabled>
            Never
          </Button>
        </>,
      );
      // The enabled one says the style has loaded.
      await waitFor(() => expect(classes("Later")).toContain("active:bg-foreground/10"));
      expect(classes("Never")).toContain("active:bg-transparent");
      expect(classes("Never")).not.toContain("active:bg-foreground/10");
    },
  );
});
