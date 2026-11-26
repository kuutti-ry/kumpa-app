import type { Gender, ProfileFields, PromptAnswer } from "@kuutti/schema";
import { POSTAL_CODE_LENGTH } from "@kuutti/schema/postal-areas";
import type { Queryable } from "../pool.ts";
import type { PersonaConversation } from "./conversations.ts";
import { assetsFor, type PhotoAsset } from "./photos.ts";
import {
  DEMO_EPOCH,
  DEMO_LABEL_PREFIX,
  POPULATION_CONSENTS,
  type SyntheticPerson,
} from "./population.ts";
import type { LaterList, WaitingLikes } from "./queue.ts";
import { DEMO_SUBJECT_PREFIX } from "./write-population.ts";

/**
 * The cast (#560): forty-eight invented people nobody signs in as, so that the
 * accounts a staging phone can sign in as have somebody to go through. They have
 * no code and no test bank, so they are synthetic people of the population
 * (ADR-014 §9), written with it and removed with it, and each has a set of faces
 * of their own in the release (`cast:<key>`, docs/demo/photo-prompts.md).
 *
 * A card never shows whom its person seeks or their age window, so these are wide:
 * one man fits Sanna, Kerttu, Noa and Ilona alike, and the younger half is Aino's
 * and Onni's. What sets the number is Sanna, who seeks only men. Nobody here fits
 * Iida's window, so the queue's flow keeps its exact queue. A test holds all of it
 * against the product's own filters (apps/api/scripts/demo/demo-cast.test.ts).
 */
type CastAnswers = {
  seeks: readonly Gender[];
  ageWindow: { min: number; max: number };
  intent: NonNullable<ProfileFields["intent"]>;
};

const EVERYBODY: readonly Gender[] = ["woman", "man", "non_binary"];
/** Sanna, Kerttu and Noa, whatever each of them has answered, and Ilona, for those of her age window. */
const MEN_FOR_MEMBERS: CastAnswers = {
  seeks: ["woman", "non_binary"],
  ageWindow: { min: 30, max: 62 },
  intent: "long_term",
};
/** Kerttu, Noa and, since they seek men too, Tapio; too old for Iida's window and too narrow for her age. */
const WOMEN_FOR_MEMBERS: CastAnswers = {
  seeks: EVERYBODY,
  ageWindow: { min: 40, max: 60 },
  intent: "long_term",
};
const NON_BINARY_PEOPLE: CastAnswers = {
  seeks: EVERYBODY,
  ageWindow: { min: 25, max: 55 },
  intent: "open_to_either",
};
/** Aino and Onni, whose own windows hold them (histories.ts), and a newcomer, whichever of the answers they give. */
const YOUNGER_PEOPLE: CastAnswers = {
  seeks: EVERYBODY,
  ageWindow: { min: 21, max: 45 },
  intent: "open_to_either",
};

/**
 * The rest of a person's answers, so that a card reads whole (#760's one scroll)
 * on a staging phone. Politics and religion are left out: they need the
 * special-category consent, which nobody here has given (ADR-019 §4).
 */
type CastAbout = Omit<
  ProfileFields,
  "intent" | "hobbies" | "pets" | "occupationTitle" | "hideFromField" | "politics" | "religion"
>;

export type CastPerson = {
  /** The folder of the faces (`faces/cast/<key>/`) and the end of the label. Never renamed and never reused. */
  key: string;
  name: string;
  born: { year: number; month: number };
  gender: Gender;
  answers: CastAnswers;
  /** The postal code as a person would type it: what is kept of it is the API's to say. */
  home: string;
  /** The card shows the area's name, where the area is kept. */
  showsArea?: true;
  locale: "fi" | "sv" | "en";
  title: string;
  hobbies: NonNullable<ProfileFields["hobbies"]>;
  pets: NonNullable<ProfileFields["pets"]>;
  bio: string;
  /** Three, as many as a profile holds: the card puts each after a photo. */
  prompts: readonly PromptAnswer[];
  about: CastAbout;
};

export const CAST: readonly CastPerson[] = [
  // Men for the members.
  {
    key: "jere",
    name: "Jere",
    born: { year: 1982, month: 1 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "02600",
    showsArea: true,
    locale: "en",
    title: "Wedding DJ",
    hobbies: ["making_music", "concerts", "karaoke", "board_games", "cycling"],
    pets: ["cat"],
    bio: "I play weddings on Saturdays and teach physics on weekdays. Both crowds ignore me until the end, and then they want one more. In between I fix old synthesisers, burn toast and lose arguments to my cat, who has strong views about bass. I am at my best on a long walk with nowhere to be, and I will happily explain why the sky is blue while you pretend not to know.",
    prompts: [
      {
        key: "first_date",
        answer:
          "A small gig in a basement bar, then chips on the walk home. If the band is bad, we rate them out of ten.",
      },
      {
        key: "argue_about",
        answer:
          "Whether a wedding needs the chicken dance. It does not. I play it anyway, because somebody's aunt always asks.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can tell what key the fridge is humming in, and I will tell you, whether you asked or not.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 183,
      exercise: "sometimes",
      field: ["education", "science"],
      occupation: ["education", "arts_culture"],
    },
  },
  {
    key: "pekka",
    name: "Pekka",
    born: { year: 1974, month: 8 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "33500",
    locale: "fi",
    title: "Bussinkuljettaja",
    hobbies: ["fishing", "sauna", "cottage", "forest_walks", "cooking"],
    pets: ["none"],
    bio: "Ajan bussia Tampereella ja talvella istun jäällä. Suurin saaliini on ollut pieni, mutta tarinani siitä kasvaa vuosi vuodelta. Kesät menevät mökillä Näsijärven rannalla, jossa sauna lämpiää puilla ja kahvi keitetään pannussa. Etsin jotakuta, joka istuu kanssani laiturilla eikä kysy, montako kalaa tänään tuli.",
    prompts: [
      {
        key: "sunday",
        answer:
          "Soutelen mökkirannassa ennen kuin muut heräävät. Iltapäivällä päiväunet laiturilla, illalla sauna ja grillimakkara.",
      },
      {
        key: "proud_of",
        answer:
          "Ajoin kerran koko talven ilman ainuttakaan myöhästymistä. Kukaan ei huomannut, mutta minä tiedän.",
      },
      { key: "ask_me", answer: "Siitä hauesta. Varaudu siihen, että se on kasvanut taas vähän." },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 179,
      exercise: "sometimes",
      field: ["service"],
      occupation: ["transport"],
    },
  },
  {
    key: "markku",
    name: "Markku",
    born: { year: 1977, month: 4 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "04200",
    locale: "en",
    title: "Accountant",
    hobbies: ["horses", "running", "puzzles", "cinema", "forest_walks"],
    pets: ["none"],
    bio: "Accountant by trade. I took up hobbyhorsing as a joke and then won a rosette, so now it is serious. My spreadsheets are very tidy. My hobbyhorse is called Kaarlo and lives in the hall cupboard. On Sundays I run along the river, badly but every week, and in the evenings I do the crossword in pen, which my friends call showing off. I am looking for someone who laughs at me kindly and then joins in.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "Second place in the national hobbyhorse championships, senior class. The judges said my canter was very convincing.",
      },
      {
        key: "overrated",
        answer: "Spontaneity. A good plan leaves room for surprises, and I always leave room.",
      },
      {
        key: "teach_me",
        answer: "Teach me to cook something that does not come with instructions on the back.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 176,
      exercise: "weekly",
      field: ["business"],
      occupation: ["law_finance"],
      zodiac: "virgo",
    },
  },
  {
    key: "risto",
    name: "Risto",
    born: { year: 1979, month: 11 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "02180",
    locale: "en",
    title: "Piano tuner",
    hobbies: ["dogs", "concerts", "slow_mornings", "reading", "forest_walks"],
    pets: ["dog"],
    bio: "I tune pianos and walk a greyhound who has better posture than I do. She is called Vilma, sleeps twenty hours a day and runs like the wind for the other four. My work takes me into strangers' living rooms all over Espoo, so I have opinions about wallpaper that I keep to myself. Looking for someone who likes slow mornings and the odd concert.",
    prompts: [
      {
        key: "three_things",
        answer:
          "Black coffee, a well-tempered tuning fork and Vilma's head on my knee when the radio plays Sibelius.",
      },
      {
        key: "never_again",
        answer:
          "Tuning a piano at a student party. Somebody kept playing the same three notes and asking if it was done yet.",
      },
      {
        key: "first_date",
        answer:
          "A lunchtime concert in a church, then a long coffee somewhere with a piano nobody is allowed to touch.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 186,
      exercise: "sometimes",
      field: ["arts", "trades"],
      occupation: ["arts_culture", "entrepreneur"],
      zodiac: "pisces",
    },
  },
  {
    key: "antero",
    name: "Antero",
    born: { year: 1976, month: 7 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "08100",
    locale: "en",
    title: "Beekeeper",
    hobbies: ["gardening", "baking", "cottage", "forest_walks", "cooking"],
    pets: ["other"],
    bio: "Beekeeper with sticky hands and an orchard that gets out of control every June. I will bring honey whether you like it or not. I keep forty hives by the lake in Lohja and know most of the queens by temperament. In winter, when the bees are asleep, I bake rye bread, mend frames and read about plums. I would like somebody to share the quiet with, and the apples, of which there are always too many.",
    prompts: [
      {
        key: "teach_me",
        answer:
          "Teach me your grandmother's recipe for anything. I will pay in honey, and I have a lot of it.",
      },
      {
        key: "proud_of",
        answer:
          "My bees have never stung a visitor. Me, they sting every week, but I think that is personal.",
      },
      {
        key: "sunday",
        answer:
          "Early to the hives while the dew is still on the grass, then pancakes with too much honey, and a nap in the hammock.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 180,
      exercise: "weekly",
      field: ["other"],
      occupation: ["agriculture", "entrepreneur"],
    },
  },
  {
    key: "mika",
    name: "Mika",
    born: { year: 1980, month: 3 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "01600",
    locale: "en",
    title: "Firefighter",
    hobbies: ["floorball", "cooking", "gym", "sauna", "cinema"],
    pets: ["cat"],
    bio: "Firefighter. I mostly cook soup for hungry colleagues and get cats out of trees. The cats are never grateful, and I have made my peace with that. My own cat, Rouva, came from one of those trees and has run the house ever since. Off shift I play floorball with men who should know better, lift heavy things at the gym and try new soups on my neighbours. I am calm in a crisis and useless at choosing a film.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "I can carry a sofa up four flights of stairs and still tell you what is in the soup.",
      },
      {
        key: "argue_about",
        answer: "Whether salmon soup needs cream. It does, and I have a station full of witnesses.",
      },
      {
        key: "last_laugh",
        answer:
          "A grown man phoning us because a seagull had taken his car keys. We got them back. The seagull was not sorry either.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 188,
      exercise: "daily",
      field: ["service"],
      occupation: ["public_sector"],
      zodiac: "taurus",
    },
  },
  {
    key: "olavi",
    name: "Olavi",
    born: { year: 1973, month: 10 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "96100",
    locale: "fi",
    title: "Huskytarhan pitäjä",
    hobbies: ["skiing", "dogs", "winter_swimming", "sauna", "hiking"],
    pets: ["dog"],
    bio: "Pidän huskytarhaa Rovaniemellä. Koirat kuuntelevat minua paremmin kuin kukaan ihminen, ja aamut alkavat aikaisin. Talvisin ajan turisteja tunturiin ja kerron revontulista tarinoita, joista osa on totta. Kesällä koirat lepäävät, minä kunnostan valjaita ja uin joessa niin kauan kuin vesi on sulaa, joskus vähän pidempäänkin. Etsin jotakuta, joka ei pelkää pakkasta eikä karvoja sohvalla.",
    prompts: [
      {
        key: "three_things",
        answer: "Kolmekymmentäkaksi huskya, villapaita ja termospullollinen mustaa kahvia.",
      },
      {
        key: "never_again",
        answer:
          "Lähde tunturiin ilman varahanskoja. Opin sen kantapään kautta, tai oikeastaan sormien.",
      },
      {
        key: "first_date",
        answer:
          "Revontuliretki koiravaljakolla, nuotiokahvit ja pullat. Jos taivas pysyy pilvessä, ainakin koirat ovat iloisia.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 177,
      exercise: "daily",
      field: ["service"],
      occupation: ["entrepreneur"],
    },
  },
  {
    key: "juha",
    name: "Juha",
    born: { year: 1985, month: 6 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "02150",
    showsArea: true,
    locale: "en",
    title: "Software developer",
    hobbies: ["baking", "cycling", "programming", "chess", "reading"],
    pets: ["none"],
    bio: "Software developer and failed baker. My sourdough could hold a door open, and I keep trying anyway. You are welcome to taste the next attempt. I cycle to work all year, mostly because the bike lane is the only place nobody asks me to fix their printer. Evenings go to an old radio I am rebuilding, a library book about Roman bread and a very slow game of chess by post with my uncle.",
    prompts: [
      {
        key: "unpopular_opinion",
        answer:
          "Bread from a shop is fine. I say this as a man who has spent four years and a small fortune on flour.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me any bird you like. I can tell a seagull from a crow, and that is where it ends.",
      },
      {
        key: "sunday",
        answer:
          "A long ride along the coast, a café with a proper cinnamon bun, and back home to see if the dough has risen. It has not.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 182,
      exercise: "weekly",
      field: ["tech"],
      occupation: ["tech"],
      university: ["aalto"],
      guild: ["aalto_tietokilta"],
      zodiac: "capricorn",
    },
  },
  {
    key: "karim",
    name: "Karim",
    born: { year: 1981, month: 2 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "01300",
    locale: "en",
    title: "Dentist",
    hobbies: ["karaoke", "travelling", "coffee", "cooking", "cinema"],
    pets: ["none"],
    bio: "Dentist who sings karaoke badly and with great feeling. I will not judge your flossing on a first date, but I will notice. I grew up between Vantaa and my grandmother's kitchen, and I still make her lentil soup on cold evenings. I travel whenever the clinic lets me, mostly to places with good coffee and bad maps. Looking for someone curious and kind, who sings along even when they do not know the words.",
    prompts: [
      {
        key: "argue_about",
        answer:
          "The best karaoke song of all time. It is a power ballad, it is long, and I know every word of it.",
      },
      {
        key: "overrated",
        answer:
          "Electric toothbrushes with apps. Two minutes, twice a day, and you do not need your phone to tell you.",
      },
      {
        key: "ask_me",
        answer: "The time I sang at a wedding in Marrakesh and the band refused to stop.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "ar", "fr"],
      education: "maisteri",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 175,
      exercise: "weekly",
      field: ["health"],
      occupation: ["healthcare"],
      university: ["helsinki"],
      guild: ["helsinki_hammaslaaketieteen_kandidaattiseura"],
      zodiac: "gemini",
    },
  },
  {
    key: "timo",
    name: "Timo",
    born: { year: 1978, month: 9 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "04400",
    locale: "en",
    title: "Motorcycle mechanic",
    hobbies: ["road_trips", "diy", "dogs", "coffee", "cottage"],
    pets: ["dog"],
    bio: "I fix old motorcycles and my dachshund supervises from the sidecar. Road trips, coffee from a thermos, and no hurry to get anywhere. The dachshund is Pertti, he is eleven and has been to Norway twice, which is more than most of my customers' bikes. My garage smells of oil and cardamom buns, because the bakery next door likes me. I am looking for a co-pilot who does not mind wind in the hair.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "A motorcycle from the fifties that came to me in three boxes. It runs now, and it sounds like a happy tractor.",
      },
      {
        key: "first_date",
        answer:
          "A slow ride to a lakeside café, if you are not afraid of the sidecar. Pertti will give up his seat, eventually.",
      },
      {
        key: "three_things",
        answer: "A good set of spanners, strong coffee and Pertti snoring in the sidecar.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "quitting",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 174,
      exercise: "sometimes",
      field: ["trades"],
      occupation: ["trades_construction", "entrepreneur"],
      zodiac: "sagittarius",
    },
  },
  {
    key: "harri",
    name: "Harri",
    born: { year: 1983, month: 5 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "80100",
    locale: "en",
    title: "Librarian",
    hobbies: ["crafts", "reading", "concerts", "dogs", "board_games"],
    pets: ["dog"],
    bio: "Librarian and heavy metal knitter, and yes, those go together. My pug has more jumpers than I do. Tell me what you are reading. At work I run a reading circle for retired gentlemen who argue about crime novels like football fans. At home it is records, a pot of tea and a sock that keeps turning into a scarf. In summer I go to every festival in Karelia, with earplugs and a cushion, because I am wise now.",
    prompts: [
      {
        key: "ask_me",
        answer: "Books. Tell me two you loved and one you hated, and I will find you the next one.",
      },
      {
        key: "last_laugh",
        answer:
          "A borrower returning a cookbook with a note inside that said: did not work, please check.",
      },
      {
        key: "argue_about",
        answer:
          "Whether a library should be quiet. It should not. Children laughing is the best noise a library makes.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "dont_mind",
      height: 181,
      exercise: "sometimes",
      field: ["arts"],
      occupation: ["public_sector", "arts_culture"],
      zodiac: "scorpio",
    },
  },
  {
    key: "esa",
    name: "Esa",
    born: { year: 1975, month: 1 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "70100",
    locale: "fi",
    title: "Postimies",
    hobbies: ["gardening", "cycling", "sauna", "cooking", "forest_walks"],
    pets: ["none"],
    bio: "Postimies Kuopiosta. Kesällä kasvatan kurpitsoja palstalla ja talvella pyöräilen lumisateessa. Kerron mielelläni kurpitsoista lisää. Viime syksynä suurin painoi enemmän kuin minä kuusivuotiaana, ja naapurit tulivat katsomaan sitä kuin uutta autoa. Saunon joka ilta, luen vain omat kirjeeni ja paistan lettuja sunnuntaisin. Etsin jotakuta, jonka kanssa jakaa sato ja hiljaiset illat Kallaveden rannalla.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "Olen jakanut postia lähes kolmekymmentä vuotta, eikä yksikään koira ole vielä purrut. Muutama on yrittänyt.",
      },
      {
        key: "sunday",
        answer:
          "Aamulla palstalle katsomaan kurpitsoja, päivällä letut ja illalla sauna. Ei kelloa koko päivänä.",
      },
      { key: "argue_about", answer: "Onko kurpitsa vihannes vai hedelmä. Minulle se on ystävä." },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 175,
      exercise: "daily",
      field: ["service"],
      occupation: ["transport"],
    },
  },
  {
    key: "dmitri",
    name: "Dmitri",
    born: { year: 1984, month: 8 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "00700",
    locale: "en",
    title: "Truck driver",
    hobbies: ["dance", "cooking", "chess", "podcasts", "road_trips"],
    pets: ["none"],
    bio: "I drive trucks all week and dance ballroom at the weekend, sometimes with a mop when nobody is free. I cook better than I park. My mother taught me pelmeni and my dance teacher taught me patience, and I use both every Sunday. On the road I listen to chess podcasts and lose imaginary games to myself. I am looking for a partner for the waltz, the kitchen or both, no experience needed.",
    prompts: [
      {
        key: "teach_me",
        answer:
          "Teach me a dance I do not know yet. I will teach you the quickstep, and nobody gets hurt. Probably.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can back a full trailer into a space you would not park a bicycle in. Parallel parking a car, less so.",
      },
      {
        key: "overrated",
        answer:
          "Fancy restaurants. Give me a good soup, fresh bread and somebody to argue with about chess.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "ru"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 185,
      exercise: "weekly",
      field: ["service"],
      occupation: ["transport"],
      zodiac: "leo",
    },
  },
  {
    key: "seppo",
    name: "Seppo",
    born: { year: 1976, month: 4 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "10600",
    locale: "sv",
    title: "Smed",
    hobbies: ["crafts", "sauna", "cooking", "sailing", "forest_walks"],
    pets: ["cat"],
    bio: "Jag är smed i Ekenäs, med stora händer och en liten grå kattunge. Bastu på lördagar, soppa på söndagar och inga onödiga ord. I smedjan gör jag grindar, ljusstakar och ibland en kniv till någon som verkligen behöver den. Kattungen heter Pia och sover i mitt läderförkläde medan jag arbetar. Jag söker någon som tycker om eld, havet och tystnad som inte är obekväm.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "Grindarna till kyrkogården här i stan. Jag smidde dem för tio år sedan och de gnisslar fortfarande inte.",
      },
      {
        key: "three_things",
        answer: "Elden i essjan, en bra kniv och Pia som spinner i förklädet.",
      },
      {
        key: "first_date",
        answer:
          "En promenad längs stranden i Ekenäs och sedan soppa hemma hos mig. Jag lagar, du väljer musiken.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["sv", "fi", "en"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 190,
      exercise: "sometimes",
      field: ["trades", "arts"],
      occupation: ["trades_construction", "entrepreneur"],
    },
  },
  {
    key: "anders",
    name: "Anders",
    born: { year: 1980, month: 11 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "02700",
    locale: "sv",
    title: "Maskinist",
    hobbies: ["sailing", "swimming", "dogs", "reading", "fishing"],
    pets: ["dog"],
    bio: "Maskinist på skärgårdsfärjan. Min newfoundlandshund tar hela båten och jag sitter där det finns plats. Jag kokar bra kaffe på vilken kobbe som helst. Hunden heter Björn, väger mer än jag och simmar bättre än de flesta. På vintern när färjan går i rännan läser jag deckare i maskinrummet och lagar min gamla träbåt. Jag söker någon som tycker om salt luft, långa kvällar och en hund som tror att han är en knähund.",
    prompts: [
      {
        key: "sunday",
        answer:
          "Ut med båten i gryningen, kaffe på en kobbe och Björn som simmar runt oss tills han är nöjd.",
      },
      {
        key: "hidden_talent",
        answer: "Jag kan höra på motorn vad som är fel innan den själv vet om det.",
      },
      {
        key: "never_again",
        answer: "Lova Björn en korvbit och sedan glömma den. Han glömmer aldrig.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      languages: ["sv", "fi", "en"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 187,
      exercise: "weekly",
      field: ["engineering", "trades"],
      occupation: ["transport"],
      zodiac: "cancer",
    },
  },
  {
    key: "tuomas",
    name: "Tuomas",
    born: { year: 1982, month: 7 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "99130",
    locale: "en",
    title: "Geography teacher",
    hobbies: ["astronomy", "skiing", "photography", "hiking", "sauna"],
    pets: ["none"],
    bio: "Geography teacher in Lapland. I will wake you at two in the morning if the aurora is out, and I am not sorry about it. My classroom has a window onto the fells, which is unfair to every other teacher in Finland. I ski to work when the snow allows, photograph the sky most clear nights and keep a list of every reindeer that has blocked my road. Looking for someone who likes the dark months as much as the light ones.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "A photograph of the aurora over Levi that a pupil now has as the background on every school computer.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me to cook something that is not reindeer stew. I have made it every way there is.",
      },
      {
        key: "argue_about",
        answer:
          "Whether a map should have north at the top. It does not have to, and I can prove it with a globe.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 184,
      exercise: "daily",
      field: ["education", "science"],
      occupation: ["education"],
      zodiac: "aquarius",
    },
  },
  {
    key: "minh",
    name: "Minh",
    born: { year: 1983, month: 3 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "00980",
    locale: "en",
    title: "Structural engineer",
    hobbies: ["foraging", "karaoke", "cooking", "hiking", "dinner_parties"],
    pets: ["other"],
    bio: "Structural engineer who picks mushrooms and sings karaoke. My parrot repeats everything I say on video calls, so please be kind to me in advance. His name is Tuan and his favourite word is my boss's name. On weekdays I make sure bridges stay up; in September I vanish into the forests east of Helsinki with a basket and a knife. I cook pho for anyone who stands still long enough.",
    prompts: [
      {
        key: "unpopular_opinion",
        answer:
          "Karaoke is better on a Tuesday. Nobody is drunk, the room is empty and you can finally try the long songs.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can find chanterelles where other people have just been. They walk past, I look down.",
      },
      {
        key: "first_date",
        answer:
          "Mushroom picking, then I cook what we found. If we find nothing, I cook anyway and nobody needs to know.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "vi"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 172,
      exercise: "weekly",
      field: ["engineering"],
      occupation: ["trades_construction"],
      university: ["aalto"],
      guild: ["aalto_rakennusinsinoorikilta"],
    },
  },
  {
    key: "petri",
    name: "Petri",
    born: { year: 1979, month: 10 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "90100",
    locale: "en",
    title: "Nurse",
    hobbies: ["cycling", "football", "slow_mornings", "podcasts", "cooking"],
    pets: ["other"],
    bio: "Nurse who cycles all year, whatever Oulu throws at me. At home a very large rabbit eats my newspaper. I am told this is not normal. His name is Herra Pupu and he weighs more than some dogs. I work nights on a surgical ward, so my mornings are slow by necessity and my evenings start late. I coach the under-tens at football on Saturdays, where I mostly tie shoelaces. I would love someone to share a long breakfast with.",
    prompts: [
      {
        key: "sunday",
        answer:
          "A breakfast that takes until lunch, the newspaper before the rabbit gets it, and a slow ride along the river.",
      },
      {
        key: "last_laugh",
        answer:
          "A small footballer scoring an own goal, then running to hug the other team's goalkeeper. Everybody won.",
      },
      {
        key: "ask_me",
        answer: "Cycling through an Oulu winter. I have studded tyres and a lot of opinions.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 178,
      exercise: "daily",
      field: ["health"],
      occupation: ["healthcare"],
      zodiac: "libra",
    },
  },
  {
    key: "janne",
    name: "Janne",
    born: { year: 1985, month: 6 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "00510",
    locale: "en",
    title: "Insurance adjuster",
    hobbies: ["concerts", "pub_quiz", "road_trips", "cooking", "cinema"],
    pets: ["none"],
    bio: "Insurance adjuster by day, air guitarist by night. I have seen every kind of flooded basement and I own a cape. Pub quiz partner wanted. Our team has come second at the local bar four weeks in a row, and I believe you are the missing piece. I go to gigs alone without shame, drive to Tampere for one band and back the same night, and make a very solid lasagne. Kind, a bit loud, punctual to a fault.",
    prompts: [
      {
        key: "argue_about",
        answer:
          "The best album of the nineties. I have a list, I have reasons, and I have brought the list.",
      },
      {
        key: "overrated",
        answer:
          "Being cool. I own a cape and I wear it to quizzes. Nobody has ever regretted sitting at my table.",
      },
      {
        key: "proud_of",
        answer:
          "Our quiz team's name. I cannot write it here, but it has made a quizmaster cry with laughter twice.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "dont_mind",
      height: 180,
      exercise: "sometimes",
      field: ["business"],
      occupation: ["law_finance"],
    },
  },
  {
    key: "ari",
    name: "Ari",
    born: { year: 1978, month: 2 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "48100",
    locale: "en",
    title: "Tugboat engineer",
    hobbies: ["electronics", "diy", "sailing", "museums", "fishing"],
    pets: ["cat"],
    bio: "Tugboat engineer from Kotka. I build model ships at home and my cat takes them apart again. A seagull once stole my lunch, and I still think about it. On the tug I keep the engines happy and the coffee strong; at home I solder radios and have a sailboat that is mostly a project. I love the harbour at dawn, maritime museums and long talks about nothing. I am patient, handy and good with knots.",
    prompts: [
      {
        key: "never_again",
        answer:
          "Eat a sandwich on the deck in Kotka harbour. The gulls have a system, and I am not part of it.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can tie a bowline with my eyes closed, which is useful at sea and impressive at parties for nearly a minute.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me to sail properly. I own a boat, I know every bolt in it, but the wind and I are still strangers.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 179,
      exercise: "sometimes",
      field: ["engineering"],
      occupation: ["transport"],
    },
  },
  {
    key: "lasse",
    name: "Lasse",
    born: { year: 1974, month: 9 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "87100",
    locale: "fi",
    title: "Metsänhoitaja",
    hobbies: ["hiking", "birdwatching", "foraging", "fishing", "sauna"],
    pets: ["dog"],
    bio: "Metsänhoitaja Kajaanista. Karjalankarhukoira kulkee mukana ja kahvi keitetään nuotiolla. Hirvi on yleensä huomannut minut ennen kuin minä sen. Työpäivät kuluvat leimikoilla ja taimikoissa, ja vapaa-ajalla kuljen samoja metsiä kiikari kaulassa. Koira on Mörkö, ja se vahtii kahvipannua tarkemmin kuin minä. Syksyllä poimin puolukat, keväällä kuuntelen kurkia. Etsin jotakuta, joka viihtyy metsässä myös sateella.",
    prompts: [
      {
        key: "three_things",
        answer: "Kiikari, nuotiokahvit ja Mörkö, joka kuulee teeren ennen minua.",
      },
      {
        key: "teach_me",
        answer:
          "Opeta minut leipomaan karjalanpiirakoita. Mummon ohje katosi, ja muistan vain, että rypytys oli vaikeaa.",
      },
      {
        key: "sunday",
        answer:
          "Aamuhämärissä suolle kuuntelemaan kurkia, sitten makkaraa nuotiolla ja päiväunet laavussa.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 183,
      exercise: "daily",
      field: ["science"],
      occupation: ["agriculture"],
    },
  },
  {
    key: "kalle",
    name: "Kalle",
    born: { year: 1986, month: 5 },
    gender: "man",
    answers: MEN_FOR_MEMBERS,
    home: "02770",
    locale: "en",
    title: "Carpenter",
    hobbies: ["diy", "winter_swimming", "dogs", "sauna", "hiking"],
    pets: ["dog"],
    bio: "Carpenter. I built my dog a better house than my own, and we have both been stuck in it. Winter swimming keeps me humble. The dog is a husky mix called Kaapo who thinks every lake is his. Most days I build kitchens for other people, and on weekends I am slowly turning an old farmhouse in Kirkkonummi into somewhere a person could live. I am handy, a bit stubborn and good at long silences in the sauna.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "A sauna I built from logs I felled myself. It took three summers, and it is the best place I know.",
      },
      {
        key: "first_date",
        answer:
          "An ice swim and a sauna, then soup. If that is too much, a walk by the shore. I am easy to please.",
      },
      {
        key: "unpopular_opinion",
        answer:
          "Flat-pack furniture has its place. That place is my workshop, where I fix it for people.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["snus"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 190,
      exercise: "weekly",
      field: ["trades"],
      occupation: ["trades_construction"],
      zodiac: "taurus",
    },
  },
  // Women for the members.
  {
    key: "tiina",
    name: "Tiina",
    born: { year: 1976, month: 1 },
    gender: "woman",
    answers: WOMEN_FOR_MEMBERS,
    home: "00100",
    locale: "en",
    title: "School principal",
    hobbies: ["dance", "theatre", "travelling", "reading", "cooking"],
    pets: ["other"],
    bio: "School principal on weekdays, roller derby on Tuesdays. I am looking for somebody who laughs loudly and does not mind a goat eating their scarf. The goat is Matilda and lives at my sister's farm, where I spend most summers. I have two grown sons who think my derby name is embarrassing, which is the point. I love the theatre, overnight trains and dancing in the kitchen while dinner burns.",
    prompts: [
      {
        key: "last_laugh",
        answer:
          "A pupil telling me, very seriously, that his homework had been eaten by a goat. I believed him. I know goats.",
      },
      {
        key: "argue_about",
        answer:
          "Whether adults should play. They should, preferably on roller skates and wearing a helmet.",
      },
      {
        key: "first_date",
        answer:
          "A play neither of us has heard of, and then a long dinner arguing about what it meant.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 168,
      exercise: "weekly",
      field: ["education"],
      occupation: ["education", "public_sector"],
      university: ["helsinki"],
      zodiac: "aries",
    },
  },
  {
    key: "paivi",
    name: "Päivi",
    born: { year: 1979, month: 8 },
    gender: "woman",
    answers: WOMEN_FOR_MEMBERS,
    home: "60100",
    locale: "fi",
    title: "Eläinlääkäri",
    hobbies: ["horses", "cats", "dance", "concerts", "forest_walks"],
    pets: ["cat"],
    bio: "Eläinlääkäri maatiloilla. Lehmät nuolevat tukkani pystyyn ja kotona hoidan kissanpentuja. Tanssin tangoa, myös ilman paria. Seinäjoen tangomarkkinoilla olen joka kesä eturivissä ja laulan mukana liian kovaa. Päivät ajan tilalta toiselle ja syön eväät autossa, illat kuluvat tallilla oman ruunani kanssa. Etsin jotakuta, joka osaa viedä tangossa tai ainakin yrittää, ja joka ei säikähdä, jos puhelin soi kesken illallisen.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "Tunnistan lehmän nimeltä jo kaukaa. Ihmisten nimet unohtuvat, lehmien eivät koskaan.",
      },
      {
        key: "sunday",
        answer:
          "Aamulla tallille, iltapäivällä tanssikurssille ja illalla sohvalle kolmen kissanpennun alle.",
      },
      {
        key: "teach_me",
        answer:
          "Opeta minut kokkaamaan jotain muuta kuin makaronilaatikkoa. Teen sitä hyvin, mutta joka viikko.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 165,
      exercise: "daily",
      field: ["health", "science"],
      occupation: ["healthcare"],
    },
  },
  {
    key: "sari",
    name: "Sari",
    born: { year: 1974, month: 4 },
    gender: "woman",
    answers: WOMEN_FOR_MEMBERS,
    home: "11100",
    locale: "fi",
    title: "Rekkakuski",
    hobbies: ["road_trips", "sauna", "dogs", "travelling", "karaoke"],
    pets: ["dog"],
    bio: "Ajan rekkaa pitkin Suomea ja chihuahua istuu kojelaudalla. Sauna, keilaus ja hyvä nauru riittävät minulle. Koira on Pirkko, ja se on nähnyt enemmän Suomea kuin useimmat ihmiset. Tunnen jokaisen huoltoaseman munkit Hangosta Utsjoelle ja osaan sanoa, missä ne ovat parhaita. Viikonloppuisin keilaan ystävien kanssa ja saunon niin pitkään, että Pirkko käy hakemassa. Etsin suoraa ja hauskaa seuraa, jolla on lämmin sydän.",
    prompts: [
      {
        key: "ask_me",
        answer:
          "Missä on Suomen paras huoltoaseman munkki. Vastaus on pitkä, ja siinä on sivupolkuja.",
      },
      {
        key: "proud_of",
        answer:
          "Olen ajanut rekalla yli miljoona kilometriä ilman yhtään kolaria. Pirkko on ollut kyydissä melkein puolet.",
      },
      {
        key: "first_date",
        answer:
          "Keilaamaan ja sen jälkeen munkkikahville. Häviäjä maksaa, ja minä en yleensä häviä.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "yes_not_with_me",
      wantsKids: "dont_want",
      smoking: "quitting",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 163,
      exercise: "sometimes",
      field: ["service"],
      occupation: ["transport"],
    },
  },
  {
    key: "leena",
    name: "Leena",
    born: { year: 1981, month: 11 },
    gender: "woman",
    answers: WOMEN_FOR_MEMBERS,
    home: "20100",
    locale: "en",
    title: "Greenhouse gardener",
    hobbies: ["gardening", "cycling", "cooking", "baking", "board_games"],
    pets: ["other"],
    bio: "Greenhouse gardener in Turku. My hens have opinions, and one of them sits on my head. I will try to give you a plant, so be warned. The one on my head is Sirpa, and the other four follow her everywhere, including into the kitchen. I grow tomatoes for half of Turku and chillies for the brave. Evenings I cycle along the river Aura, cook whatever is ripe and read seed catalogues like other people read thrillers.",
    prompts: [
      {
        key: "unpopular_opinion",
        answer: "A tomato from a supermarket in January is not a tomato. It is a red idea of one.",
      },
      {
        key: "three_things",
        answer:
          "Warm soil, a good bicycle and Sirpa, who supervises everything I do from the top of my head.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me a card game for long winter evenings. I know only one, and I always lose it to my mother.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 170,
      exercise: "weekly",
      field: ["other"],
      occupation: ["agriculture", "entrepreneur"],
    },
  },
  // Non-binary people.
  {
    key: "sasha",
    name: "Sasha",
    born: { year: 1992, month: 7 },
    gender: "non_binary",
    answers: NON_BINARY_PEOPLE,
    home: "33100",
    locale: "en",
    title: "Tattoo artist",
    hobbies: ["drawing", "photography", "video_games", "cinema", "board_games"],
    pets: ["other"],
    bio: "Tattoo artist who draws geometry all day and skates badly on the lake when it freezes. Two ferrets live in my hoodie. They are called Pixel and Mursu and they steal socks for a living. My studio is above a bakery, so every tattoo smells faintly of cinnamon. Off work I play long strategy games, take film photos of tram lines and try every vegan place in Tampere. Patient hands, impatient brain.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "I can draw a perfect circle freehand. It is my only party trick, and it works every time.",
      },
      {
        key: "never_again",
        answer:
          "Skating on the lake in December because it looked frozen enough. It was frozen enough for the ferrets.",
      },
      {
        key: "ask_me",
        answer:
          "The strangest tattoo I have done. Then ask about the second strangest, which is better.",
      },
    ],
    about: {
      identityLabel: "non_binary",
      monogamy: "non_monogamous",
      hasKids: "no",
      wantsKids: "dont_want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "dont_mind",
      height: 172,
      exercise: "sometimes",
      field: ["arts"],
      occupation: ["arts_culture", "entrepreneur"],
      zodiac: "corgi",
    },
  },
  {
    key: "robin",
    name: "Robin",
    born: { year: 1988, month: 3 },
    gender: "non_binary",
    answers: NON_BINARY_PEOPLE,
    home: "00500",
    showsArea: true,
    locale: "en",
    title: "Costume maker",
    hobbies: ["theatre", "crafts", "forest_walks", "museums", "dogs"],
    pets: ["dog"],
    bio: "I make costumes for a theatre and sometimes forget to take the ruff off before lunch. My old beagle disapproves of rain, and of me. Her name is Muru and she has been my critic for twelve years: she sleeps through the good ones. At work I sew dragons, queens and once a very convincing herring. At home I mend other people's coats and walk slowly in Central Park, the one in Helsinki, which has better mushrooms.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "A herring costume that got its own round of applause. The actor inside it says it was the best night of his career.",
      },
      {
        key: "first_date",
        answer:
          "A matinee, then a slow walk in the forest with an old beagle who sets the pace and the route.",
      },
      {
        key: "unpopular_opinion",
        answer:
          "Everyone should own one ridiculous hat. Life is long, and a hat is cheaper than a sports car.",
      },
    ],
    about: {
      identityLabel: "genderqueer",
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 176,
      exercise: "sometimes",
      field: ["arts"],
      occupation: ["arts_culture"],
      university: ["aalto"],
    },
  },
  // Younger men.
  {
    key: "eemil",
    name: "Eemil",
    born: { year: 1998, month: 10 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "00530",
    showsArea: true,
    locale: "en",
    title: "Barista",
    hobbies: ["coffee", "cinema", "running", "board_games", "concerts"],
    pets: ["cat"],
    bio: "Barista who can tell what kind of day you are having from your order. My cat sits on my head during video calls. I run when I have to. I roast my own beans on the balcony, which my neighbours tolerate because I leave them samples. Most evenings I am at a small cinema in Kallio, watching something old and black and white, then talking about it too long. I would love a running partner who stops for pastries.",
    prompts: [
      {
        key: "overrated",
        answer:
          "Latte art. A good coffee tastes the same with a heart on top or a blob. I can do the heart, though.",
      },
      {
        key: "argue_about",
        answer:
          "Whether a film is better on the big screen. It is, every time, and the popcorn is part of it.",
      },
      {
        key: "sunday",
        answer:
          "A slow run to a bakery, a double feature in the afternoon and noodles on the way home.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "dont_mind",
      height: 179,
      exercise: "weekly",
      field: ["service"],
      occupation: ["service_hospitality"],
    },
  },
  {
    key: "abdi",
    name: "Abdi",
    born: { year: 1996, month: 6 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "00930",
    locale: "en",
    title: "Software tester",
    hobbies: ["football", "baking", "video_games", "dogs", "cinema"],
    pets: ["dog"],
    bio: "Software tester and football coach, which means I find mistakes all week. My corgi gets carried home when it rains. I bake, with mixed results. The corgi is called Bisi and he is the team's mascot, unofficially and with great confidence. I grew up in Itäkeskus and still live round the corner from my mother, who checks my bread like a referee. Looking for someone patient, funny and ready for long walks in short-legged company.",
    prompts: [
      {
        key: "last_laugh",
        answer:
          "My under-twelves team celebrating a goal so hard that they forgot to defend, and the other side scored straight away.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can find the bug in your app in under five minutes. Finding my keys takes me much longer.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me to make bread that rises. My mother says my loaves have the shape of good intentions.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "so"],
      education: "amk",
      drinking: "never",
      drugsAttitude: "not_my_thing",
      height: 186,
      exercise: "daily",
      field: ["tech"],
      occupation: ["tech", "sports"],
      university: ["metropolia"],
    },
  },
  {
    key: "aleksi",
    name: "Aleksi",
    born: { year: 1997, month: 2 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "15110",
    locale: "en",
    title: "Tree surgeon",
    hobbies: ["climbing", "forest_walks", "board_games", "hiking", "cooking"],
    pets: ["none"],
    bio: "Tree surgeon. I spend my days up in the birches, where the squirrels treat me as furniture. Board games when my feet are back on the ground. I climb at the wall in Lahti on weeknights and on real rock when the summer lets me. I own too many games with too many pieces, and I will explain the rules slowly and well. I like early mornings, the smell of cut pine and people who ask a lot of questions.",
    prompts: [
      {
        key: "three_things",
        answer:
          "A good rope, a thermos of tea and a board game with far too many little wooden pieces.",
      },
      {
        key: "argue_about",
        answer:
          "Whether birches are the best trees. They are, and I have been up enough of them to know.",
      },
      {
        key: "first_date",
        answer:
          "A game café with something new to learn, and a walk afterwards in the forest to argue about who won.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 184,
      exercise: "daily",
      field: ["trades"],
      occupation: ["agriculture"],
    },
  },
  {
    key: "niko",
    name: "Niko",
    born: { year: 1995, month: 9 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "02230",
    locale: "en",
    title: "Physiotherapist",
    hobbies: ["padel", "dogs", "travelling", "gym", "slow_mornings"],
    pets: ["dog"],
    bio: "Physiotherapist who has moved house too many times. My poodle and I share a hairdresser, more or less. Padel partner wanted, and help with a wardrobe. I have lived in four cities and Matinkylä is finally home, with a balcony full of plants that are mostly alive. The poodle, Ruu, has her own passport and better manners than me. I like weekend trips, long talks over breakfast and fixing bad posture, whether you ask or not.",
    prompts: [
      {
        key: "never_again",
        answer: "Move house in January. Never again, not even for a balcony this good.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me to put a wardrobe together without a screw left over. I can fix a back, but not a cupboard.",
      },
      {
        key: "first_date",
        answer:
          "A game of padel and a smoothie after. Then a walk by the sea with Ruu, who will act as if she is the one on the date.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 182,
      exercise: "daily",
      field: ["health"],
      occupation: ["healthcare"],
      university: ["metropolia"],
    },
  },
  {
    key: "samu",
    name: "Samu",
    born: { year: 1998, month: 5 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "33500",
    locale: "en",
    title: "Plumber",
    hobbies: ["skiing", "video_games", "cottage", "sauna", "fishing"],
    pets: ["none"],
    bio: "Plumber and snowboarder. If your sink is leaking, I am the one grinning under it. In summer you will find me on the lake in any weather. My family has a cottage up north where the sauna is older than my dad, and I spend every free weekend there fixing something. Evenings I play co-op games with my brothers and lose on purpose to the youngest. Easygoing, practical, and I always bring snacks.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "I fixed my grandma's sauna stove with parts from three different decades. It works, and it is loud.",
      },
      {
        key: "overrated",
        answer:
          "New Year's Eve. Give me a quiet night at the cottage, a sauna and fireworks from a distance.",
      },
      {
        key: "ask_me",
        answer:
          "The strangest thing I have pulled out of a drain. You will regret asking, but you will laugh.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["snus"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 177,
      exercise: "weekly",
      field: ["trades"],
      occupation: ["trades_construction"],
    },
  },
  {
    key: "rasmus",
    name: "Rasmus",
    born: { year: 1996, month: 1 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "00180",
    showsArea: true,
    locale: "en",
    title: "Ferry deckhand",
    hobbies: ["making_music", "sailing", "dogs", "swimming", "concerts"],
    pets: ["dog"],
    bio: "Deckhand on the ferries and accordion player on the side. My dog shakes mud on everybody equally. I like long evenings and quiet squares. I work on the ferry to Suomenlinna, which means I see the sea every day and still look at it like a tourist. On free nights I play in a small folk band in bars that have no stage, only a corner. The dog is Lumi, she is white for about ten minutes after each bath.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "I can play the accordion and steer a boat, but not at the same time. I have been asked.",
      },
      {
        key: "sunday",
        answer:
          "An early swim off the rocks, a long brunch and an evening session with the band in somebody's kitchen.",
      },
      {
        key: "three_things",
        answer:
          "Salt air, my grandfather's accordion and a dog who thinks every puddle was made for her.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "sv"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "dont_mind",
      height: 181,
      exercise: "weekly",
      field: ["service", "arts"],
      occupation: ["transport", "arts_culture"],
    },
  },
  {
    key: "joonas",
    name: "Joonas",
    born: { year: 1997, month: 8 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "20500",
    locale: "en",
    title: "Game developer",
    hobbies: ["video_games", "board_games", "cinema", "programming", "crafts"],
    pets: ["cat"],
    bio: "Game developer. I make my own costumes and the rain ruins them. A black cat sleeps on my keyboard, so replies may take a while. Her name is Varjo and she has shipped more bugs than I have. At work I design puzzles for a small studio in Turku; at weekends I go to conventions as characters nobody recognises. I like long co-op games, horror films with the lights on and people who are excited about something, anything.",
    prompts: [
      {
        key: "unpopular_opinion",
        answer:
          "The best part of a video game is the menu music. Some of them I have listened to for longer than I have played.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me to sew a costume that survives a Finnish summer. Mine melt, shrink or drown.",
      },
      {
        key: "last_laugh",
        answer:
          "My cat walking across my keyboard during a meeting and typing a better idea than mine.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "kandi",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 175,
      exercise: "sometimes",
      field: ["tech", "arts"],
      occupation: ["tech"],
    },
  },
  {
    key: "elias",
    name: "Elias",
    born: { year: 1995, month: 4 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "60100",
    locale: "fi",
    title: "Viljelijä",
    hobbies: ["cottage", "ice_hockey", "diy", "sauna", "fishing"],
    pets: ["other"],
    bio: "Viljelijä Seinäjoelta. Vasikat pitävät minusta enemmän kuin kukko, ja kukko on tehnyt sen selväksi. Kesällä heinää, talvella lätkää. Tila on ollut suvulla neljä sukupolvea, ja minä olen ensimmäinen, joka puhuu lehmille englantia. Talvella pelaan puolustajana harrastesarjassa ja korjaan traktoria, joka on minua vanhempi. Etsin jotakuta, joka nauraa helposti eikä pelkää saappaita.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "Vasikka, jonka pullotin pikkuisesta asti, voitti maatalousnäyttelyssä. Se ei välitä palkinnoista, mutta minä välitän.",
      },
      {
        key: "sunday",
        answer:
          "Navetalla ennen kuutta, sitten pitkä aamupala äidin kanssa ja iltapäivällä jääkiekkoa telkkarista.",
      },
      {
        key: "argue_about",
        answer: "Kumpi on parempi, Seinäjoki vai Tampere. Seinäjoki, eikä se ole edes lähellä.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["snus"],
      education: "amk",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 186,
      exercise: "daily",
      field: ["other"],
      occupation: ["agriculture", "entrepreneur"],
    },
  },
  {
    key: "yusuf",
    name: "Yusuf",
    born: { year: 1997, month: 11 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "01300",
    locale: "en",
    title: "City planner",
    hobbies: ["hiking", "photography", "cooking", "gardening", "travelling"],
    pets: ["none"],
    bio: "City planner who grows tomatoes on the roof and gets lost on purpose in Lapland. I can read any plan except the one for a wardrobe. At work I draw bike lanes and argue for more benches; at home I cook big pots of something spicy for whoever turns up. Every September I take the night train north with a tent and a camera and come back with too many photos of the same fell.",
    prompts: [
      {
        key: "argue_about",
        answer:
          "Benches. Every city needs more of them, and I will draw them on any plan you show me.",
      },
      {
        key: "first_date",
        answer:
          "A walk through a part of the city neither of us knows, then dinner wherever we end up. I will not use the map.",
      },
      {
        key: "teach_me",
        answer:
          "Teach me a song you know by heart. I sing in the kitchen and my tomatoes deserve better.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "tr"],
      education: "maisteri",
      drinking: "never",
      drugsAttitude: "not_my_thing",
      height: 178,
      exercise: "weekly",
      field: ["engineering", "social"],
      occupation: ["public_sector"],
      university: ["aalto"],
    },
  },
  {
    key: "oskari",
    name: "Oskari",
    born: { year: 1996, month: 7 },
    gender: "man",
    answers: YOUNGER_PEOPLE,
    home: "40100",
    locale: "fi",
    title: "Sähköasentaja",
    hobbies: ["ice_hockey", "cats", "electronics", "sauna", "video_games"],
    pets: ["cat"],
    bio: "Sähköasentaja Jyväskylästä ja harrastajamaalivahti. Yksi etuhammas meni pelissä, ja kolme kissaa pitävät minut nöyränä. Kissat ovat Volt, Ampeeri ja Rane, joka ei suostunut teemaan. Päivät vedän johtoja uusiin kerrostaloihin, illat seison maalilla tai juotan vanhoja vahvistimia. Kesällä soudan Päijänteellä ja paistan muurinpohjalettuja. Etsin jotakuta, joka ei pelkää kissankarvoja eikä huonoja vitsejä.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "Saan minkä tahansa vanhan vahvistimen soimaan uudestaan. Paitsi omani, joka on liian rakas avattavaksi.",
      },
      {
        key: "never_again",
        answer: "Pelaa maalivahtina ilman kunnon kypärää. Hammaslääkäri muistaa minut nimeltä.",
      },
      {
        key: "three_things",
        answer: "Hyvä kolvi, lätkämaila ja kolme kissaa, jotka nukkuvat kaikki samalla tyynyllä.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["pouches"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 183,
      exercise: "weekly",
      field: ["trades"],
      occupation: ["trades_construction"],
    },
  },
  // Younger women.
  {
    key: "saara",
    name: "Saara",
    born: { year: 2002, month: 3 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "80100",
    locale: "fi",
    title: "Metsätalouden opiskelija",
    hobbies: ["hiking", "foraging", "dogs", "skiing", "birdwatching"],
    pets: ["dog"],
    bio: "Opiskelen metsätaloutta Joensuussa ja halaan puita työkseni, mittanauhan kanssa. Olen hukannut saappaan suohon, enkä kadu mitään. Koirani on Vilja, ja se tulee mukaan joka retkelle, myös niille, joille ei saisi. Syksyt kuluvat sienimetsässä ja keväät kurkia kuunnellen, ja talvella hiihdän Kolilla, jos vain ehdin. Etsin jotakuta, joka lähtee mukaan retkelle lyhyelläkin varoitusajalla ja nauraa märille sukille.",
    prompts: [
      {
        key: "three_things",
        answer: "Kumisaappaat, otsalamppu ja Vilja, joka löytää aina tien takaisin autolle.",
      },
      {
        key: "unpopular_opinion",
        answer: "Suo on Suomen kaunein maisema. Varsinkin, kun saapas pysyy jalassa.",
      },
      {
        key: "ask_me",
        answer: "Miten puun ikä arvioidaan ilman sahaa. Se on yllättävän jännittävää, lupaan.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 167,
      exercise: "daily",
      field: ["science"],
      occupation: ["student"],
    },
  },
  {
    key: "fanni",
    name: "Fanni",
    born: { year: 2001, month: 10 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "00560",
    locale: "en",
    title: "Baker",
    hobbies: ["baking", "dance", "concerts", "coffee", "cinema"],
    pets: ["none"],
    bio: "Baker, up at five. I make very good cinnamon buns and one memorable wedding cake. Dancing and concerts when I can keep my eyes open. I go dancing on Thursdays, when my week is half done, and to gigs on my free nights, earplugs in and buns in my bag for the band. Looking for someone who does not mind an early bedtime and flour on everything.",
    prompts: [
      {
        key: "proud_of",
        answer:
          "My cardamom buns. A regular said they taste like his grandmother's, and then he cried a little, and so did I.",
      },
      {
        key: "never_again",
        answer:
          "Drive a wedding cake to Porvoo in the back of a van. I held my breath at every bump for an hour.",
      },
      {
        key: "sunday",
        answer:
          "Sleeping until ten, which is a wild luxury for a baker, then a long walk and a dance class in the evening.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 162,
      exercise: "weekly",
      field: ["service"],
      occupation: ["service_hospitality"],
    },
  },
  {
    key: "lotta",
    name: "Lotta",
    born: { year: 2000, month: 6 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "10600",
    locale: "sv",
    title: "Veterinärstudent",
    hobbies: ["horses", "sailing", "swimming", "forest_walks", "baking"],
    pets: ["other"],
    bio: "Veterinärstudent och ryttare från Ekenäs. Min häst stjäl mina smörgåsar och jag sitter ofta i en vattenpöl. Jag trivs bäst vid havet. Hästen heter Dimma, hon är tjugo år och har mer temperament än jag. Under terminerna pluggar jag i Helsingfors och på helgerna åker jag hem till stallet och båten. Jag söker någon som inte är rädd för lera, gillar långa promenader på stranden och kan skratta åt sig själv.",
    prompts: [
      {
        key: "first_date",
        answer:
          "En ridtur längs stranden i Ekenäs och sedan glass, oavsett väder. Du får låna Dimma, om hon går med på det.",
      },
      {
        key: "hidden_talent",
        answer:
          "Jag kan fläta en hästs man på fem minuter. Mitt eget hår ser däremot alltid ut som efter en storm.",
      },
      {
        key: "overrated",
        answer:
          "Sovmorgnar. Stallet på morgonen, när allt är tyst och hästarna äter, är det bästa jag vet.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      languages: ["sv", "fi", "en"],
      education: "kandi",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 170,
      exercise: "daily",
      field: ["health", "science"],
      occupation: ["student"],
      university: ["helsinki"],
    },
  },
  {
    key: "aada",
    name: "Aada",
    born: { year: 1999, month: 2 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "28100",
    locale: "en",
    title: "Geologist",
    hobbies: ["hiking", "concerts", "pub_quiz", "museums", "swimming"],
    pets: ["none"],
    bio: "Geologist. Yes, I lick rocks, and I can explain why. I have also lost a tent at a festival, so I make no promises about camping. I work for a small firm mapping bedrock along the coast, which means boots, maps and a lot of sandwiches in the rain. Pori Jazz is my favourite week of the year, and I go to the pub quiz every Tuesday, where I am the team's answer to everything with a mineral in it.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "I can tell you how old the rock under your house is. I promise it is more interesting than it sounds.",
      },
      {
        key: "last_laugh",
        answer:
          "A child at a museum asking me if I had met the dinosaurs. I said only the small ones.",
      },
      {
        key: "argue_about",
        answer:
          "Whether the Finnish coast is the most beautiful in the world. It is still rising out of the sea, so it has a head start.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 169,
      exercise: "weekly",
      field: ["science"],
      occupation: ["science"],
    },
  },
  {
    key: "nea",
    name: "Nea",
    born: { year: 1998, month: 9 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "02650",
    locale: "en",
    title: "Emergency nurse",
    hobbies: ["dogs", "running", "podcasts", "forest_walks", "swimming"],
    pets: ["dog"],
    bio: "Emergency nurse with two old rescue dogs who own the bed. I listen to podcasts on long runs and eat ice cream in any weather. The dogs are Elsa and Pätkä, both came from shelters abroad and both snore. Shift work means I know Espoo at every hour, and I can recommend a bakery for each of them. I like people who are calm, funny and do not mind dog hair on their coat. I would rather go for a run than a drink, and ice cream after either.",
    prompts: [
      {
        key: "three_things",
        answer:
          "Comfortable shoes, a true crime podcast and two snoring dogs taking up exactly the whole bed.",
      },
      {
        key: "first_date",
        answer:
          "A run along the shore, slow enough to talk, and then ice cream, even if it is snowing.",
      },
      {
        key: "ask_me",
        answer:
          "Which podcast to start with. I have a list for every mood and every length of run.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 166,
      exercise: "daily",
      field: ["health"],
      occupation: ["healthcare"],
      university: ["laurea"],
    },
  },
  {
    key: "yasmin",
    name: "Yasmin",
    born: { year: 1997, month: 5 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "00510",
    showsArea: true,
    locale: "en",
    title: "Trainee lawyer",
    hobbies: ["martial_arts", "reading", "cats", "gym", "dinner_parties"],
    pets: ["cat"],
    bio: "Trainee lawyer and boxer. I win most arguments and lose to most yoghurt lids. My cat has no hair and a very warm jumper. She is a sphynx called Kaneli and she follows the sun around the flat all day. I train three evenings a week and read crime novels on the tram home, trying to guess the ending before my stop. I like honest people, long dinners and a good debate where nobody storms off.",
    prompts: [
      {
        key: "argue_about",
        answer:
          "Anything, really, but best of all whether a hot dog is a sandwich. I have a closing argument ready.",
      },
      {
        key: "proud_of",
        answer:
          "My first amateur fight. I lost on points, but I stayed on my feet, and my grandmother cheered louder than anyone.",
      },
      {
        key: "overrated",
        answer:
          "Brunch. It is lunch with a queue. I would rather have a proper breakfast at home with the cat.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      languages: ["en", "fi", "ar"],
      education: "maisteri",
      drinking: "never",
      drugsAttitude: "not_my_thing",
      height: 164,
      exercise: "daily",
      field: ["law"],
      occupation: ["law_finance"],
      university: ["helsinki"],
      guild: ["helsinki_pykala"],
    },
  },
  {
    key: "emilia",
    name: "Emilia",
    born: { year: 1996, month: 1 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "04200",
    locale: "en",
    title: "Cartographer",
    hobbies: ["running", "puzzles", "dogs", "hiking", "forest_walks"],
    pets: ["dog"],
    bio: "Cartographer and orienteer, which does not stop me from getting lost. My terrier hides in the laundry. I will always know roughly where north is. At work I draw very precise maps for very patient people; at weekends I run through forests with a compass and a terrier who ignores it. I love jigsaw puzzles of maps, which my friends find hilarious. Looking for someone who enjoys a detour.",
    prompts: [
      {
        key: "never_again",
        answer:
          "Trust a shortcut I found on a map from the eighties. The swamp had moved, or I had.",
      },
      {
        key: "hidden_talent",
        answer:
          "I can draw a map of anywhere I have walked once. My own flat, not so well: I keep losing the cheese grater.",
      },
      {
        key: "sunday",
        answer:
          "An orienteering race in the morning, a jigsaw in the afternoon and the terrier asleep on the finished corner.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "maisteri",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 171,
      exercise: "daily",
      field: ["science", "tech"],
      occupation: ["public_sector", "science"],
      university: ["helsinki"],
    },
  },
  {
    key: "alina",
    name: "Alina",
    born: { year: 1996, month: 8 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "53100",
    locale: "en",
    title: "Physiotherapist",
    hobbies: ["dance", "yoga", "learning_languages", "swimming", "cooking"],
    pets: ["other"],
    bio: "Physiotherapist and former ballet dancer. I still practise on piers when nobody is looking. My tortoise and I are both in no hurry. His name is Professor and he is older than my car. I danced for years in Helsinki and now help people stand up straight by Lake Saimaa. I am learning Italian for no reason at all, I teach a yoga class on Saturdays and I make excellent blini.",
    prompts: [
      {
        key: "teach_me",
        answer:
          "Teach me a word in your favourite language. I collect them, and I use them at the wrong moments.",
      },
      {
        key: "proud_of",
        answer:
          "Dancing the Nutcracker at sixteen with a sprained toe. Nobody noticed, which was the whole point.",
      },
      {
        key: "first_date",
        answer:
          "A walk along the harbour, ice cream from the kiosk and a slow look at the boats. I like dates without a clock.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "amk",
      drinking: "rarely",
      drugsAttitude: "not_my_thing",
      height: 168,
      exercise: "daily",
      field: ["health"],
      occupation: ["healthcare"],
    },
  },
  {
    key: "pinja",
    name: "Pinja",
    born: { year: 1995, month: 4 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "67100",
    locale: "fi",
    title: "Jäähallin hoitaja",
    hobbies: ["ice_hockey", "sauna", "cottage", "dogs", "fishing"],
    pets: ["dog"],
    bio: "Hoidan jäähallia Kokkolassa ja jackrussell ajaa jäänhoitokonetta kanssani. Kesät vietän mökillä. Sauna lämpiää aina. Koira on Tiltu, ja se on hallin tunnetuin työntekijä: lapset tulevat katsomaan sitä eivätkä minua. Pelaan itse naisten harrastejoukkueessa hyökkääjänä ja hävitän kiekon useammin kuin myönnän. Mökillä Kälviällä soudan, paistan lettuja ja kuuntelen sadetta. Etsin jotakuta, joka tulee katsomaan peliä ja jää saunaan.",
    prompts: [
      {
        key: "hidden_talent",
        answer:
          "Saan jään peilikirkkaaksi yhdellä kierroksella. Kotona en saa edes ikkunoita puhtaiksi.",
      },
      {
        key: "sunday",
        answer:
          "Aamu-uinti mökin laiturilta, päivällä kalastusta ja illalla lätkää telkkarista saunan jälkeen.",
      },
      {
        key: "proud_of",
        answer:
          "Tein ensimmäisen maalini kolmekymppisenä. Juhlin sitä niin, että kaaduin, ja kaikki kuvasivat.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "want",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 170,
      exercise: "daily",
      field: ["service", "trades"],
      occupation: ["sports", "public_sector"],
    },
  },
  {
    key: "ronja",
    name: "Ronja",
    born: { year: 1998, month: 11 },
    gender: "woman",
    answers: YOUNGER_PEOPLE,
    home: "57100",
    locale: "en",
    title: "Chimney sweep",
    hobbies: ["climbing", "coffee", "dogs", "swimming", "hiking"],
    pets: ["dog"],
    bio: "Chimney sweep, which is lucky for you. I like rooftops at sunrise and very clean cafés, where I am not always welcome. My schnauzer dislikes rain. He is called Nokinen and waits in the van while I am up on the roofs, judging me through the window. Savonlinna from above is the best view I know, the castle included. Off work I climb at the gym, drink far too much coffee and paddle on the lake when it is calm.",
    prompts: [
      {
        key: "unpopular_opinion",
        answer: "Heights are relaxing. Everything is quieter up there, even the seagulls.",
      },
      {
        key: "first_date",
        answer:
          "Coffee on a terrace with a view of the castle, then a paddle on the lake if the water is calm.",
      },
      {
        key: "last_laugh",
        answer:
          "A grandmother who paid me in pulla and then asked if I could also sweep her grandson's room.",
      },
    ],
    about: {
      monogamy: "monogamous",
      hasKids: "no",
      wantsKids: "not_sure",
      smoking: "never",
      nicotine: ["none"],
      education: "toinen_aste",
      drinking: "socially",
      drugsAttitude: "not_my_thing",
      height: 165,
      exercise: "daily",
      field: ["trades"],
      occupation: ["trades_construction", "entrepreneur"],
      zodiac: "sagittarius",
    },
  },
];

/** What the languages field says, by the language the profile is written in. */
const LANGUAGES: Record<CastPerson["locale"], NonNullable<ProfileFields["languages"]>> = {
  fi: ["fi", "en"],
  sv: ["sv", "fi"],
  en: ["en", "fi"],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const castLabel = (key: string): string => `${DEMO_LABEL_PREFIX}cast-${key}`;

/**
 * The cast as people of the population. `keep` is the API's rule for what is
 * kept of a postal code (ADR-061 §2), handed in as the places are; somebody with
 * no home would be in nobody's pool with nothing to say so, so that is refused.
 */
export function castPeople(keep: (postalCode: string) => string | null): SyntheticPerson[] {
  return CAST.map((person, i) => {
    const place = keep(person.home);
    if (place === null) throw new Error(`${person.key}: nothing is kept of ${person.home}`);
    const registeredAt = new Date(DEMO_EPOCH.getTime() - (i + 1) * DAY_MS);
    const givenAt = new Date(registeredAt.getTime() + 3 * MINUTE_MS);
    return {
      label: castLabel(person.key),
      state: "active",
      birthYear: person.born.year,
      birthMonth: person.born.month,
      registeredAt,
      home: {
        place,
        showsArea: person.showsArea === true && place.length === POSTAL_CODE_LENGTH,
      },
      gender: person.gender,
      preferences: { seeks: [...person.answers.seeks], ageWindow: { ...person.answers.ageWindow } },
      consents: POPULATION_CONSENTS.map((kind) => ({
        kind,
        localeShown: person.locale,
        givenAt,
      })),
      profile: {
        displayName: person.name,
        bio: person.bio,
        bioPreset: null,
        fields: {
          intent: person.answers.intent,
          languages: LANGUAGES[person.locale],
          hobbies: person.hobbies,
          pets: person.pets,
          occupationTitle: person.title,
          // After the languages: somebody who speaks more names them here.
          ...person.about,
        },
        prompts: [...person.prompts],
        specialCategoryConsentedAt: null,
      },
    };
  });
}

/** Each person's own faces by label: never another's, so that a card shows one person. */
export function castFaces(manifest: readonly PhotoAsset[]): Map<string, PhotoAsset[]> {
  return new Map(
    CAST.map((person) => [castLabel(person.key), assetsFor(manifest, `cast:${person.key}`)]),
  );
}

/** The accounts of the cast by key, of those who have been written. */
export async function castAccounts(db: Queryable): Promise<Map<string, string>> {
  const keys = new Map(
    CAST.map((person) => [`${DEMO_SUBJECT_PREFIX}${castLabel(person.key)}`, person.key]),
  );
  const { rows } = await db.query<{ subject: string; id: string }>(
    `SELECT i.broker_subject AS subject, a.id
       FROM identity i JOIN account a ON a.identity_id = i.id
      WHERE i.broker_subject = ANY($1)`,
    [[...keys.keys()]],
  );
  const accounts = new Map<string, string>();
  for (const { subject, id } of rows) {
    const key = keys.get(subject);
    if (key) accounts.set(key, id);
  }
  return accounts;
}

/**
 * Takes away the chats a member's erasure left with the cast: erasure keeps a
 * conversation for the other side (TD-1), and nobody signs in as these people, so
 * nobody would ever read it, and every reset would leave more. How many went.
 */
export async function removeCastLeftovers(
  db: Queryable,
  accounts: ReadonlyMap<string, string>,
): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM conversation WHERE id IN (
       SELECT mine.conversation_id
         FROM conversation_participant mine
         JOIN conversation_participant gone
           ON gone.conversation_id = mine.conversation_id AND gone.account_id IS NULL
        WHERE mine.account_id = ANY($1))`,
    [[...accounts.values()]],
  );
  return rowCount ?? 0;
}

/**
 * What waits when a member opens People, the day after it was given: a fish comes
 * first in the queue, so Jere, the DJ, is the first card on Sanna's, Noa's and
 * Kerttu's accounts, and a like back makes a match (ADR-062 §2). The four members
 * to explore (#560) have a fish and likes of their own, from people of their ages.
 */
export const CAST_LIKES: readonly WaitingLikes[] = [
  { of: "sanna", fishFrom: ["jere"], likedBy: ["risto", "karim"] },
  { of: "noa", fishFrom: ["jere"], likedBy: ["robin", "timo"] },
  { of: "kerttu", fishFrom: ["jere"], likedBy: ["tiina"] },
  { of: "aino", fishFrom: ["niko"], likedBy: ["aleksi", "sasha"] },
  { of: "onni", fishFrom: ["nea"], likedBy: ["fanni", "emilia"] },
  { of: "tapio", fishFrom: ["paivi"], likedBy: ["tiina"] },
  { of: "ilona", fishFrom: ["antero"], likedBy: ["esa", "olavi"] },
];

/**
 * Who waits on Sanna's Later list when she opens it, the day after (#681): four of
 * the men she seeks, put off with Later on the day before, so that a reviewer
 * signed in as her finds people there to open. None of them likes her or chats
 * with her: those wait in People and in her conversations.
 */
export const CAST_LATER: readonly LaterList[] = [
  { of: "sanna", later: ["kalle", "minh", "markku", "timo"] },
];

/**
 * The members' chats, in the language each of them writes (histories.ts), or the
 * other's where the member speaks it: one on the member's turn, with something
 * unread, and, where there are two, one on the other's. Written as the stories' conversations are; a chat partner is no card
 * while the conversation stands (ADR-062 §6).
 */
export const CAST_CONVERSATIONS: readonly PersonaConversation[] = [
  {
    between: ["sanna", "juha"],
    openedHoursAgo: 52,
    messages: [
      {
        from: "b",
        hoursAgo: 50,
        body: "Hei Sanna! Arkkitehti ja lintuharrastaja. Voiko talon piirtää niin, että tikka viihtyy?",
      },
      {
        from: "a",
        hoursAgo: 47,
        body: "Voi, mutta naapurit eivät silloin viihdy. Mitä sinä leivot? Profiilissasi puhuttiin ovesta.",
      },
      {
        from: "b",
        hoursAgo: 30,
        body: "Hapanjuurileipää. Se pitää nyt ovea auki, ja ovi on tyytyväinen.",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["sanna", "mika"],
    openedHoursAgo: 40,
    messages: [
      {
        from: "a",
        hoursAgo: 38,
        body: "Moi Mika! Onko paloaseman keittiössä oikeasti aina keittoa?",
      },
      {
        from: "b",
        hoursAgo: 36,
        body: "Aina. Se on ainoa asia, joka ei koskaan pala pohjaan. Melkein.",
      },
      { from: "a", hoursAgo: 20, body: "Kuulostaa turvalliselta. Millainen keitto on paras?" },
    ],
    readUpTo: { a: 3, b: 2 },
  },
  {
    between: ["noa", "harri"],
    openedHoursAgo: 60,
    messages: [
      {
        from: "b",
        hoursAgo: 58,
        body: "Hi Noa. You said to tell you what I am reading, so: a very long book about moss. Your turn.",
      },
      {
        from: "a",
        hoursAgo: 55,
        body: "Moss is underrated. I am reading about trees. How is the knitting going?",
      },
      {
        from: "b",
        hoursAgo: 28,
        body: "Slowly. The sock has become a small scarf. Can you really name a tree by its bark?",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["noa", "leena"],
    openedHoursAgo: 34,
    messages: [
      { from: "a", hoursAgo: 32, body: "Hello Leena. I have to ask about the hen on your head." },
      {
        from: "b",
        hoursAgo: 30,
        body: "Her name is Sirpa and she does what she wants. Do you climb anything without a rope?",
      },
      {
        from: "a",
        hoursAgo: 18,
        body: "Only bouldering walls, and only badly. Does Sirpa come along on dates?",
      },
    ],
    readUpTo: { a: 3, b: 2 },
  },
  {
    between: ["kerttu", "seppo"],
    openedHoursAgo: 44,
    messages: [
      {
        from: "b",
        hoursAgo: 42,
        body: "Hej Kerttu! Havet, en bra bok och nybryggt kaffe låter som en bra dag. Vilken bok just nu?",
      },
      {
        from: "a",
        hoursAgo: 39,
        body: "En deckare som jag redan har gissat slutet på. Vad gör en smed när det regnar?",
      },
      {
        from: "b",
        hoursAgo: 24,
        body: "Samma sak som annars, men med dörren stängd. Kattungen sover i förklädet.",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["aino", "elias"],
    openedHoursAgo: 52,
    messages: [
      {
        from: "b",
        hoursAgo: 50,
        body: "Moi Aino! Luokanopettaja siis. Osaatko pitää järjestystä myös kukolle? Meidän kukko ei tottele ketään.",
      },
      {
        from: "a",
        hoursAgo: 46,
        body: "Kukot ovat helpompia kuin kolmasluokkalaiset maanantaiaamuna. Mitä vasikoille kuuluu?",
      },
      {
        from: "b",
        hoursAgo: 26,
        body: "Hyvää. Yksi niistä söi lippikseni. Toisitko korvapuusteja, jos tulisit käymään?",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["aino", "oskari"],
    openedHoursAgo: 38,
    messages: [
      {
        from: "a",
        hoursAgo: 36,
        body: "Hei Oskari! Pakko kysyä siitä etuhampaasta. Torjuitko sentään sen kiekon?",
      },
      {
        from: "b",
        hoursAgo: 33,
        body: "Torjuin, naamalla. Maalia ei tullut, joten se kannatti. Melkein.",
      },
      {
        from: "a",
        hoursAgo: 19,
        body: "Kuulostaa sankarilliselta. Mitä kissat sanoivat, kun tulit kotiin?",
      },
    ],
    readUpTo: { a: 3, b: 2 },
  },
  {
    between: ["onni", "aada"],
    openedHoursAgo: 50,
    messages: [
      {
        from: "b",
        hoursAgo: 48,
        body: "Hi Onni. A sound engineer, so you can tell me what a rock sounds like when I lick it. I am joking. Mostly.",
      },
      {
        from: "a",
        hoursAgo: 45,
        body: "Crunchy, I would guess. I once recorded a frozen lake cracking. Does that count as geology?",
      },
      {
        from: "b",
        hoursAgo: 27,
        body: "It counts, and now I want to hear it. Do you still have the recording?",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["onni", "ronja"],
    openedHoursAgo: 32,
    messages: [
      {
        from: "a",
        hoursAgo: 30,
        body: "Hello Ronja. Is it true that a chimney sweep brings luck, or is that only good marketing?",
      },
      {
        from: "b",
        hoursAgo: 28,
        body: "Both. Shake my hand and see what happens. What can you see from your rehearsal room?",
      },
      {
        from: "a",
        hoursAgo: 16,
        body: "A car park and one brave birch. Rooftops at sunrise sound better. Does the schnauzer come up with you?",
      },
    ],
    readUpTo: { a: 3, b: 2 },
  },
  {
    between: ["tapio", "sari"],
    openedHoursAgo: 48,
    messages: [
      {
        from: "b",
        hoursAgo: 46,
        body: "Moi Tapio! Rekkakuski täällä, ajan usein Tampereen ohi. Onko pilkillä tilaa chihuahualle?",
      },
      {
        from: "a",
        hoursAgo: 43,
        body: "On, jos sillä on lämmin takki. Mitä se tekee kojelaudalla koko päivän?",
      },
      {
        from: "b",
        hoursAgo: 25,
        body: "Vahtii liikennettä ja haukkuu asuntoautoja. Lämpiääkö se sauna myös pakkasella?",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["ilona", "anders"],
    openedHoursAgo: 56,
    messages: [
      {
        from: "b",
        hoursAgo: 54,
        body: "Hej Ilona! En översättare. Vad heter det på finska när hunden tar hela båten och man själv sitter på relingen?",
      },
      {
        from: "a",
        hoursAgo: 50,
        body: "Det heter att hunden är kapten. Hur stor är han egentligen?",
      },
      {
        from: "b",
        hoursAgo: 29,
        body: "Större än jag, och han vet om det. Tar du med tomater om jag kokar kaffe på en kobbe?",
      },
    ],
    readUpTo: { a: 2, b: 2 },
  },
  {
    between: ["ilona", "lasse"],
    openedHoursAgo: 35,
    messages: [
      {
        from: "a",
        hoursAgo: 33,
        body: "Hei Lasse! Kumpi keittää paremmat nuotiokahvit, sinä vai koira?",
      },
      {
        from: "b",
        hoursAgo: 31,
        body: "Koira vahtii pannua ja minä poltan sormeni, joten kai se on yhteistyötä.",
      },
      {
        from: "a",
        hoursAgo: 17,
        body: "Hyvä tiimi. Huomasiko hirvi teidät tälläkin viikolla ensin?",
      },
    ],
    readUpTo: { a: 3, b: 2 },
  },
];
