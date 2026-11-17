import { screen, waitFor } from "@testing-library/react-native";
import * as SecureStore from "expo-secure-store";
import { renderWithTheme } from "@/test/render";
import { TextBubble } from "./Bubble";
import { timeOf } from "./time";

// A message's bubble in today's style and in the designers' try of the tech
// screen (outside production): the same words read the same way in every
// style; the style draws its corners, its tail towards the speaker, and in
// Glass the other's words on a frosted pane, solid again in high contrast.

const store = (SecureStore as unknown as { __store: Map<string, string> }).__store;
const LOOK = "kuutti.preference.look";
const CONTRAST = "kuutti.preference.highContrast";
const AT = "2026-11-17T10:04:00.000Z";

afterEach(() => {
  store.delete(LOOK);
  store.delete(CONTRAST);
});

const bubble = async (mine: boolean) => {
  await renderWithTheme(
    <TextBubble mine={mine} who={mine ? "You" : "Iida"} body="Moi!" at={AT} note={null} />,
  );
  const name = `${mine ? "You" : "Iida"}, ${timeOf("en", AT)}, Moi!`;
  return {
    box: () => String(screen.getByLabelText(name).props.className).split(" "),
    words: () => String(screen.getByText("Moi!").props.className).split(" "),
  };
};

describe.each([
  ["today", true, ["rounded-2xl", "bg-primary"], "text-primary-foreground"],
  ["today", false, ["rounded-2xl", "bg-secondary"], "text-secondary-foreground"],
  [
    "neubrutalism",
    true,
    ["border-2", "border-stroke", "rounded-br-sm", "bg-primary"],
    "text-primary-foreground",
  ],
  [
    "neubrutalism",
    false,
    ["border-2", "border-stroke", "rounded-bl-sm", "bg-secondary"],
    "text-secondary-foreground",
  ],
  ["organic", true, ["rounded-3xl", "rounded-br-md", "bg-primary"], "text-primary-foreground"],
  ["organic", false, ["rounded-3xl", "rounded-bl-md", "bg-secondary"], "text-secondary-foreground"],
  ["glass", true, ["rounded-3xl", "rounded-br-md", "bg-primary"], "text-primary-foreground"],
  ["glass", false, ["rounded-3xl", "rounded-bl-md", "bg-card/70"], "text-card-foreground"],
  ["bold", false, ["rounded-3xl", "rounded-bl-md", "bg-secondary"], "text-secondary-foreground"],
] as const)("A message in the %s style, mine %s", (look, mine, drawn, ink) => {
  it("is read as who, when and what, and drawn in the style's shape and colours", async () => {
    if (look !== "today") store.set(LOOK, look);
    const { box, words } = await bubble(mine);
    await waitFor(() => expect(box()).toEqual(expect.arrayContaining([...drawn])));
    expect(words()).toContain(ink);
    if (look !== "neubrutalism") expect(box()).not.toContain("border-stroke");
  });
});

it("draws the other's words on the secondary colour in Glass with high contrast on", async () => {
  store.set(LOOK, "glass");
  store.set(CONTRAST, "true");
  const { box, words } = await bubble(false);
  await waitFor(() => expect(box()).toContain("rounded-3xl"));
  expect(box()).toContain("bg-secondary");
  expect(box()).not.toContain("bg-card/70");
  expect(words()).toContain("text-secondary-foreground");
});
