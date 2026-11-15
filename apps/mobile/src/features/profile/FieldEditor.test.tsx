import {
  GUILD_OPTIONS,
  type HiddenField,
  PROFILE_FIELDS,
  type ProfileFieldKey,
  type ProfileFields,
  ProfileUpdate,
  UNIVERSITIES,
} from "@kuutti/schema";
import { fireEvent, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import fc from "fast-check";
import { useState } from "react";
import { AccessibilityInfo } from "react-native";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import {
  FieldEditor,
  OptionSearch,
  optionTextKey,
  toggled,
  visibleOptions,
  withoutStrayGuilds,
} from "./FieldEditor";

// One field of the registry as the person answers it (#47, #148, ADR-019):
// a setting as a switch, choices as chips that say whether they are chosen, or
// as whole-width rows where it is what its screen asks (#581), a short text, a
// number as a stepper, and a search over a long list.

/** The names of the radio groups on the screen, each a plain view that a role query would leave out. */
const radioGroups = () =>
  screen.container
    .queryAll(
      (node) => typeof node.type === "string" && node.props.accessibilityRole === "radiogroup",
    )
    .map((node) => String(node.props.accessibilityLabel));

/** The draft the editor works on, as the screens hold it; `fields` is what it holds now, `patches` every update it asked for. */
let fields: ProfileFields = {};
let hiddenFields: readonly HiddenField[] | undefined;
let patches: unknown[] = [];
function Harness({
  field,
  initial,
  hidden,
  alone,
}: {
  field: ProfileFieldKey;
  initial: ProfileFields;
  hidden?: HiddenField[];
  alone?: boolean;
}) {
  const [draft, setDraft] = useState<{ fields: ProfileFields; hiddenFields?: HiddenField[] }>({
    fields: initial,
    hiddenFields: hidden,
  });
  fields = draft.fields;
  hiddenFields = draft.hiddenFields;
  return (
    <FieldEditor
      field={field}
      draft={draft}
      alone={alone}
      update={(patch) => {
        patches.push(patch);
        setDraft((previous) => ({ ...previous, ...patch }));
      }}
    />
  );
}
const show = (field: ProfileFieldKey, initial: ProfileFields = {}, hidden?: HiddenField[]) =>
  renderWithTheme(<Harness field={field} initial={initial} hidden={hidden} />);
const showAlone = (field: ProfileFieldKey, initial: ProfileFields = {}, hidden?: HiddenField[]) =>
  renderWithTheme(<Harness field={field} initial={initial} hidden={hidden} alone />);
const chosen = (name: string) =>
  screen.getByRole("button", { name }).props.accessibilityState?.selected;

beforeEach(() => {
  fields = {};
  hiddenFields = undefined;
  patches = [];
});

describe("FieldEditor: a setting", () => {
  it("is a labelled switch that sets the flag, and takes it away again when turned off", async () => {
    await show("hideFromField");
    const toggle = screen.getByRole("switch", { name: "Hide me from people in my field" });
    expect(toggle.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(toggle);
    expect(fields).toEqual({ hideFromField: true });
    await fireEvent.press(screen.getByRole("switch", { name: "Hide me from people in my field" }));
    expect(fields).toEqual({});
  });
});

describe("FieldEditor: what the card shows (#515)", () => {
  const HIDE_SMOKING = "Hide from your card: Smoking";
  const SHOW_SMOKING = "Show on your card: Smoking";
  const USED = "Hidden from your card. Still used for matching.";
  const NOT_USED = "Hidden from your card.";

  afterEach(() => jest.restoreAllMocks());

  it("offers nothing on an unanswered field", async () => {
    await show("smoking");
    expect(screen.queryByRole("button", { name: HIDE_SMOKING })).toBeNull();
    expect(screen.queryByText(USED)).toBeNull();
  });

  it("offers Hide once there is an answer, with no line under the title", async () => {
    await show("smoking");
    await fireEvent.press(screen.getByRole("button", { name: "Never" }));
    expect(screen.getByRole("button", { name: HIDE_SMOKING })).toBeTruthy();
    expect(screen.getByText("Hide")).toBeTruthy();
    expect(screen.queryByText(USED)).toBeNull();
  });

  it("hides the answer and keeps it, says what that means, and turns into Show", async () => {
    const said = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await show("smoking", { smoking: "never" });
    await fireEvent.press(screen.getByRole("button", { name: HIDE_SMOKING }));
    expect(hiddenFields).toEqual(["smoking"]);
    expect(fields).toEqual({ smoking: "never" });
    expect(screen.getByText(USED)).toBeTruthy();
    expect(screen.getByText("Show")).toBeTruthy();
    expect(chosen("Never")).toBe(true);
    expect(said).toHaveBeenCalledWith(USED);
  });

  it("shows a hidden answer again, the rest of the set as it was", async () => {
    const said = jest.spyOn(AccessibilityInfo, "announceForAccessibility");
    await show("smoking", { smoking: "never" }, ["height", "smoking"]);
    await fireEvent.press(screen.getByRole("button", { name: SHOW_SMOKING }));
    expect(hiddenFields).toEqual(["height"]);
    expect(screen.getByRole("button", { name: HIDE_SMOKING })).toBeTruthy();
    expect(screen.queryByText(USED)).toBeNull();
    expect(said).toHaveBeenCalledWith("Back on your card.");
  });

  it.each([
    ["intent", { intent: "casual" }, USED],
    ["languages", { languages: ["fi"] }, USED],
    ["monogamy", { monogamy: "monogamous" }, USED],
    ["hobbies", { hobbies: ["sauna"] }, NOT_USED],
    ["height", { height: 171 }, USED],
    ["politics", { politics: ["vas"] }, NOT_USED],
    ["religion", { religion: "atheist" }, NOT_USED],
    ["occupationTitle", { occupationTitle: "Nurse" }, NOT_USED],
    ["university", { university: ["aalto"] }, NOT_USED],
    ["guild", { university: ["aalto"], guild: ["aalto_fyysikkokilta"] }, NOT_USED],
  ] satisfies [ProfileFieldKey, ProfileFields, string][])(
    "says matching still reads a hidden %s only where it does",
    async (field, initial, line) => {
      await show(field, initial, [field]);
      expect(screen.getByText(line)).toBeTruthy();
      expect(screen.queryByText(line === USED ? NOT_USED : USED)).toBeNull();
    },
  );

  it.each([
    ["education", { education: "amk" }],
    ["drinking", {}],
    ["drugsAttitude", { drugsAttitude: "not_my_thing" }],
  ] as const)(
    "says %s is never on a card, answered or not, with nothing to hide",
    async (field, initial) => {
      await show(field, initial);
      expect(screen.getByText("Never on your card. Only used for matching.")).toBeTruthy();
      expect(screen.queryByText("Hide")).toBeNull();
    },
  );

  it("leaves a setting as it was: no Hide and no line", async () => {
    await show("hideFromField", { hideFromField: true });
    expect(screen.queryByText("Hide")).toBeNull();
    expect(screen.queryByText("Never on your card. Only used for matching.")).toBeNull();
  });

  it("says a field of study is hidden under the setting, with nothing to press", async () => {
    await show("field", { field: ["tech"], hideFromField: true });
    expect(screen.getByText(NOT_USED)).toBeTruthy();
    expect(screen.queryByText("Hide")).toBeNull();
    expect(screen.queryByText("Show")).toBeNull();
  });

  it("offers Hide on a field of study again without the setting", async () => {
    await show("field", { field: ["tech"] });
    expect(screen.getByText("Hide")).toBeTruthy();
    expect(screen.queryByText(NOT_USED)).toBeNull();
  });

  it("keeps a cleared answer's place in the set: answered again, it is hidden again, and says so", async () => {
    await show("smoking", { smoking: "never" }, ["smoking"]);
    await fireEvent.press(screen.getByRole("button", { name: "Never" }));
    expect(fields).toEqual({});
    expect(hiddenFields).toEqual(["smoking"]);
    expect(screen.queryByText(USED)).toBeNull();
    expect(screen.queryByText("Show")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Sometimes" }));
    expect(screen.getByText(USED)).toBeTruthy();
    expect(screen.getByRole("button", { name: SHOW_SMOKING })).toBeTruthy();
  });

  it("starts the hidden set from nothing on a draft that has none", async () => {
    await show("height", { height: 171 });
    expect(hiddenFields).toBeUndefined();
    await fireEvent.press(screen.getByRole("button", { name: "Hide from your card: Height" }));
    expect(hiddenFields).toEqual(["height"]);
  });

  it("offers it on a short text too", async () => {
    await show("occupationTitle", { occupationTitle: "Nurse" });
    expect(screen.getByRole("button", { name: "Hide from your card: Job title" })).toBeTruthy();
  });

  it("is a labelled button with a 44 pt target, in both states", async () => {
    await show("smoking", { smoking: "never" });
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
    await fireEvent.press(screen.getByRole("button", { name: HIDE_SMOKING }));
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });
});

describe("FieldEditor: one choice", () => {
  it("chooses an option, changes it, and clears it when the chosen one is pressed again", async () => {
    await show("smoking");
    expect(screen.getByText("Smoking")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Never" }));
    expect(fields).toEqual({ smoking: "never" });
    expect(chosen("Never")).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Sometimes" }));
    expect(fields).toEqual({ smoking: "sometimes" });
    expect(chosen("Never")).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Sometimes" }));
    expect(fields).toEqual({});
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it.each([
    ["an info answer", "monogamy", { monogamy: "monogamous" }, "Monogamous"],
    ["a soft answer", "drinking", { drinking: "rarely" }, "Rarely"],
  ] satisfies [string, ProfileFieldKey, ProfileFields, string][])(
    "still clears %s when the chosen one is pressed again",
    async (_what, field, initial, name) => {
      await show(field, initial);
      expect(chosen(name)).toBe(true);
      await fireEvent.press(screen.getByRole("button", { name }));
      expect(fields).toEqual({});
      expect(chosen(name)).toBe(false);
    },
  );
});

describe("FieldEditor: what its screen asks, a short list (#581)", () => {
  /** A row by its word, chosen or not: the chosen one's name carries its mark. */
  const marked = (name: string) => new RegExp(`^(✓ )?${name}$`);
  const radio = (name: string) => screen.getByRole("radio", { name: marked(name) });
  const checkbox = (name: string) => screen.getByRole("checkbox", { name: marked(name) });
  const checked = (row: ReturnType<typeof radio>) => row.props.accessibilityState?.checked;

  it("draws one answer as whole-width radios, one after another, in a group the field names", async () => {
    await showAlone("smoking", { smoking: "never" });
    const group = screen.getByLabelText("Smoking");
    expect(group.props.accessibilityRole).toBe("radiogroup");
    expect(group.props.className).not.toMatch(/\bflex-row\b/);
    expect(screen.getAllByRole("radio").map((row) => row.props.accessibilityLabel)).toEqual([
      "✓ Never",
      "Sometimes",
      "Regularly",
      "Quitting",
      "Vaping",
    ]);
    expect(screen.getByText("✓ Never")).toBeTruthy();
    // The answers are no chips beside it, and the title's Hide stays a button.
    expect(screen.queryByRole("button", { name: /Never/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Hide from your card: Smoking" })).toBeTruthy();
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it("chooses an answer, changes it, and clears it when the chosen one is pressed again", async () => {
    await showAlone("smoking");
    await fireEvent.press(radio("Never"));
    expect(fields).toEqual({ smoking: "never" });
    expect(checked(radio("Never"))).toBe(true);
    await fireEvent.press(radio("Sometimes"));
    expect(fields).toEqual({ smoking: "sometimes" });
    expect(checked(radio("Never"))).toBe(false);
    expect(checked(radio("Sometimes"))).toBe(true);
    await fireEvent.press(radio("Sometimes"));
    expect(fields).toEqual({});
    expect(checked(radio("Sometimes"))).toBe(false);
  });

  it("keeps a hard answer chosen when pressed again, asking for no update (#542)", async () => {
    await showAlone("intent", { intent: "casual" });
    await fireEvent.press(radio("Something casual"));
    expect(checked(radio("Something casual"))).toBe(true);
    expect(fields).toEqual({ intent: "casual" });
    expect(patches).toEqual([]);
    await fireEvent.press(radio("Something long-term"));
    expect(fields).toEqual({ intent: "long_term" });
  });

  it("draws several answers as whole-width checkboxes, with no group that says one goes", async () => {
    await showAlone("pets");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(radioGroups()).toEqual([]);
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    await fireEvent.press(checkbox("Dog"));
    await fireEvent.press(checkbox("Cat"));
    expect(fields).toEqual({ pets: ["dog", "cat"] });
    expect(checked(checkbox("Dog"))).toBe(true);
    expect(checked(checkbox("Cat"))).toBe(true);
    await fireEvent.press(checkbox("Dog"));
    await fireEvent.press(checkbox("Cat"));
    expect(fields).toEqual({});
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it("lets an answer that stands alone replace the rest, and give way to any other (#239)", async () => {
    await showAlone("nicotine", { nicotine: ["snus", "pouches"] } as ProfileFields);
    await fireEvent.press(checkbox("No snus or pouches"));
    expect(fields).toEqual({ nicotine: ["none"] });
    expect(checked(checkbox("Snus"))).toBe(false);
    await fireEvent.press(checkbox("Snus"));
    expect(fields).toEqual({ nicotine: ["snus"] });
    expect(checked(checkbox("No snus or pouches"))).toBe(false);
  });

  it("names the rows by the same adaptive words as the chips: more children once there are kids", async () => {
    await showAlone("wantsKids", { hasKids: "yes_with_me" } as ProfileFields);
    expect(radio("Want more")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: "Want kids" })).toBeNull();
  });

  it("takes a list as long as the identity label's as rows", async () => {
    await showAlone("identityLabel");
    expect(screen.getAllByRole("radio")).toHaveLength(7);
  });

  // No field has eight options or nine today: the rule is the maintainer's "up to 8", so it stands here.
  describe("the limit, on a list of its own length", () => {
    const listOf = (length: number) =>
      jest.replaceProperty(
        PROFILE_FIELDS.smoking,
        "options",
        Array.from({ length }, (_, i) => `option${i}`) as never,
      );
    afterEach(() => jest.restoreAllMocks());

    it("draws eight as rows", async () => {
      listOf(8);
      await showAlone("smoking");
      expect(screen.getAllByRole("radio")).toHaveLength(8);
      expect(screen.queryAllByRole("button")).toEqual([]);
    });

    it("draws nine as chips", async () => {
      listOf(9);
      await showAlone("smoking");
      expect(screen.queryAllByRole("radio")).toEqual([]);
      expect(screen.getAllByRole("button")).toHaveLength(9);
    });
  });

  it.each([
    ["the parties", "politics", "Greens"],
    ["the stances", "religion", "Agnostic"],
    ["the star signs", "zodiac", "Corgi"],
    ["the fields", "field", "Other"],
  ] as const)(
    "keeps chips over a longer list, %s: rows would not fit",
    async (_what, key, word) => {
      await showAlone(key);
      expect(screen.queryByRole("radio")).toBeNull();
      expect(screen.queryByRole("checkbox")).toBeNull();
      expect(radioGroups()).toEqual([]);
      expect(screen.getByRole("button", { name: word })).toBeTruthy();
    },
  );

  it("keeps chips and the search over the languages and the hobbies", async () => {
    await showAlone("languages");
    expect(screen.getByLabelText("Search")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finnish" })).toBeTruthy();
    await showAlone("hobbies");
    expect(screen.getByRole("button", { name: "Yoga" })).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("keeps chips for one field of a section's several, however short its list", async () => {
    await show("smoking");
    expect(screen.queryByRole("radio")).toBeNull();
    expect(radioGroups()).toEqual([]);
    expect(screen.getByRole("button", { name: "Never" })).toBeTruthy();
  });

  it("leaves a number, a short text and a setting as they are", async () => {
    await showAlone("height", { height: 170 } as ProfileFields);
    expect(screen.getByRole("button", { name: "One more" })).toBeTruthy();
    await showAlone("occupationTitle");
    expect(screen.getByLabelText("Job title")).toBeTruthy();
    await showAlone("hideFromField");
    expect(screen.getByRole("switch", { name: "Hide me from people in my field" })).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it.each([
    ["fi-FI", "Tupakointi", "En koskaan"],
    ["sv-FI", "Rökning", "Aldrig"],
  ])("names the group and its rows in %s", async (tag, title, never) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
    try {
      await showAlone("smoking");
      expect(screen.getByLabelText(title).props.accessibilityRole).toBe("radiogroup");
      expect(radio(never)).toBeTruthy();
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });
});

describe("FieldEditor: one hard choice (#542)", () => {
  const CASUAL = "Something casual";
  const LONG_TERM = "Something long-term";

  it("stays chosen when pressed again, asking for no update: without it the person is back in onboarding", async () => {
    await show("intent", { intent: "casual" });
    await fireEvent.press(screen.getByRole("button", { name: CASUAL }));
    expect(chosen(CASUAL)).toBe(true);
    expect(fields).toEqual({ intent: "casual" });
    expect(patches).toEqual([]);
  });

  it("changes to another option, and that one stays in its turn", async () => {
    await show("intent", { intent: "casual" });
    await fireEvent.press(screen.getByRole("button", { name: LONG_TERM }));
    expect(fields).toEqual({ intent: "long_term" });
    expect(chosen(LONG_TERM)).toBe(true);
    expect(chosen(CASUAL)).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: LONG_TERM }));
    expect(fields).toEqual({ intent: "long_term" });
    expect(patches).toEqual([{ fields: { intent: "long_term" } }]);
  });

  it("takes a first answer as any choice does", async () => {
    await show("intent");
    await fireEvent.press(screen.getByRole("button", { name: CASUAL }));
    expect(fields).toEqual({ intent: "casual" });
    expect(chosen(CASUAL)).toBe(true);
  });

  it("still hides and shows, and a hidden answer stays chosen when pressed again", async () => {
    await show("intent", { intent: "casual" });
    await fireEvent.press(screen.getByRole("button", { name: "Hide from your card: Looking for" }));
    expect(hiddenFields).toEqual(["intent"]);
    await fireEvent.press(screen.getByRole("button", { name: CASUAL }));
    expect(fields).toEqual({ intent: "casual" });
    expect(hiddenFields).toEqual(["intent"]);
    await fireEvent.press(screen.getByRole("button", { name: "Show on your card: Looking for" }));
    expect(hiddenFields).toEqual([]);
    expect(fields).toEqual({ intent: "casual" });
  });
});

describe("FieldEditor: several choices", () => {
  it("adds and removes options, and drops the field when the last one goes", async () => {
    await show("pets");
    await fireEvent.press(screen.getByRole("button", { name: "Dog" }));
    await fireEvent.press(screen.getByRole("button", { name: "Cat" }));
    expect(fields).toEqual({ pets: ["dog", "cat"] });
    await fireEvent.press(screen.getByRole("button", { name: "Dog" }));
    expect(fields).toEqual({ pets: ["cat"] });
    await fireEvent.press(screen.getByRole("button", { name: "Cat" }));
    expect(fields).toEqual({});
  });

  it("takes as many as one likes: a sixth language and a fourth line of work join (#239)", async () => {
    const five = ["fi", "sv", "en", "es", "de"];
    await show("languages", { languages: five } as ProfileFields);
    await fireEvent.changeText(screen.getByLabelText("Search"), "fren");
    await fireEvent.press(screen.getByRole("button", { name: "French" }));
    expect(fields).toEqual({ languages: [...five, "fr"] });
    expect(chosen("French")).toBe(true);
  });

  it("takes every hobby across the groups, with no cap (#239)", async () => {
    const many = ["hiking", "gym", "cooking", "reading", "board_games", "sauna"];
    await show("hobbies", { hobbies: many } as ProfileFields);
    await fireEvent.press(screen.getByRole("button", { name: "Yoga" }));
    expect(fields).toEqual({ hobbies: [...many, "yoga"] });
  });

  it("lets 'None of them' stand alone: it clears the parties, and a party clears it (#239)", async () => {
    await show("politics", { politics: ["kok", "vihr"] } as ProfileFields);
    await fireEvent.press(screen.getByRole("button", { name: "None of them" }));
    expect(fields).toEqual({ politics: ["none_of_them"] });
    expect(chosen("National Coalition Party")).toBe(false);
    expect(chosen("None of them")).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Greens" }));
    expect(fields).toEqual({ politics: ["vihr"] });
    expect(chosen("None of them")).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Greens" }));
    expect(fields).toEqual({});
  });

  it("lets 'No snus or pouches' stand alone, and takes snus and pouches together (#239)", async () => {
    await show("nicotine");
    await fireEvent.press(screen.getByRole("button", { name: "Snus" }));
    await fireEvent.press(screen.getByRole("button", { name: "Nicotine pouches" }));
    expect(fields).toEqual({ nicotine: ["snus", "pouches"] });
    await fireEvent.press(screen.getByRole("button", { name: "No snus or pouches" }));
    expect(fields).toEqual({ nicotine: ["none"] });
    await fireEvent.press(screen.getByRole("button", { name: "Snus" }));
    expect(fields).toEqual({ nicotine: ["snus"] });
  });

  it("offers vaping among the ways of smoking (#239)", async () => {
    await show("smoking");
    await fireEvent.press(screen.getByRole("button", { name: "Vaping" }));
    expect(fields).toEqual({ smoking: "vaping" });
  });

  it("offers non-religious among the stances, between spiritual and agnostic (#509)", async () => {
    await show("religion");
    const stances = screen.getAllByText(/^(Spiritual|Non-religious|Agnostic)$/);
    expect(stances.map((chip) => chip.props.children)).toEqual([
      "Spiritual",
      "Non-religious",
      "Agnostic",
    ]);
    await fireEvent.press(screen.getByRole("button", { name: "Non-religious" }));
    expect(fields).toEqual({ religion: "non_religious" });
  });

  it("no longer offers the coffee party (#239)", async () => {
    await show("politics");
    expect(screen.queryByRole("button", { name: "The Coffee Party" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(11);
  });

  it("puts a glyph before a party's name and still names the button by the party alone", async () => {
    await show("politics");
    const party = screen.getByRole("button", { name: "National Coalition Party" });
    expect(party.props.accessibilityLabel).toBe("National Coalition Party");
    await fireEvent.press(party);
    expect(fields).toEqual({ politics: ["kok"] });
  });
});

describe("FieldEditor: a long list", () => {
  it("offers a search that narrows the chips to the matching ones", async () => {
    await show("languages");
    expect(screen.getByRole("button", { name: "Finnish" })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search"), "  GERM ");
    expect(screen.getByRole("button", { name: "German" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finnish" })).toBeNull();
  });

  it("shows the hobbies in their groups, hides a group with no match, and keeps something else apart", async () => {
    await show("hobbies");
    expect(screen.getByText("Outdoors")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Something else" })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search"), "yoga");
    expect(screen.getByRole("button", { name: "Yoga" })).toBeTruthy();
    expect(screen.queryByText("Outdoors")).toBeNull();
    expect(screen.queryByRole("button", { name: "Something else" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search"), "something");
    expect(screen.getByRole("button", { name: "Something else" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Yoga" })).toBeNull();
  });

  it("offers no search over a short list", async () => {
    await show("smoking");
    expect(screen.queryByLabelText("Search")).toBeNull();
  });

  it.each([
    ["zodiac", "Corgi"],
    ["politics", "None of them"],
    ["field", "Other"],
  ] as const)(
    "offers no search over the %s, whose every option fits a screen (#239)",
    async (field, last) => {
      await show(field);
      expect(screen.queryByLabelText("Search")).toBeNull();
      expect(screen.getByRole("button", { name: last })).toBeTruthy();
    },
  );

  it("leads the languages with ten and the chosen, and finds the rest by search (#239)", async () => {
    await show("languages", { languages: ["de"] } as ProfileFields);
    for (const name of ["Finnish", "Swedish", "English", "Russian", "Somali", "German"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Vietnamese is eleventh: found by search only.
    expect(screen.queryByRole("button", { name: "Vietnamese" })).toBeNull();
    expect(screen.queryByRole("button", { name: "French" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search"), "viet");
    await fireEvent.press(screen.getByRole("button", { name: "Vietnamese" }));
    expect(fields).toEqual({ languages: ["de", "vi"] });
    // Chosen, it stays in view once the search is emptied.
    await fireEvent.changeText(screen.getByLabelText("Search"), "");
    expect(chosen("Vietnamese")).toBe(true);
    expect(screen.queryByRole("button", { name: "French" })).toBeNull();
  });

  it("offers Another language only once a search finds no language of the list, and keeps it in view once chosen (#616)", async () => {
    await show("languages");
    expect(screen.queryByRole("button", { name: "Another language" })).toBeNull();
    // A search that finds a language of the list offers that one alone.
    await fireEvent.changeText(screen.getByLabelText("Search"), "another");
    expect(screen.getByRole("button", { name: "Another language" })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Search"), "germ");
    expect(screen.getByRole("button", { name: "German" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Another language" })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText("Search"), "Icelandic");
    await fireEvent.press(screen.getByRole("button", { name: "Another language" }));
    expect(fields).toEqual({ languages: ["other"] });
    await fireEvent.changeText(screen.getByLabelText("Search"), "");
    expect(chosen("Another language")).toBe(true);
  });

  it.each([
    ["sign language", ["Finnish Sign Language", "Finland-Swedish Sign Language"]],
    ["sami", ["Northern Sami", "Inari Sami", "Skolt Sami"]],
    ["karel", ["Karelian"]],
    ["romani", ["Finnish Romani", "Romanian"]],
  ] as const)("finds Finland's own languages by a search for %s (#616)", async (search, found) => {
    await show("languages");
    await fireEvent.changeText(screen.getByLabelText("Search"), search);
    for (const name of found) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Finnish" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Another language" })).toBeNull();
  });

  it("keeps a language beyond the first ten in view once taken back, so it can be chosen again (#239)", async () => {
    await show("languages", { languages: ["fi", "de"] } as ProfileFields);
    await fireEvent.press(screen.getByRole("button", { name: "German" }));
    expect(fields).toEqual({ languages: ["fi"] });
    expect(chosen("German")).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "German" }));
    expect(fields).toEqual({ languages: ["fi", "de"] });
  });
});

describe("FieldEditor: the school and the guild (#677)", () => {
  const ANOTHER = "Another guild";
  /** A button's name: its label, or the words it holds. */
  type Node = ReturnType<typeof screen.getByRole>;
  const named = (node: Node): string =>
    typeof node.props.accessibilityLabel === "string"
      ? node.props.accessibilityLabel
      : node.children
          .map((child) => (typeof child === "string" ? child : named(child as Node)))
          .join("");
  /** What each button of the picker is called, in reading order. */
  const buttons = () => screen.getAllByRole("button").map(named);
  const SCHOOLS = [
    "University of Helsinki",
    "Aalto University",
    "Hanken School of Economics",
    "University of the Arts Helsinki",
    "Metropolia University of Applied Sciences",
    "Haaga-Helia University of Applied Sciences",
    "Laurea University of Applied Sciences",
    "Arcada University of Applied Sciences",
    "Diaconia University of Applied Sciences",
    "Humak University of Applied Sciences",
  ];
  const FACULTIES = [
    "Faculty of Theology",
    "Faculty of Law",
    "Faculty of Medicine",
    "Faculty of Arts",
    "Faculty of Science",
    "Faculty of Pharmacy",
    "Faculty of Biological and Environmental Sciences",
    "Faculty of Educational Sciences",
    "Faculty of Social Sciences",
    "Faculty of Agriculture and Forestry",
    "Faculty of Veterinary Medicine",
    "Swedish School of Social Science",
  ];
  const LAUREA = [
    "Laurean restonomiopiskelijayhdistys LARE ry",
    "Laurean Tradenomiopiskelijat LATO ry",
    "Laurean Sosiaalialojen Opiskelijat LASO ry",
    "Laurean Tietojenkäsittelyopiskelijat Jenkins ry",
  ];
  const SHS = "Svenska Handelshögskolans Studentkår";

  it("offers the ten schools as chips with no search, and takes as many as apply", async () => {
    await show("university");
    expect(buttons()).toEqual(SCHOOLS);
    expect(screen.queryByLabelText("Search")).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "Aalto University" }));
    await fireEvent.press(screen.getByRole("button", { name: "Hanken School of Economics" }));
    expect(fields).toEqual({ university: ["aalto", "hanken"] });
    expect(chosen("Aalto University")).toBe(true);
    expect(chosen("University of Helsinki")).toBe(false);
  });

  it.each([
    ["no school", {}],
    ["no school, even with a guild left behind", { guild: ["aalto_fyysikkokilta"] }],
  ] satisfies [string, ProfileFields][])(
    "asks no guild of somebody who named %s: nothing is drawn",
    async (_what, initial) => {
      await show("guild", initial);
      expect(screen.queryByText("Guild or student association")).toBeNull();
      expect(screen.queryAllByRole("button")).toEqual([]);
      expect(screen.queryByLabelText("Search")).toBeNull();
    },
  );

  it("asks a school's guilds under its name, by their own names in its list's order, another guild last, with no search over a short list", async () => {
    await show("guild", { university: ["laurea"] });
    expect(screen.getByText("Guild or student association")).toBeTruthy();
    expect(screen.getByText("Laurea University of Applied Sciences")).toBeTruthy();
    expect(buttons()).toEqual([...LAUREA, ANOTHER]);
    expect(screen.queryByLabelText("Search")).toBeNull();
    // A school with no faculties in its list draws none.
    for (const faculty of FACULTIES) expect(screen.queryByText(faculty)).toBeNull();
    const found = pressables(screen.toJSON() as HostNode);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
  });

  it("asks the union as the one guild of a school whose union lists none", async () => {
    await show("guild", { university: ["hanken"] });
    expect(buttons()).toEqual([SHS, ANOTHER]);
  });

  it("takes as many guilds as apply and another guild beside them, and drops the field with the last", async () => {
    await show("guild", { university: ["aalto"] });
    await fireEvent.press(screen.getByRole("button", { name: "Fyysikkokilta (FK)" }));
    await fireEvent.press(screen.getByRole("button", { name: ANOTHER }));
    expect(fields).toEqual({
      university: ["aalto"],
      guild: ["aalto_fyysikkokilta", "aalto_other"],
    });
    expect(chosen("Fyysikkokilta (FK)")).toBe(true);
    expect(chosen(ANOTHER)).toBe(true);
    expect(chosen("Teknologföreningen (TF)")).toBe(false);
    await fireEvent.press(screen.getByRole("button", { name: "Fyysikkokilta (FK)" }));
    expect(fields).toEqual({ university: ["aalto"], guild: ["aalto_other"] });
    await fireEvent.press(screen.getByRole("button", { name: ANOTHER }));
    expect(fields).toEqual({ university: ["aalto"] });
  });

  it("orders Helsinki's guilds under their faculties, and Mythos under both of its own as one answer", async () => {
    await show("guild", { university: ["helsinki"] });
    expect(screen.getByText("University of Helsinki")).toBeTruthy();
    for (const faculty of FACULTIES) expect(screen.getByText(faculty)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pykälä ry" })).toBeTruthy();
    // 115 guilds, two of them under two faculties, and another guild.
    expect(buttons()).toHaveLength(115 + 2 + 1);
    expect(buttons().at(-1)).toBe(ANOTHER);
    const twice = screen.getAllByRole("button", { name: "Mythos ry" });
    expect(twice).toHaveLength(2);
    await fireEvent.press(twice[0] as (typeof twice)[number]);
    expect(fields).toEqual({ university: ["helsinki"], guild: ["helsinki_mythos"] });
    for (const chip of screen.getAllByRole("button", { name: "Mythos ry" })) {
      expect(chip.props.accessibilityState?.selected).toBe(true);
    }
    const found = pressables(screen.toJSON() as HostNode);
    expect(found.flatMap((node) => a11yProblems(node))).toEqual([]);
  });

  it("searches a long list by the guilds' names, hides a faculty with no match, and keeps another guild whatever is searched for", async () => {
    await show("guild", { university: ["helsinki"] });
    await fireEvent.changeText(screen.getByLabelText("Search"), "  TKO-ä ");
    expect(buttons()).toEqual(["TKO-äly ry", ANOTHER]);
    expect(screen.getByText("Faculty of Science")).toBeTruthy();
    expect(screen.queryByText("Faculty of Law")).toBeNull();
    // A search that finds nothing is how one learns the list lacks a guild.
    await fireEvent.changeText(screen.getByLabelText("Search"), "no such guild");
    expect(buttons()).toEqual([ANOTHER]);
    expect(screen.getByText("University of Helsinki")).toBeTruthy();
    for (const faculty of FACULTIES) expect(screen.queryByText(faculty)).toBeNull();
    // The words of another guild are no name to search by: it is there anyway.
    await fireEvent.changeText(screen.getByLabelText("Search"), "another");
    expect(buttons()).toEqual([ANOTHER]);
    await fireEvent.press(screen.getByRole("button", { name: ANOTHER }));
    expect(fields).toEqual({ university: ["helsinki"], guild: ["helsinki_other"] });
  });

  it.each([
    ["the name its members say", " nude", "Nuoret Designerit Ry (NuDe)"],
    ["its own name", "nuoret des", "Nuoret Designerit Ry (NuDe)"],
    ["the name its members say, whatever the case", "pjk", "Puunjalostajakilta ry (PJK)"],
  ])("finds a guild by %s, and writes both on its chip", async (_what, search, chip) => {
    await show("guild", { university: ["aalto"] });
    await fireEvent.changeText(screen.getByLabelText("Search"), search);
    expect(buttons()).toEqual([chip, ANOTHER]);
    await fireEvent.press(screen.getByRole("button", { name: chip }));
    expect(chosen(chip)).toBe(true);
  });

  it("asks each named school's guilds under its own name, in the list's order whichever was named first, another guild of each", async () => {
    await show("guild", { university: ["laurea", "hanken"] });
    expect(buttons()).toEqual([SHS, ANOTHER, ...LAUREA, ANOTHER]);
    const tree = JSON.stringify(screen.toJSON());
    expect(tree.indexOf("Hanken School of Economics")).toBeLessThan(
      tree.indexOf("Laurea University of Applied Sciences"),
    );
    const others = screen.getAllByRole("button", { name: ANOTHER });
    await fireEvent.press(others[1] as (typeof others)[number]);
    expect(fields).toEqual({ university: ["laurea", "hanken"], guild: ["laurea_other"] });
    expect(
      screen
        .getAllByRole("button", { name: ANOTHER })
        .map((chip) => chip.props.accessibilityState?.selected),
    ).toEqual([false, true]);
  });

  it.each([
    ["no search over thirteen", ["uniarts"], false],
    ["a search over fifteen", ["uniarts", "hanken"], true],
    ["a search over Aalto's thirty-six", ["aalto"], true],
  ] satisfies [string, ProfileFields["university"], boolean][])(
    "counts what the named schools offer, not the whole list: %s",
    async (_what, university, searchable) => {
      await show("guild", { university });
      expect(screen.queryByLabelText("Search") !== null).toBe(searchable);
    },
  );

  it.each([
    ["fi-FI", "Aalto-yliopisto", "Muu kilta", "Kilta tai ainejärjestö"],
    ["sv-FI", "Aalto-universitetet", "Annat gille", "Gille eller ämnesförening"],
  ])(
    "names a guild the same in %s, with the school, another guild and the question in the reader's language",
    async (tag, school, another, question) => {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
      try {
        await show("guild", { university: ["aalto"] });
        expect(screen.getByText(question)).toBeTruthy();
        expect(screen.getByText(school)).toBeTruthy();
        expect(screen.getByRole("button", { name: "Fyysikkokilta (FK)" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Teknologföreningen (TF)" })).toBeTruthy();
        expect(buttons().at(-1)).toBe(another);
      } finally {
        (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
      }
    },
  );

  it("takes a school's guilds along when the school is taken back, and keeps the other school's", async () => {
    await show("university", {
      university: ["aalto", "hanken"],
      guild: ["aalto_fyysikkokilta", "hanken_shs", "aalto_other"],
    });
    await fireEvent.press(screen.getByRole("button", { name: "Aalto University" }));
    expect(fields).toEqual({ university: ["hanken"], guild: ["hanken_shs"] });
    await fireEvent.press(screen.getByRole("button", { name: "Hanken School of Economics" }));
    expect(fields).toEqual({});
  });

  it("keeps the guilds chosen when another school is named", async () => {
    await show("university", { university: ["aalto"], guild: ["aalto_fyysikkokilta"] });
    await fireEvent.press(screen.getByRole("button", { name: "University of Helsinki" }));
    expect(fields).toEqual({ university: ["aalto", "helsinki"], guild: ["aalto_fyysikkokilta"] });
  });

  it("leaves every other answer as it was when a school goes", async () => {
    await show("university", {
      university: ["aalto"],
      guild: ["aalto_fyysikkokilta"],
      education: "maisteri",
      field: ["tech"],
    });
    await fireEvent.press(screen.getByRole("button", { name: "Aalto University" }));
    expect(fields).toEqual({ education: "maisteri", field: ["tech"] });
  });
});

describe("withoutStrayGuilds (#677)", () => {
  it.each([
    [
      "keeps the guilds of the schools named",
      { university: ["aalto"], guild: ["aalto_ky"] },
      ["aalto_ky"],
    ],
    [
      "drops a guild of a school not named, another guild as any",
      { university: ["hanken"], guild: ["aalto_ky", "hanken_shs", "aalto_other"] },
      ["hanken_shs"],
    ],
    [
      "drops the field with its last guild",
      { university: ["hanken"], guild: ["aalto_ky"] },
      undefined,
    ],
    ["drops every guild with no school named", { guild: ["aalto_ky"] }, undefined],
    ["has nothing to drop with no guild", { university: ["aalto"] }, undefined],
  ] satisfies [string, ProfileFields, ProfileFields["guild"]][])("%s", (_what, fields, guild) => {
    const before: ProfileFields = fields;
    const after = withoutStrayGuilds(before);
    expect(after.guild).toEqual(guild);
    expect("guild" in after).toBe(guild !== undefined);
    expect(after.university).toEqual(before.university);
  });

  it("leaves, of any schools and any guilds, what an update takes: the guilds of the schools named, in their order", () => {
    // The school of a guild read off its id, not through the lookup the function itself asks.
    const schoolOf = (guild: string) =>
      UNIVERSITIES.find((school) => guild.startsWith(`${school}_`));
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...UNIVERSITIES], { maxLength: 4 }),
        fc.shuffledSubarray([...GUILD_OPTIONS], { maxLength: 8 }),
        (university, guild) => {
          const before = {
            intent: "long_term",
            ...(university.length > 0 && { university }),
            ...(guild.length > 0 && { guild }),
          } as ProfileFields;
          const after = withoutStrayGuilds(before);
          const kept = guild.filter((one) => university.some((school) => school === schoolOf(one)));
          expect(after).toEqual({
            intent: "long_term",
            ...(university.length > 0 && { university }),
            ...(kept.length > 0 && { guild: kept }),
          });
          expect("guild" in after).toBe(kept.length > 0);
          expect(withoutStrayGuilds(after)).toEqual(after);
          expect(
            ProfileUpdate.safeParse({
              displayName: "Aino",
              bio: null,
              bioPreset: null,
              prompts: [],
              fields: after,
            }).success,
          ).toBe(true);
        },
      ),
      { seed: 677, numRuns: 300 },
    );
  });
});

describe("visibleOptions", () => {
  const text = (option: string) => `Text of ${option}`;

  it("shows every option of a list that names no first ones, and filters any list by its texts", () => {
    expect(visibleOptions(["a", "b", "c"], undefined, [], "", text)).toEqual(["a", "b", "c"]);
    expect(visibleOptions(["a", "b", "c"], undefined, [], "  OF B ", text)).toEqual(["b"]);
    expect(visibleOptions(["a", "b", "other"], 1, ["b"], "of a", text)).toEqual(["a"]);
    expect(visibleOptions(["a", "b"], undefined, [], "nothing", text)).toEqual([]);
  });

  it("shows the first ones and the chosen of a list that names first ones", () => {
    expect(visibleOptions(["a", "b", "c", "d", "other"], 2, ["d"], "", text)).toEqual([
      "a",
      "b",
      "d",
    ]);
    expect(visibleOptions(["a", "b", "c", "other"], 2, ["other"], "", text)).toEqual([
      "a",
      "b",
      "other",
    ]);
    expect(visibleOptions(["a", "b", "c"], 0, [], " ", text)).toEqual([]);
  });

  it("keeps 'other' of a list that names first ones for a search that finds nothing else (#616)", () => {
    const options = ["a", "b", "c", "other"];
    expect(visibleOptions(options, 2, [], "of c", text)).toEqual(["c"]);
    // Its own text found is no language of the list found.
    expect(visibleOptions(options, 2, [], "of other", text)).toEqual(["other"]);
    expect(visibleOptions(options, 2, [], "nothing", text)).toEqual(["other"]);
    expect(visibleOptions(options, 2, ["other"], "of a", text)).toEqual(["a"]);
    // A list without one finds nothing.
    expect(visibleOptions(["a", "b", "c"], 2, [], "nothing", text)).toEqual([]);
  });
});

describe("toggled", () => {
  const spec = { alone: ["none"] };

  it("adds any option, as many as one likes, and takes a chosen one away", () => {
    expect(toggled([], "a", spec)).toEqual(["a"]);
    expect(toggled(["a"], "b", spec)).toEqual(["a", "b"]);
    expect(toggled(["a", "b", "c"], "d", spec)).toEqual(["a", "b", "c", "d"]);
    expect(toggled(["a", "b"], "a", spec)).toEqual(["b"]);
  });

  it("lets an option that stands alone replace the rest, and gives way to any other", () => {
    expect(toggled(["a", "b", "c"], "none", spec)).toEqual(["none"]);
    expect(toggled(["none"], "a", spec)).toEqual(["a"]);
    expect(toggled(["none"], "none", spec)).toEqual([]);
    expect(toggled(["a"], "b", { alone: [] })).toEqual(["a", "b"]);
  });
});

describe("FieldEditor: a short text", () => {
  it("keeps what is typed, says what to leave out, stops at its length itself, and drops the field when emptied", async () => {
    await show("occupationTitle");
    const input = screen.getByLabelText("Job title");
    expect(input.props.value).toBe("");
    // The maintainer's rule, which only these words carry; the field stops at 40 by itself (#581).
    expect(screen.getByText("Without the employer's name")).toBeTruthy();
    expect(input.props.maxLength).toBe(40);
    await fireEvent.changeText(input, "Architect");
    expect(fields).toEqual({ occupationTitle: "Architect" });
    await fireEvent.changeText(input, "");
    expect(fields).toEqual({});
  });

  it.each([
    ["fi-FI", "Ilman työnantajan nimeä"],
    ["sv-FI", "Utan arbetsgivarens namn"],
  ])("says what to leave out in %s, with no length", async (tag, words) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag: tag }]);
    try {
      await show("occupationTitle");
      expect(screen.getByText(words)).toBeTruthy();
    } finally {
      (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
    }
  });

  it("shows an empty box for a stored value that is not text", async () => {
    await show("occupationTitle", { occupationTitle: 7 } as unknown as ProfileFields);
    expect(screen.getByLabelText("Job title").props.value).toBe("");
  });
});

describe("FieldEditor: a number", () => {
  it("starts unanswered, takes the middle of the range on the first press, then moves by one", async () => {
    await show("height");
    expect(screen.getByText("No answer yet")).toBeTruthy();
    // No line under the stepper about the range (#287): its ends say where it stops.
    expect(screen.queryByText(/whole number/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear the answer" })).toBeNull();
    await fireEvent.press(screen.getByRole("button", { name: "One less" }));
    expect(fields).toEqual({ height: 175 });
    await fireEvent.press(screen.getByRole("button", { name: "One more" }));
    expect(fields).toEqual({ height: 176 });
    expect(screen.getByText("176 cm")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Clear the answer" }));
    expect(fields).toEqual({});
  });

  it("has Clear the answer as an outlined button, only with an answer to clear (#581)", async () => {
    await show("height", { height: 170 } as ProfileFields);
    const clear = screen.getByRole("button", { name: "Clear the answer" });
    expect(clear.props.className).toMatch(/\bborder-input\b/);
    expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
  });

  it("names the field once: its own label, not the stepper's again (#238)", async () => {
    await show("height", { height: 170 } as ProfileFields);
    expect(screen.getAllByText("Height")).toHaveLength(1);
    // The one kept is the field's own, with its icon, as every other field has it.
    expect(screen.getByTestId("field-icon-height", { includeHiddenElements: true })).toBeTruthy();
  });

  it("stops at either end of the range", async () => {
    await show("height", { height: 260 } as ProfileFields);
    const up = screen.getByRole("button", { name: "One more" });
    expect(up.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "One less" }));
    expect(fields).toEqual({ height: 259 });
  });

  it("cannot go below the lower end", async () => {
    await show("height", { height: 90 } as ProfileFields);
    expect(
      screen.getByRole("button", { name: "One less" }).props.accessibilityState?.disabled,
    ).toBe(true);
  });
});

describe("optionTextKey", () => {
  it("reads the wants-kids options as more children once there are kids", () => {
    expect(optionTextKey("wantsKids", "want", {})).toBe("profile.option.wantsKids.want");
    expect(optionTextKey("wantsKids", "want", { hasKids: "no" } as ProfileFields)).toBe(
      "profile.option.wantsKids.want",
    );
    expect(optionTextKey("wantsKids", "want", { hasKids: "yes_with_me" } as ProfileFields)).toBe(
      "profile.optionWithKids.wantsKids.want",
    );
    expect(optionTextKey("smoking", "never", { hasKids: "yes_with_me" } as ProfileFields)).toBe(
      "profile.option.smoking.never",
    );
  });
});

describe("OptionSearch", () => {
  it("is a labelled field that hands on what is typed", async () => {
    const onChange = jest.fn();
    await renderWithTheme(<OptionSearch value="" onChange={onChange} />);
    const field = screen.getByLabelText("Search");
    expect(field.props.placeholder).toBe("Search");
    fireEvent.changeText(field, "fin");
    expect(onChange).toHaveBeenCalledWith("fin");
  });
});
