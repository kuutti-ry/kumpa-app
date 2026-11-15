import { describe, expect, it } from "vitest";
import {
  GUILD_GROUP_KEYS,
  GUILD_OPTIONS,
  guildName,
  guildsOf,
  otherGuildOf,
  UNIVERSITIES,
  universityOfGuild,
} from "./guilds.ts";

// The schools and their guilds (#677): the lists as the registers had them on
// 15/11/2026, ids that stay, and what the maintainer left out.

const listed = UNIVERSITIES.flatMap((university) =>
  guildsOf(university).map((guild) => ({ ...guild, university })),
);

describe("the schools and their guilds (#677)", () => {
  it("names the capital area's ten schools once each, universities first", () => {
    expect(UNIVERSITIES).toEqual([
      "helsinki",
      "aalto",
      "hanken",
      "uniarts",
      "metropolia",
      "haaga_helia",
      "laurea",
      "arcada",
      "diak",
      "humak",
    ]);
  });

  // A register read again changes a number here, on purpose and in the same change.
  it.each([
    ["helsinki", 115],
    ["aalto", 35],
    ["hanken", 1],
    ["uniarts", 12],
    ["metropolia", 15],
    ["haaga_helia", 1],
    ["laurea", 4],
    ["arcada", 1],
    ["diak", 1],
    ["humak", 1],
  ] as const)("lists the guilds of %s as its register does: %i", (university, count) => {
    expect(guildsOf(university)).toHaveLength(count);
  });

  it("gives every guild an id of its school that no other guild has, and its own name", () => {
    expect(new Set(listed.map((guild) => guild.id)).size).toBe(listed.length);
    for (const guild of listed) {
      expect(guild.id, guild.id).toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
      expect(guild.id.startsWith(`${guild.university}_`), guild.id).toBe(true);
      expect(guild.id.endsWith("_other"), guild.id).toBe(false);
      expect(guild.name, guild.id).toBe(guild.name.trim());
      expect(guild.name.length, guild.id).toBeGreaterThan(1);
    }
    for (const university of UNIVERSITIES) {
      const names = guildsOf(university).map((guild) => guild.name);
      expect(new Set(names).size, university).toBe(names.length);
    }
  });

  it("orders Helsinki's guilds by faculty, every faculty with a guild, and no other school's", () => {
    for (const guild of listed) {
      if (guild.university !== "helsinki") {
        expect(guild.groups, guild.id).toBeUndefined();
        continue;
      }
      expect(guild.groups?.length, guild.id).toBeGreaterThan(0);
      expect(new Set(guild.groups).size, guild.id).toBe(guild.groups?.length);
      for (const group of guild.groups ?? []) expect(GUILD_GROUP_KEYS, guild.id).toContain(group);
    }
    for (const group of GUILD_GROUP_KEYS) {
      expect(
        guildsOf("helsinki").some((guild) => guild.groups?.includes(group)),
        group,
      ).toBe(true);
    }
    expect(GUILD_GROUP_KEYS).toHaveLength(12);
    expect(new Set(GUILD_GROUP_KEYS).size).toBe(12);
  });

  it("keeps Mythos and Orbis once each, under both of their faculties", () => {
    const twice = guildsOf("helsinki").filter((guild) => (guild.groups?.length ?? 0) > 1);
    expect(twice).toEqual([
      { id: "helsinki_mythos", name: "Mythos ry", groups: ["theology", "arts"] },
      { id: "helsinki_orbis", name: "Orbis ry", groups: ["theology", "arts"] },
    ]);
  });

  it("offers school by school its guilds in the register's order, then another guild", () => {
    expect(GUILD_OPTIONS).toEqual(
      UNIVERSITIES.flatMap((university) => [
        ...guildsOf(university).map((guild) => guild.id),
        `${university}_other`,
      ]),
    );
    expect(GUILD_OPTIONS).toHaveLength(186 + 10);
    expect(new Set(GUILD_OPTIONS).size).toBe(GUILD_OPTIONS.length);
    expect(GUILD_OPTIONS.slice(-2)).toEqual(["humak_humako", "humak_other"]);
  });

  it("knows every option's school", () => {
    for (const university of UNIVERSITIES) {
      expect(universityOfGuild(otherGuildOf(university))).toBe(university);
      for (const guild of guildsOf(university)) {
        expect(universityOfGuild(guild.id), guild.id).toBe(university);
      }
    }
    expect(GUILD_OPTIONS.map(universityOfGuild).filter((u) => u === undefined)).toEqual([]);
  });

  it("names a listed guild by its own name, and another guild by none", () => {
    expect(guildName("helsinki_tko_aly")).toBe("TKO-äly ry");
    expect(guildName("hanken_shs")).toBe("Svenska Handelshögskolans Studentkår");
    expect(guildName("aalto_kemistikilta")).toBe("Kemistikilta ry");
    for (const guild of listed) {
      if (guild.known === undefined) expect(guildName(guild.id), guild.id).toBe(guild.name);
    }
    for (const university of UNIVERSITIES) expect(guildName(otherGuildOf(university))).toBeNull();
  });

  // The names AYY's page gives in the associations' own words (the maintainer,
  // 15/11/2026): one more is added when its register is read, never from memory.
  it.each([
    ["aalto_marketing_society", "Aalto Marketing Society (AMS)"],
    ["aalto_arkkitehtikilta", "Aalto-yliopiston Arkkitehtikilta ry (AK)"],
    [
      "aalto_automaatio_ja_systeemitekniikan_kilta",
      "Automaatio- ja systeemitekniikan kilta ry (AS)",
    ],
    ["aalto_fyysikkokilta", "Fyysikkokilta (FK)"],
    ["aalto_koneinsinoorikilta", "Koneinsinöörikilta ry (KIK)"],
    ["aalto_maanmittarikilta", "Maanmittarikilta ry (MK)"],
    ["aalto_nuoret_designerit", "Nuoret Designerit Ry (NuDe)"],
    ["aalto_puunjalostajakilta", "Puunjalostajakilta ry (PJK)"],
    ["aalto_rakennusinsinoorikilta", "Rakennusinsinöörikilta ry (IK)"],
    ["aalto_teknologforeningen", "Teknologföreningen (TF)"],
    ["aalto_tietokilta", "Tietotekniikan kilta – Tietokilta ry (TiK)"],
    ["aalto_vuorimieskilta", "Vuorimieskilta ry (VK)"],
  ] as const)("writes %s with the name its members say after its own: %s", (id, words) => {
    expect(guildName(id)).toBe(words);
  });

  it("gives those twelve and no other guild a name its members say, each a word of its own", () => {
    const known = listed.filter((guild) => guild.known !== undefined);
    expect(known).toHaveLength(12);
    expect(known.map((guild) => guild.university)).toEqual(Array(12).fill("aalto"));
    for (const guild of known) {
      expect(guild.known, guild.id).toMatch(/^[A-Za-z]{2,5}$/);
      expect(guild.name, guild.id).not.toContain(`(${guild.known})`);
    }
    expect(new Set(known.map((guild) => guild.known)).size).toBe(12);
  });

  it("stands the union as the one guild of a school whose union lists none", () => {
    for (const university of ["hanken", "haaga_helia", "arcada", "diak", "humak"] as const) {
      expect(guildsOf(university), university).toHaveLength(1);
    }
    expect(guildsOf("arcada")[0]?.name).toBe("Arcada studerandekår – ASK");
  });

  it("leaves out the doctoral associations, the nations and Queerpolia", () => {
    const names = listed.map((guild) => guild.name).join("\n");
    expect(names).not.toMatch(/Aallonhuiput|UADoRe|Queerpolia/i);
    expect(names).not.toMatch(/osakun|\bnation\b/i);
    // The neighbours of what was left out are still there: the lists were cut, not shortened.
    expect(names).toContain("Aalto-yliopiston Arkkitehtikilta ry");
    expect(names).toContain("Peritia Vestio ry");
    expect(names).toContain("TeaK-jaosto");
  });
});
