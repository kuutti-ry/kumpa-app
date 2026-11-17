import { renderHook } from "@testing-library/react-native";

// The hard shadow of the neubrutalism try: the ink of the --stroke token,
// offset down and right, with no blur, as React Native's own boxShadow.

let mockInk: unknown;
let mockPrimary: unknown;
jest.mock("nativewind", () => ({
  ...jest.requireActual("nativewind"),
  useUnstableNativeVariable: (name: string) =>
    name === "--stroke" ? mockInk : name === "--primary" ? mockPrimary : undefined,
}));

const shadowOf = async (offset: number) => {
  const { useHardShadow } = jest.requireActual<typeof import("./shadow")>("./shadow");
  const { result } = await renderHook(() => useHardShadow(offset));
  return result.current;
};

describe("useHardShadow", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("draws the stroke's ink, offset down and right, with no blur", async () => {
    mockInk = [222, "40%", "14%"];
    expect(await shadowOf(3)).toEqual({ boxShadow: "3px 3px 0px 0px hsl(222, 40%, 14%)" });
  });

  it("reads the token whether NativeWind hands it over in parts or as text", async () => {
    mockInk = "245 30% 16%";
    expect(await shadowOf(2)).toEqual({ boxShadow: "2px 2px 0px 0px hsl(245, 30%, 16%)" });
  });

  it.each([
    ["missing", undefined],
    ["not a colour", "6px"],
    ["of the wrong kind", 6],
  ])("draws no shadow where the token is %s", async (_what, ink) => {
    mockInk = ink;
    expect(await shadowOf(3)).toEqual({});
  });

  it("names the CSS variable itself on the web, where NativeWind's hook reads nothing", async () => {
    mockInk = undefined;
    let style: unknown;
    await jest.isolateModulesAsync(async () => {
      // The module reads the platform once, from its own registry's React Native.
      const isolated = jest.requireActual<typeof import("react-native")>("react-native");
      jest.replaceProperty(isolated.Platform, "OS", "web");
      style = await shadowOf(5);
    });
    expect(style).toEqual({ boxShadow: "5px 5px 0px 0px hsl(var(--stroke))" });
  });
});

// A token's colour for what takes no class, a gradient's stops in the Organic
// Pop try: the root view's set on a phone, the CSS variable on the web.
describe("useTokenColour", () => {
  const colourOf = async (token: string) => {
    const { useTokenColour } = jest.requireActual<typeof import("./shadow")>("./shadow");
    const { result } = await renderHook(() => useTokenColour(token));
    return result.current;
  };

  it.each([
    ["in parts", [24, "95%", "53%"]],
    ["as text", "24 95% 53%"],
  ])("reads the token handed over %s", async (_how, value) => {
    mockPrimary = value;
    expect(await colourOf("primary")).toBe("hsl(24, 95%, 53%)");
  });

  it.each([
    ["missing", undefined],
    ["not a colour", "6px"],
  ])("gives nothing where the token is %s, as the hard shadow does", async (_what, value) => {
    mockPrimary = value;
    expect(await colourOf("primary")).toBeUndefined();
  });

  it("names the CSS variable itself on the web", async () => {
    mockPrimary = undefined;
    let colour: unknown;
    await jest.isolateModulesAsync(async () => {
      const isolated = jest.requireActual<typeof import("react-native")>("react-native");
      jest.replaceProperty(isolated.Platform, "OS", "web");
      colour = await colourOf("primary");
    });
    expect(colour).toBe("hsl(var(--primary))");
  });
});
