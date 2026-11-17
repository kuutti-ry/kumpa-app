import { CONSENT_VERSIONS } from "@kuutti/i18n";
import { fireEvent, screen } from "@testing-library/react-native";
import { useLocales } from "expo-localization";
import { Linking } from "react-native";
import { apiBaseUrl } from "@/lib/api-url";
import { a11yProblems, type HostNode, pressables } from "@/test/a11y";
import { renderWithTheme } from "@/test/render";
import { LegalTextLink } from "./LegalTextLink";

// The line under a legal summary (#208, ADR-010 §4): the version this app
// carries, as a link to the full text at that version's anchor, through the
// API's page, which sends the browser on to the website.

afterEach(() => {
  jest.restoreAllMocks();
  (useLocales as jest.Mock).mockReturnValue([{ languageTag: "en-US" }]);
});

describe("LegalTextLink", () => {
  it.each([
    ["terms", "/legal/terms#terms-"],
    ["privacy", "/legal/privacy#privacy-"],
    ["special_category", "/legal/privacy#special_category-"],
  ] as const)(
    "opens the full text of %s at the anchor of the version it names",
    async (kind, page) => {
      const open = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
      const version = CONSENT_VERSIONS[kind];
      await renderWithTheme(<LegalTextLink kind={kind} />);
      const link = screen.getByRole("link", {
        name: `Read the full text on the website (version ${version})`,
      });
      expect(pressables(screen.toJSON() as HostNode).flatMap((n) => a11yProblems(n))).toEqual([]);
      await fireEvent.press(link);
      expect(open).toHaveBeenCalledWith(`${apiBaseUrl()}${page}${version}`);
    },
  );

  it.each([
    ["fi-FI", "Lue koko teksti verkkosivuilta (versio "],
    ["sv-FI", "Läs hela texten på webbplatsen (version "],
  ])("says where it leads in the phone's language, %s", async (languageTag, text) => {
    (useLocales as jest.Mock).mockReturnValue([{ languageTag }]);
    await renderWithTheme(<LegalTextLink kind="privacy" />);
    expect(await screen.findByText(`${text}${CONSENT_VERSIONS.privacy})`)).toBeTruthy();
  });
});
