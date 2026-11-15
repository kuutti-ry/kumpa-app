/**
 * The schools and their guilds (#677, ADR-019 §5 as amended on 2026-11-15):
 * the universities and the universities of applied sciences of the capital
 * area, and for each the subject associations its student union lists. A
 * closed list from a public register, never free text: a card stays free of
 * text a moderator would have to read, and nobody writes themselves a guild
 * of one.
 *
 * A guild's name is the association's own, as the register spells it, the
 * same in every language: it is data here and no messages.yaml key (ADR-019
 * §3). One thing is left off it: the school's name, where it stands before
 * the guild's own and says only whose guild it is. A guild is only ever
 * shown under its school's name or beside its school's chip, so
 * "Aalto-yliopiston Arkkitehtikilta ry" reads "Arkkitehtikilta ry" (the
 * maintainer, 15/11/2026). Six names, each with the register's in a comment
 * beside it, for the next reading. It stays where the school is part of the
 * name ("Aalto Accounting", "Yliopiston farmasiakunta", a union standing as
 * a guild), where it sits inside a description after a dash, and where what
 * would be left is no name ("Helsingin yliopiston kemistit ry"). Its id is
 * kept for good. A renamed association keeps its id and takes
 * the new name; one that is gone needs a migration that takes it out of the
 * stored answers first, since the reader drops a whole answer that names an
 * option the list has lost (ADR-009 §1).
 *
 * The registers, read on 15/11/2026 and again every August (the maintainer,
 * 15/11/2026):
 * - helsinki: HYY, https://hyy.fi/fi/opiskelijatoiminta/jarjestot/, the
 *   subject and faculty organisations by faculty. The nations and the
 *   political, religious and other organisations are other lists, and out.
 * - aalto: AYY, https://www.ayy.fi/fi/yhdistyslistaus/ainejarjestot, as
 *   updated on 5.11.2026. Its page is the one register where an association
 *   says its everyday name in its own words ("Nuoret Designerit ry eli
 *   NuDe"): those twelve are the `known` names. No other is written here
 *   from memory; one is added when its register or its own page is read.
 * - uniarts: TaiYo, https://taiyo.fi/ylioppilaskunta/sektorit-ja-jaostot/,
 *   the academies' sections and the subject associations.
 * - metropolia: METKA, https://metkaweb.fi/yhteiso/opiskelijayhdistykset/.
 * - laurea: Laureamko,
 *   https://laureamko.fi/opiskelijakunta/yhdistykset-laureassa/.
 * - hanken, haaga_helia, arcada, diak, humak: the union publishes no list of
 *   subject associations (shs.fi, helga.fi, asken.fi, odiako.fi,
 *   humako.net), so the union stands as the school's one guild.
 * Left out on the maintainer's word: the doctoral researchers' associations
 * (Aallonhuiput at Aalto, UADoRe at Uniarts), and Queerpolia at Metropolia,
 * since no answer here may say what article 9 protects.
 */

/** The schools, universities first; texts are profile.option.university.<school>. */
export const UNIVERSITIES = [
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
] as const;
export type University = (typeof UNIVERSITIES)[number];

/**
 * The University of Helsinki's faculties and its Swedish School of Social
 * Science, as HYY's register orders its associations; texts are
 * profile.guildGroup.<group>. The other schools' lists are short enough to
 * stand without groups.
 */
export const GUILD_GROUP_KEYS = [
  "theology",
  "law",
  "medicine",
  "arts",
  "science",
  "pharmacy",
  "bio_env",
  "education",
  "social_sciences",
  "agriculture_forestry",
  "veterinary",
  "soc_kom",
] as const;
export type GuildGroup = (typeof GUILD_GROUP_KEYS)[number];

type Listed = {
  id: string;
  name: string;
  /** The name its members say, where the register itself gives one: "NuDe" (the maintainer, 15/11/2026). */
  known?: string;
  groups?: readonly GuildGroup[];
};

/**
 * Each school's guilds in its register's order, a name that lost its school's
 * where it now reads: Sähköinsinöörikilta among the S's, where it is looked
 * for. Mythos and Orbis stand under two faculties in their register.
 */
const GUILDS = {
  helsinki: [
    {
      id: "helsinki_teologian_ylioppilaiden_tiedekuntayhdistys",
      name: "Teologian Ylioppilaiden Tiedekuntayhdistys",
      groups: ["theology"],
    },
    { id: "helsinki_mythos", name: "Mythos ry", groups: ["theology", "arts"] },
    { id: "helsinki_orbis", name: "Orbis ry", groups: ["theology", "arts"] },
    { id: "helsinki_juristklubben_codex", name: "Juristklubben Codex rf", groups: ["law"] },
    { id: "helsinki_justus", name: "Justus ry/r.f.", groups: ["law"] },
    { id: "helsinki_pykala", name: "Pykälä ry", groups: ["law"] },
    { id: "helsinki_foni", name: "Foni ry", groups: ["medicine"] },
    { id: "helsinki_ganglion", name: "GangLion", groups: ["medicine"] },
    {
      id: "helsinki_hammaslaaketieteen_kandidaattiseura",
      name: "Hammaslääketieteen-kandidaattiseura",
      groups: ["medicine"],
    },
    { id: "helsinki_impactus", name: "Impactus ry", groups: ["medicine"] },
    { id: "helsinki_kompleksi", name: "Kompleksi ry", groups: ["medicine"] },
    {
      id: "helsinki_laaketieteen_kandidaattiseura",
      name: "Lääketieteen-kandidaattiseura ry",
      groups: ["medicine"],
    },
    {
      id: "helsinki_medicinarklubben_thorax",
      name: "Medicinarklubben Thorax rf",
      groups: ["medicine"],
    },
    { id: "helsinki_remedium_progressis", name: "Remedium Progressis ry", groups: ["medicine"] },
    { id: "helsinki_synergia", name: "Synergia ry", groups: ["medicine"] },
    { id: "helsinki_humanisticum", name: "Humanisticum ry", groups: ["arts"] },
    { id: "helsinki_aistimus", name: "Aistimus ry", groups: ["arts"] },
    { id: "helsinki_aksentti", name: "Aksentti ry", groups: ["arts"] },
    { id: "helsinki_aspekti", name: "Aspekti ry", groups: ["arts"] },
    { id: "helsinki_bouffe", name: "Bouffe ry", groups: ["arts"] },
    { id: "helsinki_dilemma", name: "Dilemma ry", groups: ["arts"] },
    { id: "helsinki_eidos", name: "Eidos ry", groups: ["arts"] },
    { id: "helsinki_fibula", name: "Fibula ry", groups: ["arts"] },
    { id: "helsinki_historicus", name: "Historicus r.f.", groups: ["arts"] },
    { id: "helsinki_karavaani", name: "Karavaani ry", groups: ["arts"] },
    { id: "helsinki_katharsis", name: "Katharsis ry", groups: ["arts"] },
    { id: "helsinki_konteksti", name: "Konteksti ry", groups: ["arts"] },
    { id: "helsinki_kouki", name: "KouKi ry", groups: ["arts"] },
    { id: "helsinki_kronos", name: "Kronos ry", groups: ["arts"] },
    { id: "helsinki_leffaryhma", name: "Leffaryhmä", groups: ["arts"] },
    { id: "helsinki_lycksalighetens_o", name: "Lycksalighetens Ö r.f.", groups: ["arts"] },
    { id: "helsinki_lahi_idan_opiskelijat", name: "Lähi-idän opiskelijat ry", groups: ["arts"] },
    { id: "helsinki_mesta", name: "Mesta ry", groups: ["arts"] },
    { id: "helsinki_nefa_helsinki", name: "NEFA-Helsinki ry", groups: ["arts"] },
    { id: "helsinki_origo_hy", name: "Origo HY", groups: ["arts"] },
    { id: "helsinki_putkinotko", name: "Putkinotko ry", groups: ["arts"] },
    { id: "helsinki_repliikki", name: "Repliikki ry", groups: ["arts"] },
    { id: "helsinki_rupla", name: "Rupla ry.", groups: ["arts"] },
    { id: "helsinki_saga", name: "Saga ry", groups: ["arts"] },
    { id: "helsinki_sasha", name: "Sasha ry", groups: ["arts"] },
    { id: "helsinki_setenta", name: "Setenta ry", groups: ["arts"] },
    { id: "helsinki_siula", name: "Siula ry", groups: ["arts"] },
    { id: "helsinki_sub", name: "Sub ry", groups: ["arts"] },
    { id: "helsinki_symposion", name: "Symposion ry", groups: ["arts"] },
    { id: "helsinki_synkooppi", name: "Synkooppi ry", groups: ["arts"] },
    { id: "helsinki_umlaut", name: "Umlaut ry", groups: ["arts"] },
    { id: "helsinki_vastakarva", name: "Vastakarva", groups: ["arts"] },
    { id: "helsinki_matlu", name: "Matlu ry", groups: ["science"] },
    {
      id: "helsinki_helsingin_yliopiston_kemistit",
      name: "Helsingin yliopiston kemistit ry",
      groups: ["science"],
    },
    { id: "helsinki_integralis", name: "Integralis ry", groups: ["science"] },
    { id: "helsinki_limes", name: "Limes ry", groups: ["science"] },
    {
      id: "helsinki_maantieteen_opiskelijat",
      name: "Maantieteen opiskelijat ry",
      groups: ["science"],
    },
    { id: "helsinki_matrix", name: "Matrix ry", groups: ["science"] },
    { id: "helsinki_meridiaani", name: "Meridiaani", groups: ["science"] },
    { id: "helsinki_moodi", name: "Moodi ry", groups: ["science"] },
    { id: "helsinki_resonanssi", name: "Resonanssi ry", groups: ["science"] },
    { id: "helsinki_spektrum", name: "Spektrum rf", groups: ["science"] },
    { id: "helsinki_synop", name: "Synop ry", groups: ["science"] },
    { id: "helsinki_tko_aly", name: "TKO-äly ry", groups: ["science"] },
    { id: "helsinki_vasara", name: "Vasara ry", groups: ["science"] },
    {
      id: "helsinki_yliopiston_farmasiakunta",
      name: "Yliopiston farmasiakunta",
      groups: ["pharmacy"],
    },
    { id: "helsinki_biosfaari", name: "Biosfääri ry", groups: ["bio_env"] },
    { id: "helsinki_helix", name: "Helix ry", groups: ["bio_env"] },
    { id: "helsinki_myy", name: "MYY ry", groups: ["bio_env"] },
    {
      id: "helsinki_svenska_naturvetarklubben",
      name: "Svenska Naturvetarklubben r.f.",
      groups: ["bio_env"],
    },
    { id: "helsinki_symbioosi", name: "Symbioosi ry", groups: ["bio_env"] },
    { id: "helsinki_condus", name: "Condus ry", groups: ["education"] },
    {
      id: "helsinki_aikuiskasvatuksen_kilta",
      name: "Aikuiskasvatuksen Kilta ry",
      groups: ["education"],
    },
    { id: "helsinki_didacta", name: "Didacta r.f.", groups: ["education"] },
    { id: "helsinki_ebe", name: "Ebe ry", groups: ["education"] },
    { id: "helsinki_erikeepperi", name: "Erikeepperi ry", groups: ["education"] },
    {
      id: "helsinki_finlands_svenska_lararstuderande_forening",
      name: "Finlands svenska lärarstuderande förening sektionen vid Helsingfors universitet",
      groups: ["education"],
    },
    {
      id: "helsinki_helsingin_aineenopettajiksi_opiskelevat",
      name: "Helsingin aineenopettajiksi opiskelevat ry",
      groups: ["education"],
    },
    { id: "helsinki_kopeda", name: "Kopeda", groups: ["education"] },
    { id: "helsinki_kasitys", name: "Käsitys ry", groups: ["education"] },
    { id: "helsinki_one_step_ahead", name: "One Step Ahead", groups: ["education"] },
    { id: "helsinki_peduca", name: "Peduca ry", groups: ["education"] },
    { id: "helsinki_phenomena", name: "Phenomena ry", groups: ["education"] },
    { id: "helsinki_kannunvalajat", name: "Kannunvalajat ry", groups: ["social_sciences"] },
    { id: "helsinki_cissi", name: "CISSI", groups: ["social_sciences"] },
    { id: "helsinki_desistanssi", name: "Desistanssi ry", groups: ["social_sciences"] },
    {
      id: "helsinki_ktto",
      name: "KTTO - Kansantaloustieteen opiskelijat ry",
      groups: ["social_sciences"],
    },
    { id: "helsinki_keho", name: "Keho ry", groups: ["social_sciences"] },
    { id: "helsinki_konstruktio", name: "Konstruktio ry", groups: ["social_sciences"] },
    { id: "helsinki_kontakti", name: "Kontakti ry", groups: ["social_sciences"] },
    { id: "helsinki_kumous", name: "Kumous ry", groups: ["social_sciences"] },
    { id: "helsinki_media", name: "Media ry", groups: ["social_sciences"] },
    {
      id: "helsinki_polho",
      name: "Poliittisen historian opiskelijat Polho ry",
      groups: ["social_sciences"],
    },
    { id: "helsinki_status", name: "Status ry", groups: ["social_sciences"] },
    { id: "helsinki_stigma", name: "Stigma ry", groups: ["social_sciences"] },
    { id: "helsinki_stydi", name: "Stydi ry", groups: ["social_sciences"] },
    { id: "helsinki_taso", name: "Taso ry", groups: ["social_sciences"] },
    { id: "helsinki_valta", name: "Valta ry", groups: ["social_sciences"] },
    { id: "helsinki_voo", name: "VOO - Valtio-opin opiskelijat ry", groups: ["social_sciences"] },
    { id: "helsinki_vaki", name: "Väki ry", groups: ["social_sciences"] },
    {
      id: "helsinki_mmyl",
      name: "Maatalous-metsäylioppilaiden liitto MMYL ry",
      groups: ["agriculture_forestry"],
    },
    { id: "helsinki_agro_forst", name: "Agro-Forst", groups: ["agriculture_forestry"] },
    {
      id: "helsinki_akateeminen_karjakerho",
      name: "Akateeminen karjakerho",
      groups: ["agriculture_forestry"],
    },
    {
      id: "helsinki_akateemiset_kasvintuottajat",
      name: "Akateemiset Kasvintuottajat",
      groups: ["agriculture_forestry"],
    },
    { id: "helsinki_lipidi", name: "Lipidi ry", groups: ["agriculture_forestry"] },
    {
      id: "helsinki_markkina_agraarit",
      name: "Markkina-Agraarit",
      groups: ["agriculture_forestry"],
    },
    {
      id: "helsinki_metsaylioppilaat",
      name: "Metsäylioppilaat ry",
      groups: ["agriculture_forestry"],
    },
    { id: "helsinki_sampsa", name: "Sampsa ry", groups: ["agriculture_forestry"] },
    {
      id: "helsinki_tekniikka_agraarit",
      name: "Tekniikka-Agraarit",
      groups: ["agriculture_forestry"],
    },
    { id: "helsinki_veke", name: "Veke ry", groups: ["agriculture_forestry"] },
    {
      id: "helsinki_viikin_taloustieteilijat",
      name: "Viikin taloustieteilijät ry",
      groups: ["agriculture_forestry"],
    },
    { id: "helsinki_viri_lactis", name: "Viri Lactis", groups: ["agriculture_forestry"] },
    { id: "helsinki_vuorovaikeutus", name: "Vuorovaikeutus ry", groups: ["agriculture_forestry"] },
    {
      id: "helsinki_elainlaaketieteen_kandidaattiyhdistys",
      name: "Eläinlääketieteen kandidaattiyhdistys ry",
      groups: ["veterinary"],
    },
    { id: "helsinki_studorg", name: "StudOrg", groups: ["soc_kom"] },
    { id: "helsinki_habitus", name: "Habitus r.f.", groups: ["soc_kom"] },
    {
      id: "helsinki_journalistforeningen",
      name: "Journalistföreningen vid Soc&kom",
      groups: ["soc_kom"],
    },
    { id: "helsinki_konsensus", name: "Konsensus r.f.", groups: ["soc_kom"] },
    { id: "helsinki_octavia", name: "Octavia rf", groups: ["soc_kom"] },
    { id: "helsinki_statsvett", name: "Statsvett", groups: ["soc_kom"] },
  ],
  aalto: [
    { id: "aalto_accounting", name: "Aalto Accounting" },
    { id: "aalto_business_law", name: "Aalto Business Law" },
    { id: "aalto_business_technology", name: "Aalto Business Technology ry" },
    { id: "aalto_economics", name: "Aalto Economics" },
    { id: "aalto_finance", name: "Aalto Finance" },
    { id: "aalto_management", name: "Aalto Management" },
    { id: "aalto_marketing_society", name: "Aalto Marketing Society", known: "AMS" },
    // The register's: Aalto-yliopiston Arkkitehtikilta ry.
    { id: "aalto_arkkitehtikilta", name: "Arkkitehtikilta ry", known: "AK" },
    { id: "aalto_ky", name: "KY - Aalto-yliopiston kauppatieteiden ylioppilaat" },
    {
      id: "aalto_automaatio_ja_systeemitekniikan_kilta",
      name: "Automaatio- ja systeemitekniikan kilta ry",
      known: "AS",
    },
    { id: "aalto_inkubio", name: "Bioinformaatioteknologian kilta – Inkubio ry" },
    { id: "aalto_cems_club_helsinki", name: "CEMS Club Helsinki" },
    { id: "aalto_crust", name: "Crust ry" },
    { id: "aalto_dada", name: "DADA ry" },
    { id: "aalto_data_guild", name: "Data Guild ry" },
    { id: "aalto_klaffi", name: "Elokuvataiteen opiskelijat Klaffi ry" },
    { id: "aalto_fyysikkokilta", name: "Fyysikkokilta", known: "FK" },
    {
      id: "aalto_grrr",
      name: "GRRR ry – Visuaalisen viestinnän muotoilun opiskelijoiden ainejärjestö",
    },
    { id: "aalto_idbm_klubi", name: "IDBM Klubi" },
    { id: "aalto_athene", name: "Informaatioverkostojen kilta Athene ry" },
    { id: "aalto_kemistikilta", name: "Kemistikilta ry" },
    { id: "aalto_koneinsinoorikilta", name: "Koneinsinöörikilta ry", known: "KIK" },
    { id: "aalto_kooma", name: "Kooma ry" },
    { id: "aalto_maanmittarikilta", name: "Maanmittarikilta ry", known: "MK" },
    { id: "aalto_nuoret_designerit", name: "Nuoret Designerit Ry", known: "NuDe" },
    { id: "aalto_probba", name: "Probba ry" },
    { id: "aalto_prosessiteekkarit", name: "Prosessiteekkarit ry" },
    { id: "aalto_puunjalostajakilta", name: "Puunjalostajakilta ry", known: "PJK" },
    { id: "aalto_rakennusinsinoorikilta", name: "Rakennusinsinöörikilta ry", known: "IK" },
    // The register's: Aalto-yliopiston Sähköinsinöörikilta ry, which it lists among the A's.
    { id: "aalto_sahkoinsinoorikilta", name: "Sähköinsinöörikilta ry" },
    { id: "aalto_tokyo", name: "TOKYO" },
    { id: "aalto_teknologforeningen", name: "Teknologföreningen", known: "TF" },
    { id: "aalto_tietokilta", name: "Tietotekniikan kilta – Tietokilta ry", known: "TiK" },
    { id: "aalto_prodeko", name: "Tuotantotalouden kilta – Prodeko ry" },
    { id: "aalto_vuorimieskilta", name: "Vuorimieskilta ry", known: "VK" },
  ],
  hanken: [{ id: "hanken_shs", name: "Svenska Handelshögskolans Studentkår" }],
  uniarts: [
    { id: "uniarts_kuva_jaosto", name: "KuvA-jaosto" },
    { id: "uniarts_siba_jaosto", name: "SibA-jaosto – SibA United" },
    { id: "uniarts_teak_jaosto", name: "TeaK-jaosto" },
    { id: "uniarts_kamus", name: "Kamus" },
    { id: "uniarts_kimu", name: "Kimu ry" },
    { id: "uniarts_kukko", name: "Kukko ry" },
    { id: "uniarts_kumulaatio", name: "Kumulaatio ry" },
    { id: "uniarts_maine", name: "Maine ry" },
    { id: "uniarts_sakko", name: "Sakko ry" },
    { id: "uniarts_sima", name: "Sima ry" },
    { id: "uniarts_unisono", name: "Unisono ry" },
    { id: "uniarts_vasy", name: "VÄSy" },
  ],
  metropolia: [
    { id: "metropolia_aok", name: "AOK – Automaatio-opiskelijoiden kilta ry" },
    { id: "metropolia_demoni", name: "Demoni ry – Metropolian kulttuurialan opiskelijayhdistys" },
    { id: "metropolia_esn", name: "ESN Metropolia - Erasmus Student Network Metropolia" },
    { id: "metropolia_gooni", name: "Gooni ry - Metropolian maanmittarit" },
    { id: "metropolia_hto", name: "Helsingin Tekniikan Opiskelijat – HTO ry" },
    { id: "metropolia_kama", name: "KaMA – Karamalmin aineopiskelijat ry" },
    { id: "metropolia_me_bien", name: "Me BiEn ry" },
    { id: "metropolia_myro", name: "MYRO ry – Myllypuron rakennusalan opiskelijat" },
    {
      id: "metropolia_mystery",
      name: "MysteRy – Myllypuron sosiaali- ja terveysalojen opiskelijat ry",
    },
    {
      id: "metropolia_peritia_vestio",
      name: "Peritia Vestio ry – Metropolia Ammattikorkeakoulun vaatetusalan opiskelijayhdistys",
    },
    { id: "metropolia_rak", name: "RAK – Rakennusarkkitehtikilta ry" },
    { id: "metropolia_talo", name: "Talo ry" },
    {
      id: "metropolia_trombi",
      name: "Trombi ry – Tradenomiopiskelijat Metropolian Bisnes Intellektuaalit",
    },
    {
      id: "metropolia_txo",
      name: "TXO ry – Metropolia Ammattikorkeakoulu Terveys- ja hoitoalan opiskelijat",
    },
    { id: "metropolia_uio", name: "Uudenmaan Insinööriopiskelijat UIO ry" },
  ],
  haaga_helia: [{ id: "haaga_helia_helga", name: "Haaga-Helian opiskelijakunta Helga" }],
  laurea: [
    // The register's four each begin "Laurean": "Laurean restonomiopiskelijayhdistys LARE ry".
    { id: "laurea_lare", name: "Restonomiopiskelijayhdistys LARE ry" },
    { id: "laurea_lato", name: "Tradenomiopiskelijat LATO ry" },
    { id: "laurea_laso", name: "Sosiaalialojen Opiskelijat LASO ry" },
    { id: "laurea_jenkins", name: "Tietojenkäsittelyopiskelijat Jenkins ry" },
  ],
  arcada: [{ id: "arcada_ask", name: "Arcada studerandekår – ASK" }],
  diak: [{ id: "diak_odiako", name: "Diakonia-ammattikorkeakoulun opiskelijakunta O'Diako" }],
  humak: [
    { id: "humak_humako", name: "HUMAKO - Humanistisen ammattikorkeakoulun opiskelijakunta" },
  ],
} as const satisfies Record<University, readonly Listed[]>;

type GuildId = (typeof GUILDS)[University][number]["id"];
type OtherGuild = `${University}_other`;
export type GuildOption = GuildId | OtherGuild;
/** A guild of a register: its id, its own name, the name its members say and its faculties where the register has them. */
export type Guild = Omit<Listed, "id"> & { id: GuildId };

/** A school's guilds, in its register's order. */
export const guildsOf = (university: University): readonly Guild[] => GUILDS[university];

/**
 * "Another guild": one per school, for a guild its register lacks (the
 * maintainer, 15/11/2026). It says that there is one and never which.
 */
export const otherGuildOf = (university: University): OtherGuild => `${university}_other`;

const optionsOf = (university: University): GuildOption[] => [
  ...guildsOf(university).map((guild) => guild.id),
  otherGuildOf(university),
];

/** The guild field's options: school by school, its guilds and then its "another guild". */
export const GUILD_OPTIONS = UNIVERSITIES.flatMap(optionsOf) as [GuildOption, ...GuildOption[]];

const UNIVERSITY_OF = new Map<GuildOption, University>(
  UNIVERSITIES.flatMap((university) =>
    optionsOf(university).map((option) => [option, university] as const),
  ),
);
// One way of writing a guild wherever it is named, so the picker's search finds it by either name.
const NAME_OF = new Map<GuildOption, string>(
  UNIVERSITIES.flatMap((university) =>
    guildsOf(university).map(
      (guild) => [guild.id, guild.known ? `${guild.name} (${guild.known})` : guild.name] as const,
    ),
  ),
);

/** The school a guild belongs to. */
export const universityOfGuild = (option: GuildOption): University =>
  UNIVERSITY_OF.get(option) as University;

/**
 * A listed guild in words: its own name, and after it in brackets the name
 * its members say, where it has one; null for "another guild", whose words
 * are the app's (profile.guild.other).
 */
export const guildName = (option: GuildOption): string | null => NAME_OF.get(option) ?? null;
