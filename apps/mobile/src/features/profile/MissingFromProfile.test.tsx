import { act } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { View } from "react-native";
import type { HostNode } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { MissingFromProfile } from "./MissingFromProfile";

// What the profile lacks, for the home screen's matching card (#745): the
// profile screen's lines, read from GET /profile, and nothing while they cannot be.

/** The screen gets the focus again, as on coming back to it (jest.setup.js). */
const { __focus: focus } = jest.requireMock("expo-router") as { __focus: () => void };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const lacking = (missing: string[]) => () =>
  json({ profile: null, completeness: { complete: missing.length === 0, missing }, home: null });

const broken = () => json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500);

function answering(answers: Array<() => Response | Promise<Response>>) {
  const calls: Request[] = [];
  globalThis.fetch = jest.fn(async (input: Request | string) => {
    const request = input instanceof Request ? input : new Request(input);
    calls.push(request);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    if (!answer) throw new Error("no answer prepared");
    return answer();
  }) as unknown as typeof fetch;
  return calls;
}

const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 20)));

/** Every word drawn, in the order it is read. */
const said = (node: HostNode | HostNode[] | string | null): string[] =>
  node === null
    ? []
    : typeof node === "string"
      ? [node]
      : Array.isArray(node)
        ? node.flatMap(said)
        : (node.children ?? []).flatMap((child) => said(child));

async function shown() {
  const screen = await renderWithTheme(
    <View testID="slot">
      <MissingFromProfile />
    </View>,
  );
  await settle();
  return screen;
}

/** What the list draws where the card puts it: nothing at all is no node, not an empty one in the card's gap. */
function drawn(root: HostNode): HostNode["children"] {
  const find = (node: HostNode | string): HostNode | null => {
    if (typeof node === "string") return null;
    if (node.props.testID === "slot") return node;
    for (const child of node.children ?? []) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  return find(root)?.children ?? [];
}

beforeEach(() => {
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
});

describe("MissingFromProfile", () => {
  it("reads the profile", async () => {
    const calls = answering([lacking(["photos"])]);
    await shown();
    expect(calls.map((call) => [call.method, new URL(call.url).pathname])).toEqual([
      ["GET", "/profile"],
    ]);
  });

  it("names everything the profile lacks, a line each, in the profile screen's words and order", async () => {
    answering([lacking(["display_name", "photos", "seeks", "age_window"])]);
    const screen = await shown();
    expect(said(screen.toJSON() as HostNode)).toEqual([
      "A name on the card",
      "At least 2 approved photos",
      "Whom you are looking for",
      "Your age window",
    ]);
  });

  it.each([
    ["fi-FI", "Vähintään 2 hyväksyttyä kuvaa"],
    ["sv-FI", "Minst 2 godkända foton"],
  ])("says it in %s too", async (languageTag, line) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    answering([lacking(["photos"])]);
    const screen = await shown();
    expect(said(screen.toJSON() as HostNode)).toEqual([line]);
  });

  it.each([
    ["a finished profile", lacking([])],
    ["a profile that could not be read", broken],
    [
      "an answer this build cannot read",
      () =>
        json({
          profile: null,
          completeness: { complete: false, missing: ["a_later_item"] },
          home: null,
        }),
    ],
  ])("draws nothing for %s", async (_case, answer) => {
    answering([answer]);
    const screen = await shown();
    expect(drawn(screen.toJSON() as HostNode)).toEqual([]);
  });

  it("draws nothing while the answer is on its way", async () => {
    answering([() => new Promise<Response>(() => undefined)]);
    const screen = await shown();
    expect(drawn(screen.toJSON() as HostNode)).toEqual([]);
  });

  it("reads again when the screen comes back to the front, and says what is still missing", async () => {
    const calls = answering([lacking(["display_name", "photos"]), lacking(["photos"])]);
    const screen = await shown();
    expect(said(screen.toJSON() as HostNode)).toEqual([
      "A name on the card",
      "At least 2 approved photos",
    ]);
    await act(async () => {
      focus();
    });
    await settle();
    expect(calls).toHaveLength(2);
    expect(said(screen.toJSON() as HostNode)).toEqual(["At least 2 approved photos"]);
  });

  it("keeps what it knew when a later read fails", async () => {
    answering([lacking(["photos"]), broken]);
    const screen = await shown();
    await act(async () => {
      focus();
    });
    await settle();
    expect(said(screen.toJSON() as HostNode)).toEqual(["At least 2 approved photos"]);
  });

  it("lets the later of two reads under way speak", async () => {
    // The first answer comes when the test lets it, after the second.
    let arrive: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      arrive = resolve;
    });
    answering([
      async () => {
        await held;
        return lacking(["display_name", "photos"])();
      },
      lacking(["photos"]),
    ]);
    const screen = await shown();
    await act(async () => {
      focus();
    });
    await settle();
    expect(said(screen.toJSON() as HostNode)).toEqual(["At least 2 approved photos"]);
    await act(async () => {
      arrive();
    });
    await settle();
    expect(said(screen.toJSON() as HostNode)).toEqual(["At least 2 approved photos"]);
  });
});
