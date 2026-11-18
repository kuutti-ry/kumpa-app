import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { IMAGE_CREDITS } from "./image-credits";

// The credits on the licences screen held to the NOTICE files under assets/
// (#405): a file whose terms ask for credit, by its author and licence, is
// credited, and nothing is credited that no file asks for. A public-domain or
// CC0 file asks for none, and a mark is shown only to name its owner.

const ASSETS = resolve(__dirname, "../../../assets");

type Row = { notice: string; file: string; terms: string; author: string };

/** A Markdown link's words, without its address. */
const words = (cell: string) => cell.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();

/** Every row of every table in a NOTICE file, by its header's column names. */
function rows(notice: string): Row[] {
  const found: Row[] = [];
  let header: string[] | null = null;
  for (const line of readFileSync(join(ASSETS, notice), "utf8").split("\n")) {
    if (!line.startsWith("|")) {
      header = null;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map(words);
    if (!header) header = cells;
    else if (!cells.every((cell) => /^-+$/.test(cell))) {
      const at = (name: string) => cells[header?.indexOf(name) ?? -1] ?? "";
      found.push({
        notice,
        file: at("file").replaceAll("`", ""),
        terms: at("terms"),
        author: at("author"),
      });
    }
  }
  return found;
}

const NOTICES = readdirSync(ASSETS, { recursive: true, encoding: "utf8" }).filter((path) =>
  path.endsWith("NOTICE.md"),
);
const ROWS = NOTICES.flatMap(rows);
const asksForCredit = ({ terms }: Row) => !/^public domain|^cc0|mark/i.test(terms);
const OWED = ROWS.filter(asksForCredit);

describe("the credits of the images (#405)", () => {
  it("reads every file of the NOTICE files under assets", () => {
    expect(NOTICES.sort()).toEqual(["glyphs/NOTICE.md", "support/NOTICE.md"]);
    for (const row of ROWS) expect(row.file).toMatch(/\.(svg|png)$/);
    expect(ROWS.map((row) => row.file)).toEqual(
      expect.arrayContaining([
        "politics/kok.svg",
        "zodiac/aries.svg",
        "contact/telegram.svg",
        "mieli.png",
      ]),
    );
  });

  it("asks no credit for a public-domain or CC0 file, nor for a mark", () => {
    const terms = (file: string) => ROWS.find((row) => row.file === file) as Row;
    expect(asksForCredit(terms("religion/muslim.svg"))).toBe(false);
    expect(asksForCredit(terms("religion/lutheran.svg"))).toBe(false);
    expect(asksForCredit(terms("contact/telegram.svg"))).toBe(false);
    expect(asksForCredit(terms("politics/kok.svg"))).toBe(false);
    expect(asksForCredit(terms("mieli.png"))).toBe(false);
    expect(asksForCredit(terms("zodiac/aries.svg"))).toBe(true);
  });

  it("credits every file whose terms ask for it, by its author and licence", () => {
    expect(OWED.length).toBeGreaterThan(0);
    for (const { file, author, terms } of OWED) {
      expect({
        file,
        credited: IMAGE_CREDITS.some((c) => c.author === author && c.licence === terms),
      }).toEqual({
        file,
        credited: true,
      });
    }
  });

  it("credits nothing that no file asks for", () => {
    for (const { author, licence } of IMAGE_CREDITS) {
      expect(OWED.some((row) => row.author === author && row.terms === licence)).toBe(true);
    }
  });

  it("gives each licence's own address", () => {
    for (const { licence, licenceUrl } of IMAGE_CREDITS) {
      const [, kind, version] = /^CC (BY(?:-[A-Z]+)*) (\d\.\d)$/.exec(licence) ?? [];
      expect(licenceUrl).toBe(
        `https://creativecommons.org/licenses/${kind?.toLowerCase()}/${version}/`,
      );
    }
  });
});
