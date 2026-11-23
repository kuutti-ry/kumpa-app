import { act, renderHook } from "@testing-library/react-native";
import { getLoadedFonts } from "expo-font";
import { Platform } from "react-native";
import { useCarriesSaiga } from "./typeface-credit";

jest.mock("expo-font", () => ({ getLoadedFonts: jest.fn() }));
const loaded = getLoadedFonts as jest.Mock;

// Whether the build carries Saiga, asked of the phone or the browser (#405):
// the credit is shown where the typeface is, and nowhere else.
describe("useCarriesSaiga", () => {
  it.each([
    ["iOS, which names the faces", ["Saiga-Regular", "Saiga-Italic", "Saiga-Bold"]],
    ["iOS, one face among others", ["MaterialSymbols", "Saiga-Extrabold"]],
    ["Android, which names the family", ["Saiga"]],
  ])("is true at once on %s", async (_, fonts) => {
    loaded.mockReturnValue(fonts);
    const { result } = await renderHook(() => useCarriesSaiga());
    expect(result.current).toBe(true);
  });

  it.each([
    ["no font embedded", []],
    ["other fonts only", ["MaterialSymbols", "Inter-Regular"]],
    ["a family whose name only starts with Saiga's", ["SaigaMono", "Saigon-Regular"]],
    ["Saiga's name inside another's", ["NotSaiga-Regular"]],
  ])("is false with %s", async (_, fonts) => {
    loaded.mockReturnValue(fonts);
    const { result } = await renderHook(() => useCarriesSaiga());
    expect(result.current).toBe(false);
  });

  // expo-font knows only its own rules on the web, and a face loads after the
  // first render: the browser is asked to load one.
  describe("on the web target", () => {
    let answer: { resolve: (faces: unknown[]) => void; reject: (error: Error) => void };
    const load = jest.fn(
      () =>
        new Promise<unknown[]>((resolve, reject) => {
          answer = { resolve, reject };
        }),
    );
    beforeEach(() => {
      jest.replaceProperty(Platform, "OS", "web");
      // What expo-font says never decides it there.
      loaded.mockReturnValue(["Saiga-Regular"]);
      load.mockClear();
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: { fonts: { load } },
      });
    });
    afterEach(() => {
      jest.restoreAllMocks();
      Reflect.deleteProperty(globalThis, "document");
    });

    it("is false until the browser answers, then true when it found a face", async () => {
      const { result } = await renderHook(() => useCarriesSaiga());
      expect(result.current).toBe(false);
      expect(load).toHaveBeenCalledWith("16px Saiga");
      await act(async () => answer.resolve([{ family: "Saiga" }]));
      expect(result.current).toBe(true);
    });

    it("stays false when no face of Saiga is declared", async () => {
      const { result } = await renderHook(() => useCarriesSaiga());
      await act(async () => answer.resolve([]));
      expect(result.current).toBe(false);
    });

    it("stays false when the files are not served, as without the cache", async () => {
      const { result } = await renderHook(() => useCarriesSaiga());
      await act(async () => answer.reject(new Error("NetworkError")));
      expect(result.current).toBe(false);
    });
  });
});
