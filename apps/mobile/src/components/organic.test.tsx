import { screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { StyleSheet } from "react-native";
import { renderWithTheme } from "@/test/render";
import { GradientBlob } from "./organic";

// The soft shapes of the Organic Pop try (outside production): decoration,
// never read, and in high contrast not drawn at all, their room kept, since a
// gradient under the words would take them below that set's 7:1.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
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
/** The shape's own box: the outermost node it draws, sized as it was asked. */
const box = () =>
  all().find((node) => {
    const style = StyleSheet.flatten(node.props?.style as never) as
      | { width?: unknown; height?: unknown }
      | undefined;
    return style?.width === 180 && style?.height === 120;
  });

afterEach(() => store.delete(CONTRAST));

describe("GradientBlob", () => {
  it("draws its shape at the size asked, where no screen reader reaches it", async () => {
    await renderWithTheme(<GradientBlob width={180} height={120} shape="bean" />);
    expect(drawings().map((node) => [node.props?.width, node.props?.height])).toEqual([[180, 120]]);
    expect(box()?.props).toMatchObject({
      pointerEvents: "none",
      accessibilityElementsHidden: true,
      importantForAccessibility: "no-hide-descendants",
    });
  });

  it("keeps its room in high contrast and draws nothing in it", async () => {
    store.set(CONTRAST, "true");
    await renderWithTheme(<GradientBlob width={180} height={120} shape="bean" />);
    await waitFor(() => expect(drawings()).toEqual([]));
    expect(box()?.props).toMatchObject({
      pointerEvents: "none",
      accessibilityElementsHidden: true,
    });
  });
});
