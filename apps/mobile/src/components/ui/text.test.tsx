import { fireEvent, render, screen, waitFor, within } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { renderWithTheme, underProviders } from "@/test/render";
import { HEADING_FONT_SCALE, MAX_FONT_SCALE } from "@/theme/a11y";
import { Text, TextClassContext } from "./text";

// Text (#12, TD-9): headings are announced as headings with their level, the
// size follows the OS up to MAX_FONT_SCALE, and a parent's text class applies.

describe("Text", () => {
  it.each([
    ["h1", "1"],
    ["h2", "2"],
    ["h3", "3"],
    ["h4", "4"],
  ] as const)("announces %s as a heading of level %s", async (variant, level) => {
    await renderWithTheme(<Text variant={variant}>Title</Text>);
    const heading = screen.getByRole("heading", { name: "Title" });
    expect(heading.props["aria-level"]).toBe(level);
  });

  it.each(["default", "group", "small", "muted"] as const)(
    "is plain text, not a heading, as %s",
    async (variant) => {
      await renderWithTheme(<Text variant={variant}>Body</Text>);
      expect(screen.queryByRole("heading")).toBeNull();
      expect(screen.getByText("Body").props.maxFontSizeMultiplier).toBe(2);
    },
  );

  // What is read is in the phone's own font; Saiga draws headings and short
  // labels (#408, ADR-052 §4).
  const VARIANTS = ["h1", "h2", "h3", "h4", "title", "group", "small", "muted", "default"] as const;
  const SAIGA = new Set<(typeof VARIANTS)[number]>([
    "h1",
    "h2",
    "h3",
    "h4",
    "title",
    "group",
    "small",
  ]);
  const classesOf = async (variant: (typeof VARIANTS)[number]): Promise<string> => {
    await renderWithTheme(<Text variant={variant}>Words</Text>);
    return String(screen.getByText("Words").props.className);
  };
  const has = (className: string, utility: string): boolean =>
    className.split(" ").includes(utility);

  it.each(VARIANTS)("draws %s in the family of its role", async (variant) => {
    const className = await classesOf(variant);
    const [own, other] = SAIGA.has(variant)
      ? ["font-sans", "font-system"]
      : ["font-system", "font-sans"];
    expect(has(className, own)).toBe(true);
    expect(has(className, other)).toBe(false);
  });

  // Saiga Regular is as dark as the system font's Semibold: it takes
  // Semibold's jobs, Bold is h1's alone, and Saiga has no semibold of its own.
  it.each(VARIANTS)("gives %s no semibold, and Bold only if it is h1", async (variant) => {
    const className = await classesOf(variant);
    expect(has(className, "font-semibold")).toBe(false);
    expect(has(className, "font-extrabold")).toBe(false);
    expect(has(className, "font-bold")).toBe(variant === "h1");
  });

  // Headings grow less with the OS, the larger they are (#467).
  const growth = (variant: (typeof VARIANTS)[number]): number =>
    (HEADING_FONT_SCALE as Partial<Record<string, number>>)[variant] ?? MAX_FONT_SCALE;
  // The scale's sizes, in points on a phone, read from the theme itself.
  const SCALE = jest.requireActual<{
    theme: { extend: { fontSize: Record<string, [string, object]> } };
  }>("../../../tailwind.config.js").theme.extend.fontSize;
  const points = (className: string): number => {
    const size = Object.keys(SCALE).find((name) => has(className, `text-${name}`));
    if (size === undefined) throw new Error(`no font size in "${className}"`);
    return Number.parseFloat((SCALE[size] as [string, object])[0]);
  };

  it.each(["h1", "h2", "h3", "h4", "title"] as const)(
    "lets %s grow as far as its own scale",
    async (variant) => {
      await renderWithTheme(<Text variant={variant}>Title</Text>);
      expect(screen.getByRole("heading", { name: "Title" }).props.maxFontSizeMultiplier).toBe(
        growth(variant),
      );
    },
  );

  it("keeps the headings in order at the largest size, h1 to h3 and a title above body text", async () => {
    // From the sizes the variants draw, so a new text class is held too.
    const ORDER = ["h1", "h2", "h3", "h4", "title", "default"] as const;
    await renderWithTheme(
      <>
        {ORDER.map((variant) => (
          <Text key={variant} variant={variant}>
            {variant}
          </Text>
        ))}
      </>,
    );
    const largest = Object.fromEntries(
      ORDER.map((variant) => {
        const text = screen.getByText(variant);
        return [variant, points(text.props.className) * text.props.maxFontSizeMultiplier];
      }),
    ) as Record<(typeof ORDER)[number], number>;
    expect(largest.h1).toBeGreaterThan(largest.h2);
    expect(largest.h2).toBeGreaterThan(largest.h3);
    expect(largest.h3).toBeGreaterThan(largest.h4);
    expect(largest.title).toBeGreaterThan(largest.default);
    // h4 is body text's size at every size, set apart by Saiga Medium.
    expect(largest.h4).toBe(largest.default);
    // And none grows more than text does.
    for (const variant of VARIANTS) expect(growth(variant)).toBeLessThanOrEqual(MAX_FONT_SCALE);
  });

  it("takes a caller's own maxFontSizeMultiplier over its variant's", async () => {
    await renderWithTheme(
      <Text variant="h1" maxFontSizeMultiplier={1}>
        Fixed
      </Text>,
    );
    expect(screen.getByText("Fixed").props.maxFontSizeMultiplier).toBe(1);
  });

  it("is plain text when the variant is explicitly none", async () => {
    await renderWithTheme(<Text variant={null}>Bare</Text>);
    const text = screen.getByText("Bare");
    expect(text.props.role).toBeUndefined();
    expect(text.props["aria-level"]).toBeUndefined();
  });

  it("puts its role and classes on the child instead of a text of its own with asChild", async () => {
    await renderWithTheme(
      <Text asChild variant="h2">
        <Text>Child</Text>
      </Text>,
    );
    const heading = screen.getByRole("heading", { name: "Child" });
    expect(heading.props["aria-level"]).toBe("2");
    expect(heading.props.className).toMatch(/(^| )text-h2( |$)/);
    // One host text, not a text inside a text.
    expect(screen.getAllByText("Child")).toHaveLength(1);
  });

  it("takes the text class its parent hands down, the caller's class last", async () => {
    await renderWithTheme(
      <TextClassContext.Provider value="text-primary-foreground">
        <Text className="underline">Inside a button</Text>
      </TextClassContext.Provider>,
    );
    expect(screen.getByText("Inside a button").props.className).toMatch(
      /text-primary-foreground underline$/,
    );
  });
});

// A heading's words never break in the middle (#467, #757). The phone's own
// lines decide: a heading stays one text while they break between words or
// after a hyphen, and is drawn as its words once a line ends inside one, as
// Android drew "Ihmiset Kumpa-so" over "velluksessa".
describe("a heading's words (#757)", () => {
  const HEADING = "Ihmiset Kumpa-sovelluksessa";
  /** What the phone reports after laying the text out: each line with the space it ends at. */
  const layout = (...lines: string[]) => ({
    nativeEvent: { lines: lines.map((text) => ({ text })) },
  });
  const BROKEN = layout("Ihmiset Kumpa-so", "velluksessa");
  const laidOut = async (words: string, event: ReturnType<typeof layout>) => {
    await fireEvent(screen.getByText(words), "textLayout", event);
  };
  /** The heading's texts, in order, as the words it is drawn as. */
  const texts = () =>
    screen
      .getAllByText(/./, { includeHiddenElements: true })
      .map((node) => node.props.children as string);

  it.each([
    ["on one line", layout(HEADING)],
    ["between its words", layout("Ihmiset ", "Kumpa-sovelluksessa")],
    ["after the hyphen", layout("Ihmiset Kumpa-", "sovelluksessa")],
    ["at a line's end", layout("Ihmiset\n", "Kumpa-sovelluksessa")],
    ["inside its last line only, which ends where the text does", layout("Ihmiset ", "Kumpa-so")],
    ["nowhere, laid out empty", layout()],
  ])("stays one text while the phone breaks it %s", async (_where, event) => {
    await renderWithTheme(<Text variant="title">{HEADING}</Text>);
    await laidOut(HEADING, event);
    expect(texts()).toEqual([HEADING]);
    expect(screen.getByRole("heading", { name: HEADING }).props.onTextLayout).toBeDefined();
  });

  it("is drawn as its words once the phone breaks a line inside one, each a line that shrinks alone", async () => {
    await renderWithTheme(<Text variant="title">{HEADING}</Text>);
    await laidOut(HEADING, BROKEN);
    expect(texts()).toEqual(["Ihmiset ", "Kumpa-", "sovelluksessa"]);
    for (const word of ["Ihmiset ", "Kumpa-", "sovelluksessa"]) {
      const text = screen.getByText(word, { includeHiddenElements: true });
      expect(text.props.numberOfLines).toBe(1);
      expect(text.props.adjustsFontSizeToFit).toBe(true);
      expect(text.props.maxFontSizeMultiplier).toBe(HEADING_FONT_SCALE.title);
      expect(String(text.props.className).split(" ")).toEqual(
        expect.arrayContaining(["font-sans", "text-title", "font-normal"]),
      );
    }
  });

  it.each([
    ["the heading role and level", "h2", "2"],
    ["a title's level", "title", "4"],
  ] as const)("is read whole as one heading, with %s", async (_what, variant, level) => {
    await renderWithTheme(<Text variant={variant}>{HEADING}</Text>);
    await laidOut(HEADING, BROKEN);
    const heading = screen.getByRole("heading", { name: HEADING });
    expect(heading.props.accessible).toBe(true);
    expect(heading.props["aria-level"]).toBe(level);
    // Its own words as its label: the phone would otherwise join the words'
    // labels with spaces, and read "Kumpa- sovelluksessa" as two words.
    expect(heading.props.accessibilityLabel).toBe(HEADING);
    // Its words are inside the one element a screen reader stops at.
    expect(within(heading).getByText("Kumpa-")).toBeTruthy();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
  });

  it("is read by the caller's own label over its words", async () => {
    await renderWithTheme(
      <Text variant="h2" accessibilityLabel="Kumpa">
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    expect(screen.getByRole("heading", { name: "Kumpa" })).toBeTruthy();
  });

  it.each([
    ["Swedish words, after each space", "Människor på Kumpa", ["Människor ", "på ", "Kumpa"]],
    ["a hyphenated word, after its hyphen", "Kumpa-sovellus", ["Kumpa-", "sovellus"]],
    ["two hyphens", "Kumpa-sovellus-ry", ["Kumpa-", "sovellus-", "ry"]],
    ["a hyphen before a digit, nowhere", "COVID-19 ja Kumpa", ["COVID-19 ", "ja ", "Kumpa"]],
    ["a hyphen before a space, at the space", "alku- ja loppu", ["alku- ", "ja ", "loppu"]],
    ["a hyphen at a word's start, nowhere", "-alku", ["-alku"]],
    ["a double hyphen, nowhere", "alku--loppu", ["alku--loppu"]],
    ["a no-break space, nowhere", "Kumpa ry", ["Kumpa ry"]],
    ["two spaces, after the second", "Kumpa  ry", ["Kumpa  ", "ry"]],
    ["spaces around it, which it leaves out", "  Kumpa ry  ", ["Kumpa ", "ry"]],
    ["one long word, nowhere", "Yhteystietojenvaihtaminen", ["Yhteystietojenvaihtaminen"]],
  ])("breaks %s", async (_what, words, drawn) => {
    await renderWithTheme(<Text variant="h3">{words}</Text>);
    await laidOut(words, layout("Kum", "pa"));
    expect(texts()).toEqual(drawn);
  });

  it("gives the caller's layout to the box and the caller's drawing to the words", async () => {
    await renderWithTheme(
      <Text variant="title" className="mt-4 flex-1 text-primary underline">
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    const box = String(screen.getByRole("heading", { name: HEADING }).props.className).split(" ");
    const word = String(
      screen.getByText("Kumpa-", { includeHiddenElements: true }).props.className,
    ).split(" ");
    expect(box).toEqual(expect.arrayContaining(["flex-row", "flex-wrap", "mt-4", "flex-1"]));
    expect(box).not.toEqual(expect.arrayContaining(["text-primary"]));
    expect(box).not.toContain("underline");
    expect(word).toEqual(expect.arrayContaining(["text-primary", "underline"]));
    expect(word).not.toContain("mt-4");
    expect(word).not.toContain("flex-1");
  });

  it.each([
    ["centred", "text-center", "justify-center"],
    ["at the right", "text-right", "justify-end"],
    ["at the end", "text-end", "justify-end"],
    ["centred on a breakpoint", "md:text-center", undefined],
    ["at the start", "text-left", undefined],
  ])("keeps its lines %s", async (_where, align, justify) => {
    await renderWithTheme(
      <Text variant="title" className={align}>
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    const box = String(screen.getByRole("heading", { name: HEADING }).props.className).split(" ");
    for (const each of ["justify-center", "justify-end"]) {
      expect(box.includes(each)).toBe(each === justify);
    }
  });

  it("keeps its lines centred by the text class its parent hands down", async () => {
    await renderWithTheme(
      <TextClassContext.Provider value="text-center">
        <Text variant="title">{HEADING}</Text>
      </TextClassContext.Provider>,
    );
    await laidOut(HEADING, BROKEN);
    expect(
      String(screen.getByRole("heading", { name: HEADING }).props.className).split(" "),
    ).toContain("justify-center");
  });

  it("gives every word the caller's own font scaling", async () => {
    await renderWithTheme(
      <Text variant="title" maxFontSizeMultiplier={1.2} allowFontScaling={false}>
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    const word = screen.getByText("sovelluksessa", { includeHiddenElements: true });
    expect(word.props.maxFontSizeMultiplier).toBe(1.2);
    expect(word.props.allowFontScaling).toBe(false);
  });

  it("is one text again when its words change, until their own lines break inside one", async () => {
    const { rerender } = await renderWithTheme(<Text variant="title">{HEADING}</Text>);
    await laidOut(HEADING, BROKEN);
    await rerender(underProviders(<Text variant="title">Människor på Kumpa</Text>));
    expect(texts()).toEqual(["Människor på Kumpa"]);
    await laidOut("Människor på Kumpa", layout("Männi", "skor på Kumpa"));
    expect(texts()).toEqual(["Människor ", "på ", "Kumpa"]);
  });

  it("is drawn as its words when given the heading role as its own", async () => {
    await renderWithTheme(<Text role="heading">{HEADING}</Text>);
    await laidOut(HEADING, BROKEN);
    expect(texts()).toEqual(["Ihmiset ", "Kumpa-", "sovelluksessa"]);
  });

  // Where the caller sets the lines, the size or the style, reads the layout
  // or makes the heading pressable, its lines are the caller's.
  it.each([
    ["its lines", { numberOfLines: 2 }],
    ["shrinking to fit", { adjustsFontSizeToFit: true }],
    ["a press", { onPress: () => undefined }],
    ["a long press", { onLongPress: () => undefined }],
    ["a style", { style: { opacity: 1 } }],
  ])("leaves a heading with %s one text", async (_what, own) => {
    await renderWithTheme(
      <Text variant="title" {...own}>
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    expect(texts()).toEqual([HEADING]);
  });

  it("leaves a heading whose layout the caller reads one text, and tells the caller", async () => {
    const onTextLayout = jest.fn();
    await renderWithTheme(
      <Text variant="title" onTextLayout={onTextLayout}>
        {HEADING}
      </Text>,
    );
    await laidOut(HEADING, BROKEN);
    expect(onTextLayout).toHaveBeenCalledTimes(1);
    expect(texts()).toEqual([HEADING]);
  });

  it("leaves text that is no heading one text", async () => {
    await renderWithTheme(<Text>{HEADING}</Text>);
    expect(screen.getByText(HEADING).props.onTextLayout).toBeUndefined();
  });

  it("leaves a heading of more than one piece one text", async () => {
    await renderWithTheme(
      <Text variant="h2">
        {"Ihmiset "}
        {"Kumpa-sovelluksessa"}
      </Text>,
    );
    expect(screen.getByRole("heading", { name: HEADING }).props.onTextLayout).toBeUndefined();
  });

  describe("on the web preview", () => {
    // A browser keeps text at one size and breaks after a hyphen by itself.
    // ThemeProvider's web branch needs NativeWind's own, so this renders bare.
    beforeEach(() => jest.replaceProperty(Platform, "OS", "web"));
    afterEach(() => jest.restoreAllMocks());

    it("leaves a heading one text", async () => {
      await render(<Text variant="title">{HEADING}</Text>);
      expect(screen.getByRole("heading", { name: HEADING }).props.onTextLayout).toBeUndefined();
    });
  });
});

// Organic Pop (outside production) reads what is read light, as Sini's
// "Inter Light": the phone's own font at its light weight. A heading, a label
// and a parent's own weight keep theirs, and today's look draws none light.
describe("Text in the Organic Pop try", () => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  afterEach(() => store.delete("kuutti.preference.look"));

  /** Renders with a heading beside it, and waits until the stored look has drawn the body light. */
  const inOrganic = async (ui: React.ReactElement) => {
    store.set("kuutti.preference.look", "organic");
    await renderWithTheme(
      <>
        {ui}
        <Text>Marker</Text>
      </>,
    );
    await waitFor(() =>
      expect(String(screen.getByText("Marker").props.className).split(" ")).toContain("font-light"),
    );
  };
  const weightOf = (words: string) =>
    String(screen.getByText(words).props.className)
      .split(" ")
      .filter((each) => /^font-(light|normal|medium|semibold|bold)$/.test(each));

  it.each(["default", "muted"] as const)("draws %s light", async (variant) => {
    await inOrganic(<Text variant={variant}>Words</Text>);
    expect(weightOf("Words")).toEqual(["font-light"]);
  });

  it.each(["h1", "h2", "h3", "h4", "title", "group", "small"] as const)(
    "leaves %s at its own weight",
    async (variant) => {
      await inOrganic(<Text variant={variant}>Words</Text>);
      expect(weightOf("Words")).not.toContain("font-light");
    },
  );

  it("gives way to the weight its parent hands down, as a button's words", async () => {
    await inOrganic(
      <TextClassContext.Provider value="font-normal">
        <Text>Inside a button</Text>
      </TextClassContext.Provider>,
    );
    expect(weightOf("Inside a button")).toEqual(["font-normal"]);
  });

  it("draws nothing light in today's look", async () => {
    await renderWithTheme(<Text variant="muted">Words</Text>);
    expect(weightOf("Words")).not.toContain("font-light");
  });
});
