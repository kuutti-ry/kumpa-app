import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { DeviceEventEmitter, Keyboard, Platform, StyleSheet, Text, TextInput } from "react-native";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme, underProviders } from "@/test/render";
import { HEADING_FONT_SCALE, MAX_FONT_SCALE, TOUCH_TARGET } from "@/theme/a11y";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogTitle,
} from "./dialog";

// The dialog (#12, TD-9): a labelled 44 pt close control, a scrim that is not
// an accessibility element, and on the web preview a tap on the scrim itself,
// not on the dialog, closes it.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;

describe("Dialog", () => {
  it("shows its title and body with a labelled close control that closes it", async () => {
    const onOpenChange = jest.fn();
    await renderWithTheme(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent closeLabel="Close the question">
          <DialogHeader>
            <DialogTitle>Remove this photo?</DialogTitle>
            <DialogDescription>It is deleted for good.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Text>Footer</Text>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.getByText("Remove this photo?")).toBeTruthy();
    expect(screen.getByText("It is deleted for good.")).toBeTruthy();
    // The title is a title in Saiga, growing as a title does; the description is read (#408).
    const title = screen.getByText("Remove this photo?");
    expect(title.props.className.split(" ")).toEqual(
      expect.arrayContaining(["font-sans", "text-title"]),
    );
    expect(title.props.maxFontSizeMultiplier).toBe(HEADING_FONT_SCALE.title);
    const body = screen.getByText("It is deleted for good.");
    expect(body.props.className.split(" ")).toEqual(
      expect.arrayContaining(["font-system", "text-small"]),
    );
    expect(body.props.maxFontSizeMultiplier).toBe(MAX_FONT_SCALE);
    expect(screen.getByText("Footer")).toBeTruthy();
    const close = screen.getByRole("button", { name: "Close the question" });
    expect(StyleSheet.flatten(close.props.style)).toMatchObject({ minHeight: 44, minWidth: 44 });
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
    await fireEvent.press(close);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows nothing while closed", async () => {
    await renderWithTheme(
      <Dialog open={false}>
        <DialogContent closeLabel="Close">
          <DialogTitle>Hidden</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
  });

  it("hands a press on the scrim to the caller on the phone", async () => {
    const onPress = jest.fn();
    const onOpenChange = jest.fn();
    await render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogOverlay testID="scrim" onPress={onPress}>
          <Text>Inside</Text>
        </DialogOverlay>
      </Dialog>,
    );
    const scrim = screen.getByTestId("scrim");
    expect(scrim.props.accessible).toBe(false);
    await fireEvent.press(scrim);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

// Pressed, the close control's cross keeps its colour on a ground it is paired
// with: today's --accent, or the ink's tint in a try style, whose --accent is loud.
describe("A dialog's close control pressed (#408)", () => {
  afterEach(() => store.delete("kuutti.preference.look"));

  it.each([
    ["today", "active:bg-accent", "active:bg-foreground/10"],
    ["glass", "active:bg-foreground/10", "active:bg-accent"],
  ] as const)("fills in the %s style's way", async (look, fill, not) => {
    if (look !== "today") store.set("kuutti.preference.look", look);
    await renderWithTheme(
      <Dialog open>
        <DialogContent closeLabel="Close">
          <DialogTitle>Remove this photo?</DialogTitle>
        </DialogContent>
      </Dialog>,
    );
    const classes = () =>
      String(screen.getByRole("button", { name: "Close" }).props.className).split(" ");
    await waitFor(() => expect(classes()).toContain(fill));
    expect(classes()).not.toContain(not);
  });
});

describe("A dialog's title beside the close control (#530)", () => {
  // The close lies over the corner, out of the flow, so nothing but the title's
  // own room keeps its last word from under it. Jest resolves no classes, so this
  // reads them on Tailwind's scale, where a step is a quarter of a rem.
  const steps = (classes: unknown, utility: string) =>
    Number(new RegExp(`(?:^| )${utility}-(\\d+)(?: |$)`).exec(String(classes))?.[1]) / 4;
  const title = "Blocked. You will not see each other again.";

  it.each([
    ["a phone", 14],
    ["the web preview", 16],
  ])("wraps before the close control on %s, and the body keeps its width", async (_where, rem) => {
    await renderWithTheme(
      <Dialog open>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>It is final.</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    const [dialog] = screen.container.queryAll(
      (node) => typeof node.type === "string" && node.props.role === "dialog",
    );
    const heading = screen.getByRole("heading", { name: title });
    const close = screen.getByRole("button", { name: "Close" });
    const titleStops = steps(dialog?.props.className, "p") + steps(heading.props.className, "pr");
    const closeStarts = steps(close.props.className, "right");
    expect(titleStops * rem).toBeGreaterThanOrEqual(closeStarts * rem + TOUCH_TARGET);
    expect(screen.getByText("It is final.").props.className).not.toMatch(/\bpr-/);
  });

  it("keeps a title's width in a dialog with no close control", async () => {
    await render(
      <Dialog open>
        <DialogOverlay>
          <DialogTitle>{title}</DialogTitle>
        </DialogOverlay>
      </Dialog>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("heading", { name: title }).props.className).not.toMatch(/\bpr-/);
  });
});

// A dialog's title is a heading like any other, whose words never break in the
// middle (#757): drawn as its words once the phone breaks a line inside one.
describe("A dialog's title's words (#757)", () => {
  const title = "Ihmiset Kumpa-sovelluksessa";
  const broken = {
    nativeEvent: { lines: [{ text: "Ihmiset Kumpa-so" }, { text: "velluksessa" }] },
  };

  it("is drawn as its words on a phone, read whole, its room beside the close kept", async () => {
    await renderWithTheme(
      <Dialog open>
        <DialogContent closeLabel="Close">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>,
    );
    await fireEvent(screen.getByText(title), "textLayout", broken);
    const heading = screen.getByRole("heading", { name: title });
    expect(heading.props["aria-level"]).toBe("4");
    expect(String(heading.props.className).split(" ")).toContain("pr-8");
    for (const word of ["Ihmiset ", "Kumpa-", "sovelluksessa"]) {
      const text = screen.getByText(word);
      expect(text.props.adjustsFontSizeToFit).toBe(true);
      expect(text.props.maxFontSizeMultiplier).toBe(HEADING_FONT_SCALE.title);
    }
  });
});

describe("Dialog on the web preview", () => {
  // Platform.select picks the web branch at render time; jest-expo's preset is iOS.
  // Jest resolves the primitive's native overlay, which closes on any press by
  // itself; the web one (Radix) does not, so its own close is switched off here
  // and the decision is left to the handler under test, as on the web.
  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
    // The module picked iOS's FullWindowOverlay when it loaded; off iOS it warns, which is beside the point here.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
    jest
      .spyOn(Platform, "select")
      .mockImplementation(((spec: Record<string, unknown>) =>
        "web" in spec ? spec.web : spec.default) as typeof Platform.select);
  });
  afterEach(() => jest.restoreAllMocks());

  async function showOverlay(onPress?: jest.Mock) {
    const onOpenChange = jest.fn();
    await render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogOverlay testID="scrim" closeOnPress={false} onPress={onPress}>
          <Text>Inside</Text>
        </DialogOverlay>
      </Dialog>,
    );
    return { onOpenChange, scrim: screen.getByTestId("scrim") };
  }
  const pressEvent = (target: unknown, currentTarget: unknown, prevented = false) => ({
    target,
    currentTarget,
    isDefaultPrevented: () => prevented,
  });

  it("closes for a tap on the scrim itself, and tells the caller first", async () => {
    const onPress = jest.fn();
    const { onOpenChange, scrim } = await showOverlay(onPress);
    await fireEvent.press(scrim, pressEvent(1, 1));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("stays open for a tap that landed inside the dialog", async () => {
    const { onOpenChange, scrim } = await showOverlay();
    await fireEvent.press(scrim, pressEvent(2, 1));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("stays open when the caller prevented the default", async () => {
    const onPress = jest.fn();
    const { onOpenChange, scrim } = await showOverlay(onPress);
    await fireEvent.press(scrim, pressEvent(1, 1, true));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("leaves the keyboard be as it opens: the browser has none to put away", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    await showOverlay();
    expect(dismiss).not.toHaveBeenCalled();
  });

  it("titles the dialog with the primitive's heading, one text whatever its lines", async () => {
    // The browser breaks after a hyphen by itself, and the primitive's title
    // names the dialog (Radix, which jest does not resolve): its heading, with
    // no level of Text's.
    const title = "Ihmiset Kumpa-sovelluksessa";
    await render(
      <Dialog open>
        <DialogOverlay closeOnPress={false}>
          <DialogTitle>{title}</DialogTitle>
        </DialogOverlay>
      </Dialog>,
    );
    const heading = screen.getByRole("heading", { name: title });
    expect(heading.props["aria-level"]).toBeUndefined();
    expect(heading.props.onTextLayout).toBeUndefined();
    expect(heading.props.maxFontSizeMultiplier).toBe(HEADING_FONT_SCALE.title);
    expect(String(heading.props.className).split(" ")).toEqual(
      expect.arrayContaining(["font-sans", "text-title"]),
    );
  });
});

describe("Dialog with a field, as the keyboard comes (#351)", () => {
  // The window is 844 points tall with a status bar of 47 (the test providers);
  // the dialog's space runs from y 8 to 836, inside the scrim's margin, and the
  // keyboard's top is at 500.
  afterEach(() => jest.restoreAllMocks());
  const onAndroid = () => {
    jest.replaceProperty(Platform, "OS", "android");
    // The module picked iOS's FullWindowOverlay when it loaded; off iOS it warns, which is beside the point here.
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  };

  type Instance = ReturnType<typeof screen.container.queryAll>[number];
  /** The nearest host view around a node. */
  const hostAbove = (node: Instance): Instance => {
    let up = node.parent;
    while (up && typeof up.type !== "string") up = up.parent;
    if (!up) throw new Error("nothing around it");
    return up;
  };
  /** The dialog, the view that fades it in, and the space it is given, outward. */
  const around = () => {
    const [dialog] = screen.container.queryAll(
      (node) => typeof node.type === "string" && node.props.role === "dialog",
    );
    if (!dialog) throw new Error("no dialog");
    const fading = hostAbove(dialog);
    return { dialog, fading, space: hostAbove(fading) };
  };
  const style = (node: Instance) => StyleSheet.flatten(node.props.style) ?? {};
  const keyboard = (event: string) =>
    act(async () => {
      DeviceEventEmitter.emit(event, {
        endCoordinates: { screenX: 0, screenY: 500, width: 390, height: 344 },
      });
    });
  async function open() {
    await renderWithTheme(
      <Dialog open>
        <DialogContent closeLabel="Close" style={{ maxHeight: 760 }}>
          <DialogTitle>Report</DialogTitle>
          <Text>Anything the moderators should know</Text>
          <TextInput accessibilityLabel="Anything the moderators should know" />
        </DialogContent>
      </Dialog>,
    );
    // The view reads its place from the layout event, which it keeps (persist).
    await act(async () => {
      fireEvent(around().space, "layout", {
        persist: () => undefined,
        nativeEvent: { layout: { x: 8, y: 8, width: 374, height: 828 } },
      });
    });
  }

  it("on Android, keeps the dialog between the status bar and the keyboard's top, shrinking into that space, and gives it back when the keyboard goes", async () => {
    onAndroid();
    await open();
    expect(style(around().space)).toMatchObject({ paddingTop: 47, paddingBottom: 0 });
    await keyboard("keyboardDidShow");
    // From 836 down to the keyboard's top at 500.
    expect(style(around().space).paddingBottom).toBe(336);
    // Taller than that, it shrinks rather than run under the keyboard; its
    // own cap is the caller's, and its scroll view, the caller's, shrinks in it.
    const { dialog, fading } = around();
    expect(style(fading).flexShrink).toBe(1);
    expect(dialog.props.className).toMatch(/\bshrink\b/);
    expect(style(dialog).maxHeight).toBe(760);
    await keyboard("keyboardDidHide");
    expect(style(around().space).paddingBottom).toBe(0);
  });

  it.each(["ios", "android"] as const)(
    "on %s, gives a dialog the whole width of its space however few its words, so every dialog is one width (#581)",
    async (os) => {
      if (os === "android") onAndroid();
      else jest.replaceProperty(Platform, "OS", os);
      await renderWithTheme(
        <Dialog open>
          <DialogContent closeLabel="Close">
            <DialogTitle>Sure?</DialogTitle>
          </DialogContent>
        </Dialog>,
      );
      expect(style(around().fading).width).toBe("100%");
    },
  );

  it("on iOS, puts away a keyboard the screen behind left up as it opens, keeps its place, where the scroll view insets itself, and leaves the field's own keyboard be", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    await open();
    // The composer's keyboard would lie over the dialog: the overlay is below the keyboard's window.
    expect(dismiss).toHaveBeenCalledTimes(1);
    const before = [around().fading, around().space].map(style);
    await act(async () => {
      fireEvent(screen.getByLabelText("Anything the moderators should know"), "focus");
    });
    await keyboard("keyboardWillShow");
    await keyboard("keyboardDidShow");
    expect([around().fading, around().space].map(style)).toEqual(before);
    expect(before.some((each) => "paddingTop" in each || "paddingBottom" in each)).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["iOS", "ios"],
    ["Android", "android"],
  ] as const)(
    "on %s, puts away a keyboard the screen behind left up, once each time it opens, never as what is in it changes",
    async (_platform, os) => {
      if (os === "android") onAndroid();
      else jest.replaceProperty(Platform, "OS", os);
      const dismiss = jest.spyOn(Keyboard, "dismiss");
      const dialog = (open: boolean, title: string) => (
        <Dialog open={open}>
          <DialogContent closeLabel="Close">
            <DialogTitle>{title}</DialogTitle>
            <TextInput accessibilityLabel="Anything the moderators should know" />
          </DialogContent>
        </Dialog>
      );
      await renderWithTheme(dialog(true, "Report"));
      expect(dismiss).toHaveBeenCalledTimes(1);
      // A step of the same dialog (the report's, its note's keyboard up), then its outcome.
      await act(async () => {
        fireEvent(screen.getByLabelText("Anything the moderators should know"), "focus");
      });
      await keyboard("keyboardDidShow");
      await screen.rerender(underProviders(dialog(true, "Report sent")));
      expect(screen.getByText("Report sent")).toBeTruthy();
      expect(dismiss).toHaveBeenCalledTimes(1);
      await screen.rerender(underProviders(dialog(false, "Report sent")));
      expect(screen.queryByText("Report sent")).toBeNull();
      await screen.rerender(underProviders(dialog(true, "Report")));
      expect(screen.getByText("Report")).toBeTruthy();
      expect(dismiss).toHaveBeenCalledTimes(2);
    },
  );
});
