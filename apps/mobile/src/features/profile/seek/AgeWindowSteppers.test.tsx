import { AGE_MAX, AGE_MIN } from "@kuutti/schema";
import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { noProblems } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { AgeWindowSteppers } from "./AgeWindowSteppers";

// The youngest and the oldest one seeks, as What you seek and onboarding ask them (#581).

const button = (name: string) => screen.getByRole("button", { name });
const off = (name: string) => button(name).props.accessibilityState?.disabled === true;

describe("AgeWindowSteppers", () => {
  it("moves the youngest and the oldest a year at a time, one above the other", async () => {
    const onChange = jest.fn();
    await renderWithTheme(<AgeWindowSteppers ages={{ min: 25, max: 35 }} onChange={onChange} />);
    expect(screen.getByText("Youngest")).toBeTruthy();
    expect(screen.getByText("Oldest")).toBeTruthy();
    await fireEvent.press(button("Youngest, one year older"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 26, max: 35 });
    await fireEvent.press(button("Youngest, one year younger"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 24, max: 35 });
    await fireEvent.press(button("Oldest, one year younger"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 25, max: 34 });
    await fireEvent.press(button("Oldest, one year older"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 25, max: 36 });
    noProblems();
  });

  it("never lets the youngest pass the oldest", async () => {
    await renderWithTheme(<AgeWindowSteppers ages={{ min: 30, max: 30 }} onChange={jest.fn()} />);
    expect(off("Youngest, one year older")).toBe(true);
    expect(off("Oldest, one year younger")).toBe(true);
    expect(off("Youngest, one year younger")).toBe(false);
    expect(off("Oldest, one year older")).toBe(false);
  });

  it("stops at the youngest and the oldest age Kuutti has", async () => {
    await renderWithTheme(
      <AgeWindowSteppers ages={{ min: AGE_MIN, max: AGE_MAX }} onChange={jest.fn()} />,
    );
    expect(off("Youngest, one year younger")).toBe(true);
    expect(off("Oldest, one year older")).toBe(true);
    expect(off("Youngest, one year older")).toBe(false);
    expect(off("Oldest, one year younger")).toBe(false);
  });
});

// The Organic Pop try (outside production) stands the two on a soft shape, as
// Sini's board: drawn behind them, never read, and the steppers do as today's.
describe("AgeWindowSteppers in the Organic Pop try", () => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  beforeEach(() => store.set("kuutti.preference.look", "organic"));
  afterEach(() => store.delete("kuutti.preference.look"));

  /** The drawings on the screen, and those a screen reader would reach. */
  const drawings = (
    node: unknown = screen.toJSON(),
    hidden = false,
  ): { all: number; spoken: number } => {
    if (Array.isArray(node)) {
      return node.reduce(
        (sum, each) => {
          const found = drawings(each, hidden);
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
      props.importantForAccessibility === "no-hide-descendants";
    const here = host.type === "RNSVGSvgView" ? 1 : 0;
    const below = drawings(host.children, under);
    return { all: here + below.all, spoken: (here && !under ? 1 : 0) + below.spoken };
  };

  it("moves the two a year at a time on a shape no screen reader reaches", async () => {
    const onChange = jest.fn();
    await renderWithTheme(<AgeWindowSteppers ages={{ min: 25, max: 35 }} onChange={onChange} />);
    // The shape, and the minus and plus of each: drawn, all of them unheard.
    await waitFor(() => expect(drawings().all).toBeGreaterThan(4));
    expect(drawings().spoken).toBe(0);
    expect(screen.getByText("Youngest")).toBeTruthy();
    expect(screen.getByText("Oldest")).toBeTruthy();
    await fireEvent.press(button("Youngest, one year older"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 26, max: 35 });
    await fireEvent.press(button("Oldest, one year younger"));
    expect(onChange).toHaveBeenLastCalledWith({ min: 25, max: 34 });
    noProblems();
  });

  it("still never lets the youngest pass the oldest", async () => {
    await renderWithTheme(<AgeWindowSteppers ages={{ min: 30, max: 30 }} onChange={jest.fn()} />);
    await waitFor(() => expect(drawings().all).toBeGreaterThan(4));
    expect(off("Youngest, one year older")).toBe(true);
    expect(off("Oldest, one year younger")).toBe(true);
  });
});
