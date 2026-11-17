import { fireEvent, screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderWithTheme, underProviders } from "@/test/render";
import { Input } from "./input";

// The text field (#12): its label is required (a placeholder is not one), it
// grows with the OS font size, and a read-only field looks it.

describe("Input", () => {
  it("is found by its label, scales with the OS font up to twice, and reports what is typed", async () => {
    const typed = jest.fn();
    await renderWithTheme(<Input accessibilityLabel="Your name" onChangeText={typed} />);
    const input = screen.getByLabelText("Your name");
    expect(input.props.maxFontSizeMultiplier).toBe(2);
    expect(input.props.className).toMatch(/\bmin-h-touch\b/);
    // What people type is read: the phone's font at body size (#408).
    expect(input.props.className.split(" ")).toEqual(
      expect.arrayContaining(["font-system", "text-body"]),
    );
    expect(input.props.className).not.toMatch(/opacity-50/);
    expect(input.props.className).not.toMatch(/\bborder-dashed\b/);
    await fireEvent.changeText(input, "Aino");
    expect(typed).toHaveBeenCalledWith("Aino");
  });

  it("looks read-only when it cannot be edited", async () => {
    await renderWithTheme(<Input accessibilityLabel="Locked" editable={false} />);
    const input = screen.getByLabelText("Locked");
    expect(input.props.editable).toBe(false);
    // Drawn, not faded (#467): a dashed outline and the text muted.
    expect(input.props.className).not.toMatch(/opacity-/);
    expect(input.props.className).toMatch(/\bborder-dashed\b/);
    expect(input.props.className).not.toMatch(/\bborder-solid\b/);
    // Not the placeholder's own placeholder:text-muted-foreground.
    expect(input.props.className).toMatch(/(^| )text-muted-foreground( |$)/);
    expect(input.props.className).not.toMatch(/\btext-foreground\b/);
  });

  // Android keeps a border's dash when its style goes away (#548).
  it("says solid when it can be edited again, so Android drops the dash", async () => {
    const { rerender } = await renderWithTheme(
      <Input accessibilityLabel="Locked" editable={false} />,
    );
    await rerender(underProviders(<Input accessibilityLabel="Locked" editable />));
    const input = screen.getByLabelText("Locked");
    expect(input.props.className).toMatch(/\bborder-solid\b/);
    expect(input.props.className).not.toMatch(/\bborder-dashed\b/);
  });
});

// The designers' tries (outside production) draw the field in their own shape,
// and a read-only one still looks it: dashed in --input, its words muted (#467).
describe.each([
  ["neubrutalism", "border-2"],
  ["organic", "rounded-2xl"],
] as const)("Input in the %s try", (look, drawnBy) => {
  const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
  beforeEach(() => store.set("kuutti.preference.look", look));
  afterEach(() => store.delete("kuutti.preference.look"));

  const classesOf = async (editable: boolean) => {
    await renderWithTheme(<Input accessibilityLabel="Locked" editable={editable} />);
    const classes = () => String(screen.getByLabelText("Locked").props.className).split(" ");
    await waitFor(() => expect(classes()).toContain(drawnBy));
    return classes();
  };

  it("is found by its label and takes what is typed", async () => {
    const typed = jest.fn();
    await renderWithTheme(<Input accessibilityLabel="Your name" onChangeText={typed} />);
    await waitFor(() =>
      expect(String(screen.getByLabelText("Your name").props.className).split(" ")).toContain(
        drawnBy,
      ),
    );
    await fireEvent.changeText(screen.getByLabelText("Your name"), "Aino");
    expect(typed).toHaveBeenCalledWith("Aino");
  });

  it("looks read-only when it cannot be edited", async () => {
    const classes = await classesOf(false);
    expect(classes).toEqual(
      expect.arrayContaining(["border-dashed", "border-input", "text-muted-foreground"]),
    );
    expect(classes).not.toContain("border-solid");
    expect(classes).not.toContain("text-foreground");
    expect(classes.some((each) => each.startsWith("opacity-"))).toBe(false);
  });

  it("is drawn solid when it can be edited", async () => {
    const classes = await classesOf(true);
    expect(classes).toContain("border-solid");
    expect(classes).not.toContain("border-dashed");
  });
});
