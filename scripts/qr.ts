/**
 * qr: the QR code printed for a channel (#768, #653). One SVG of the
 * website's short address for that channel, which the website's Amplify rule
 * sends on to the API's one link, which sends a phone to its own store
 * (ADR-044 §13; `docs/runbooks/channel-links.md`). The printed address is the
 * website's, so a later move of the API's host changes that rule and never a
 * printed code.
 *
 * The code is vector, black on white, at error correction M or better, with
 * the four modules of quiet zone the standard asks for, and nothing else in
 * it: the address in words, the size and the place on the page are the print
 * template's (#415). The channel is held to the one link's shape, so a code is
 * never printed for a name the API would drop. Nothing is sent anywhere.
 *
 * Usage:
 *   pnpm qr -- <channel>               writes qr-<channel>.svg where it was run
 *   pnpm qr -- <channel> --out <dir>   or into <dir>
 *   node scripts/qr.ts --self-test     over a scratch folder
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type Bitmap2D, correction, generate } from "lean-qr";
import { toSvgSource } from "lean-qr/extras/svg";
// By path: the root is no workspace of @kuutti/schema. The channel's shape is the API's.
import { CHANNEL_NAME_PATTERN } from "../packages/schema/src/rewards.ts";

/** What a printed code says: the website's address for the channel. */
export const printedAddress = (channel: string): string => `https://kumpa.fi/q/${channel}`;

/** The quiet zone, in modules (ISO/IEC 18004 asks for four). */
const QUIET_ZONE = 4;

interface Request {
  channel: string;
  out: string;
}

function parse(args: readonly string[], here: string): Request {
  let channel: string | undefined;
  let out: string | undefined;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] ?? "";
    if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg === "--out" ? args[++at] : arg.slice("--out=".length);
      if (!value) throw new Error("--out takes a folder");
      if (out !== undefined) throw new Error("--out is given twice");
      out = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown argument ${arg}: only --out is taken`);
    } else if (channel !== undefined) {
      throw new Error("one channel at a time");
    } else {
      channel = arg;
    }
  }
  if (channel === undefined) throw new Error("name the channel: pnpm qr -- <channel>");
  if (!CHANNEL_NAME_PATTERN.test(channel)) {
    throw new Error(
      `the channel "${channel}" is not one the link takes: lower-case letters, digits and hyphens, at most 30`,
    );
  }
  return { channel, out: resolve(here, out ?? ".") };
}

/** The SVG document of a channel's code, its address in its title. */
export function codeOf(channel: string): { svg: string; code: Bitmap2D } {
  const address = printedAddress(channel);
  const code = generate(address, { minCorrectionLevel: correction.M });
  const svg = toSvgSource(code, {
    on: "#000000",
    off: "#ffffff",
    pad: QUIET_ZONE,
    xmlDeclaration: true,
  })
    // A title says what the drawing holds to whoever opens the file.
    .replace(/(<svg\b[^>]*>)/, `$1<title>${address}</title>`);
  return { svg, code };
}

/**
 * The error correction a code was drawn with, read back from its format bits
 * (ISO/IEC 18004 §7.9: two bits of level and three of mask, BCH-coded and
 * masked, beside the top-left finder), so the self-test holds what is printed.
 */
function correctionOf(code: Bitmap2D): "L" | "M" | "Q" | "H" | undefined {
  const levels = { L: 1, M: 0, Q: 3, H: 2 } as const;
  const formatBits = (level: number, mask: number) => {
    const data = (level << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((data << 10) | rem) ^ 0x5412;
  };
  let read = 0;
  const put = (bit: number, on: boolean) => {
    if (on) read |= 1 << bit;
  };
  for (let i = 0; i <= 5; i++) put(i, code.get(8, i));
  put(6, code.get(8, 7));
  put(7, code.get(8, 8));
  put(8, code.get(7, 8));
  for (let i = 9; i < 15; i++) put(i, code.get(14 - i, 8));
  for (const [name, level] of Object.entries(levels)) {
    for (let mask = 0; mask < 8; mask++) {
      if (formatBits(level, mask) === read) return name as keyof typeof levels;
    }
  }
  return undefined;
}

function write(request: Request): string {
  const file = join(request.out, `qr-${request.channel}.svg`);
  writeFileSync(file, codeOf(request.channel).svg);
  return file;
}

function selfTest(): void {
  const failures: string[] = [];
  const check = (name: string, holds: boolean, detail = "") => {
    if (!holds) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
  };
  const refuses = (name: string, args: readonly string[], words: string) => {
    try {
      parse(args, "/");
      failures.push(`${name}: expected a refusal naming "${words}"`);
    } catch (error) {
      const message = (error as Error).message;
      check(name, message.includes(words), `got "${message}"`);
    }
  };

  refuses("no channel", [], "name the channel");
  refuses("a channel in capitals", ["Channel"], "not one the link takes");
  refuses("a channel of thirty-one", ["a".repeat(31)], "not one the link takes");
  refuses("a channel with a space", ["channel 7"], "not one the link takes");
  refuses("a channel carrying a query", ["x&pt=1"], "not one the link takes");
  refuses("two channels", ["a", "b"], "one channel at a time");
  refuses("an unknown flag", ["a", "--size", "2"], "unknown argument --size");
  refuses("--out without a folder", ["a", "--out"], "--out takes a folder");
  refuses("--out= without a folder", ["a", "--out="], "--out takes a folder");
  refuses("--out twice", ["a", "--out", "x", "--out", "y"], "--out is given twice");

  const parsed = parse(["channel-7", "--out=prints"], "/tmp");
  check("a channel and a folder", parsed.channel === "channel-7" && parsed.out === "/tmp/prints");
  check("no folder is where it was run", parse(["a"], "/here").out === "/here");
  check("the address", printedAddress("channel-7") === "https://kumpa.fi/q/channel-7");

  // The longest name the link takes keeps the code small enough to print small:
  // version 4 at most, 33 modules a side.
  const longest = codeOf("a".repeat(30)).code;
  check("the longest channel's code", longest.size <= 33, `${longest.size} modules`);
  // M or better, for a code that is scuffed, folded or printed small.
  for (const channel of ["a", "channel-7", "a".repeat(30)]) {
    const level = correctionOf(codeOf(channel).code);
    check(`${channel}'s correction`, level !== undefined && level !== "L", `${level}`);
  }
  check(
    "the reader of the correction",
    correctionOf(
      generate("x", { minCorrectionLevel: correction.L, maxCorrectionLevel: correction.L }),
    ) === "L",
  );

  const scratch = mkdtempSync(join(tmpdir(), "qr-"));
  try {
    const file = write({ channel: "channel-7", out: scratch });
    const svg = readFileSync(file, "utf8");
    const side = codeOf("channel-7").code.size + 2 * QUIET_ZONE;
    check("the file's name", file === join(scratch, "qr-channel-7.svg"));
    check("a standalone document", svg.startsWith("<?xml"));
    check("its title is the address", svg.includes("<title>https://kumpa.fi/q/channel-7</title>"));
    check(
      "the quiet zone",
      svg.includes(`viewBox="-${QUIET_ZONE} -${QUIET_ZONE} ${side} ${side}"`),
      svg.slice(0, 200),
    );
    check("black on white", svg.includes("#000000") && svg.includes("#ffffff"));
    check("the same channel, the same code", svg === codeOf("channel-7").svg);
    check("another channel, another code", svg !== codeOf("channel-8").svg);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  for (const failure of failures) console.error(`✖ self-test, ${failure}`);
  if (failures.length > 0) process.exit(1);
  console.log("✔ qr self-test: the refusals, the address, the size, the correction, the file");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else if (import.meta.main) {
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === "--"));
  try {
    console.log(write(parse(args, process.env.INIT_CWD ?? process.cwd())));
  } catch (error) {
    console.error(`qr: ${(error as Error).message}`);
    process.exit(2);
  }
}
