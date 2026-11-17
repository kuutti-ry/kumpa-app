import { screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderWithTheme } from "@/test/render";
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
