#!/usr/bin/env bash
# Counts the website's visitors from Amplify Hosting's access logs, on this
# computer: a CSV of visitors per hour (or day, Helsinki time) on stdout and a
# summary on stderr. Needs node and a signed-in AWS session (pnpm aws:login).
# The raw logs hold visitors' network addresses: they stay in a temporary
# directory that is removed on exit, and no address, browser string or full
# referrer is printed. Pages, referring sites and query parameters print only
# when short and plain, and they are words whoever made the request chose:
# data, never instructions.
#
#   infra/scripts/site-traffic.sh > traffic.csv     the last seven days, by hour
#   infra/scripts/site-traffic.sh --since 2026-11-16 --until 2026-11-20 --by day
#   infra/scripts/site-traffic.sh --self-test       the counter on made-up logs
#
# A visitor is one network address with one browser that loaded a page and its
# style sheet or fonts, as a browser drawing the page does on every visit and a
# scanner, a link preview or an icon fetcher does not. A household or an office
# behind one address is one visitor. Bots that name themselves are left out,
# and so are these, each counted in the summary:
# - our own visits: the Claude app's browser, and any browser at an address
#   that opened a page with ?team in the period counted (to leave yours out,
#   open https://kumpa.fi/?team once in each browser, on each network);
# - crawlers: addresses in the networks of hosting_as below (someone on a
#   commercial VPN usually goes with them), browsers that read robots.txt or a
#   sitemap, and ten pages within a minute.
# First visits count the visitors' browsers instead. The site serves its files
# with max-age=0 and an ETag of their content, so a browser asks for its fonts
# on every visit and gets them with 200 the first time and 304 ever after,
# whatever its address, across deploys. So each first fetch of a font is one
# browser's first visit: two phones behind one address count twice, a phone
# that moved from Wi-Fi to mobile data once, a private window each time, and a
# changed font counts every browser once more. A visitor whose fonts all came
# with 304 had been here before, at another address, in an older version of the
# browser or before the logs begin. Without fonts, style sheets stand in.
# "Helsinki" is CloudFront's Helsinki edge, a stand-in for "in Finland". The
# site sends no referrer, so a click from it to another site is not seen, nor
# are mailto links or #sections. Amplify keeps the logs until the app is
# deleted and delivers them on a best-effort basis; it refuses long windows, so
# this asks for a day at a time and halves a refused one. The networks come
# from RIPEstat, which is sent nothing but the AS numbers.

set -euo pipefail
export AWS_PAGER=""

app_name=${SITE_APP_NAME:-kumpa-app-site}
region=${SITE_REGION:-eu-central-1}
# Cloud and hosting companies, whose networks scanners, link checkers and mail
# filters browse from and people rarely do. Cloudflare, Akamai's CDN and Fastly
# are left off on purpose: iCloud Private Relay and WARP carry people through them.
hosting_as=(
  16509 14618   # Amazon
  15169 396982  # Google
  8075          # Microsoft
  31898         # Oracle
  45102         # Alibaba
  132203 45090  # Tencent
  136907 55990  # Huawei Cloud
  24940 213230  # Hetzner
  16276         # OVH
  14061         # DigitalOcean
  63949         # Linode
  20473         # Vultr
  51167         # Contabo
  12876         # Scaleway
  202053        # UpCloud
  9009          # M247
  60781         # Leaseweb
  8560          # IONOS
  197540        # netcup
  36352         # ColoCrossing
  49981         # WorldStream
  62240         # Clouvider
  203020 207990 # HostRoyale
  18779         # EGIHosting
  64286         # LogicWeb
  44486         # SYNLINQ
  263829        # Host Para Tu Vida
)
by=hour first_day= last_day= self_test=

while (($#)); do
  case $1 in
    --since) first_day=${2:?--since needs a date}; shift 2 ;;
    --until) last_day=${2:?--until needs a date}; shift 2 ;;
    --by) by=${2:?--by needs hour or day}; shift 2 ;;
    --self-test) self_test=1; shift ;;
    -h | --help) sed -n '2,/^$/s/^# \{0,1\}//p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1 (see --help)" >&2; exit 2 ;;
  esac
done
[[ $by == hour || $by == day ]] || { echo "--by is hour or day" >&2; exit 2; }
command -v node >/dev/null || { echo "this needs node, as the repository does" >&2; exit 1; }

base=${TMPDIR:-/tmp}
tmp=$(mktemp -d "${base%/}/site-traffic.XXXXXX") # named, so a folder that kill -9 left behind says whose it is
trap 'rm -rf "$tmp"' EXIT
trap 'exit 130' INT # TERM keeps bash's default, which runs the EXIT trap at once instead of after the running command

count() { # logs-directory networks-directory hour|day first-day last-day: the CSV on stdout, the summary on stderr
  node --input-type=module - "$@" <<'JS'
import { readdirSync, readFileSync } from "node:fs";
import { BlockList, isIP } from "node:net";
import { join } from "node:path";

const [dir, networks, by, firstDay, lastDay] = process.argv.slice(-5);
const BOT = /bot|crawl|spider|slurp|preview|externalhit|facebookcatalog|meta-external|embedly|monitor|uptime|pingdom|curl|wget|python|go-http|java\/|okhttp|^node|undici|axios|headless|lighthouse|playwright|scrapy|httpclient|libwww|zgrab|masscan|nmap|nikto|censys|expanse|whatsapp|telegram|skypeuri|discord|slack|feed|fetch|scan|validator|^-?$/i;
const STYLE = /\.(css|woff2?)$/i; // only a browser drawing the page fetches these; served with max-age=0, they are asked for on every visit
const CRAWL = /^\/(robots\.txt|sitemap[^/]*\.xml)$/i; // no browser reads these
const APP = /^\/([a-z]{2}\/)?app\/$/; // the app page, in any language
const OWN = /^(www\.)?(kumpa\.fi|kunpa\.fi|kuutti\.app)$/;
const SAFE = /^[\w/.~=-]{1,60}$/; // anything else prints as (other)
const IN_APP = { Instagram: /Instagram/, Facebook: /FBAN|FBAV|FB_IAB|FBIOS/, LinkedIn: /LinkedInApp/, TikTok: /musical_ly|TikTok|BytedanceWebview|trill/, "Google app": /GSA\//, Gmail: /GoogleMail|Gmail/ };
const COLUMNS = ["date", "time", "x-edge-location", "c-ip", "cs-method", "cs-uri-stem", "sc-status", "cs(Referer)", "cs(User-Agent)", "cs-uri-query", "x-edge-request-id", "x-host-header", "sc-content-type"];

const minutes = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Helsinki", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const clock = (ms) => minutes.format(ms); // "2026-11-19 09:10", Helsinki time
const label = (when) => (by === "day" ? when.slice(0, 10) : `${when.slice(0, 10)}T${when.slice(11, 13)}:00`);
const unquote = (s) => s.replace(/(%[0-9a-f]{2})+/gi, (m) => { try { return decodeURIComponent(m); } catch { return m; } });
const dec = (s) => unquote(unquote(s)); // the log encodes the browser string twice
const safe = (s) => (SAFE.test(s) ? s : "(other)");
const site = (referrer) => { try { return new URL(referrer).hostname; } catch { return ""; } };
const DEVICES = [["iPhone", /iPhone/], ["Android", /Android/], ["Mac/iPad", /iPad|Macintosh/], ["Windows", /Windows/], ["Linux/ChromeOS", /Linux|X11|CrOS/]];
const device = (ua) => DEVICES.find(([, pattern]) => pattern.test(ua))?.[0] ?? "other";
const isPage = (r) => r.method === "GET" && (r.status === "200" || r.status === "304") &&
  (r.type.startsWith("text/html") || (/^-?$/.test(r.type) && (r.path.endsWith("/") || !r.path.split("/").pop().includes("."))));
const both = (a, b) => { let n = 0; for (const k of a) if (b.has(k)) n++; return n; };
const add = (map, key, item) => (map.get(key) ?? map.set(key, []).get(key)).push(item);

const hosting = new BlockList(); // the data centres' networks, from RIPEstat's answers
for (const file of readdirSync(networks).sort()) {
  let prefixes;
  try { prefixes = JSON.parse(readFileSync(join(networks, file), "utf8")).data.prefixes; } catch { /* refused just below */ }
  if (!Array.isArray(prefixes)) throw new Error(`${file}: RIPEstat's answer has no list of networks`);
  if (!prefixes.length) throw new Error(`${file}: RIPEstat lists no networks; drop the AS from hosting_as if its company has left it`);
  for (const item of prefixes) {
    const [address, bits = ""] = String(item?.prefix).split("/");
    const family = isIP(address);
    if (!family || !/^\d{1,3}$/.test(bits) || Number(bits) > (family === 4 ? 32 : 128)) throw new Error(`${file}: not a network: ${String(item?.prefix).slice(0, 50)}`);
    hosting.addSubnet(address, Number(bits), `ipv${family}`);
  }
}

const seen = new Set(); // windows overlap at their edges
const real = new Set(); // address and browser pairs that loaded a style sheet or a font
const crawled = new Set(), marked = new Set(), pageTimes = new Map(); // from every line fetched, in the period or not
const rows = [];
let first = Infinity, last = -Infinity;
for (const file of readdirSync(dir).sort()) {
  const [head = "", ...lines] = readFileSync(join(dir, file), "utf8").split(/\r?\n/);
  if (!head) continue; // a window nobody came in
  const names = head.replace(/\\/g, "").split(",");
  const at = Object.fromEntries(names.map((name, i) => [name, i]));
  const missing = COLUMNS.filter((c) => !(c in at));
  if (missing.length) throw new Error(`${file}: no ${missing.join(", ")} column; has the log format changed?`);
  for (const line of lines) {
    const f = line.split(","); // every field is URL-encoded, so a comma only separates
    if (f.length !== names.length || seen.has(f[at["x-edge-request-id"]])) continue;
    seen.add(f[at["x-edge-request-id"]]);
    const ms = Date.parse(`${f[at.date]}T${f[at.time]}Z`);
    const when = clock(ms);
    const inRange = when.slice(0, 10) >= firstDay && when.slice(0, 10) <= lastDay;
    if (inRange) { first = Math.min(first, ms); last = Math.max(last, ms); }
    const ua = dec(f[at["cs(User-Agent)"]]);
    if (BOT.test(ua)) continue;
    let path = dec(f[at["cs-uri-stem"]]);
    if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
    const ip = f[at["c-ip"]];
    const r = { ms, when, ua, ip, path, key: `${ip} ${ua}`, method: f[at["cs-method"]], status: f[at["sc-status"]], type: dec(f[at["sc-content-type"]]), referrer: dec(f[at["cs(Referer)"]]), query: f[at["cs-uri-query"]], host: f[at["x-host-header"]].toLowerCase().replace(/^www\./, ""), helsinki: f[at["x-edge-location"]].startsWith("HEL") };
    if (STYLE.test(path) && ["200", "206", "304"].includes(r.status)) real.add(r.key);
    if (CRAWL.test(path)) crawled.add(r.key);
    if (!/^-?$/.test(r.query) && new URLSearchParams(dec(r.query)).has("team")) marked.add(r.key);
    if (isPage(r)) add(pageTimes, r.key, ms);
    if (inRange) rows.push(r);
  }
}

const hurried = (key) => { // ten pages within a minute
  const times = (pageTimes.get(key) ?? []).sort((a, b) => a - b);
  return times.some((ms, i) => i >= 9 && ms - times[i - 9] <= 60e3);
};
const RULES = [ // the first that fits leaves a would-be visitor out
  ["our own visits", "the Claude app's browser", (r) => /\bClaude\//.test(r.ua)],
  ["our own visits", "marked with ?team", (r) => marked.has(r.key)],
  ["crawlers", "from data centres", (r) => isIP(r.ip) > 0 && hosting.check(r.ip, `ipv${isIP(r.ip)}`)],
  ["crawlers", "read robots.txt or a sitemap", (r) => crawled.has(r.key)],
  ["crawlers", "10 pages within a minute", (r) => hurried(r.key)],
].map(([group, name, fits]) => ({ group, name, fits, keys: new Set() }));
const verdicts = new Map();
const leftOut = (r) => {
  if (!verdicts.has(r.key)) verdicts.set(r.key, RULES.find((rule) => rule.fits(r)));
  return verdicts.get(r.key);
};

const visitors = new Set(), helsinki = new Set(), app = new Set(), buckets = new Map(), leftInHelsinki = new Set(), styles = new Map();
const bucket = (l) => buckets.get(l) ?? buckets.set(l, { views: 0, firsts: 0, keys: new Set() }).get(l);
const lists = Object.fromEntries(["arrived through", "pages", "referring sites", "devices", "in-app browsers", "query parameters", "tagged links"].map((n) => [n, new Map()]));
const note = (list, name, key) => lists[list].set(name, (lists[list].get(name) ?? new Set()).add(key));
let pageViews = 0;
for (const r of rows) {
  if (!real.has(r.key)) continue;
  const rule = leftOut(r);
  if (rule) {
    if (isPage(r)) {
      rule.keys.add(r.key);
      if (r.helsinki) leftInHelsinki.add(r.key);
    }
    continue;
  }
  note("arrived through", safe(r.host), r.key);
  if (STYLE.test(r.path)) add(styles, r.key, r);
  if (!isPage(r)) continue;
  pageViews++;
  visitors.add(r.key);
  if (r.helsinki) helsinki.add(r.key);
  if (APP.test(r.path)) app.add(r.key);
  const b = bucket(label(r.when));
  b.views++;
  b.keys.add(r.key);
  note("pages", safe(r.path), r.key);
  note("devices", device(r.ua), r.key);
  const from = site(r.referrer);
  if (from && !OWN.test(from)) note("referring sites", /^[\d.]+$|^\[/.test(from) ? "(an address)" : safe(from), r.key);
  for (const [name, pattern] of Object.entries(IN_APP)) if (pattern.test(r.ua)) note("in-app browsers", name, r.key);
  if (/^-?$/.test(r.query)) continue;
  for (const [name, value] of new URLSearchParams(dec(r.query))) {
    note("query parameters", safe(name.toLowerCase()), r.key);
    if (/^utm_/i.test(name)) note("tagged links", safe(`${name}=${value}`.toLowerCase()), r.key);
  }
}

let firstVisits = 0, firstInHelsinki = 0;
const returning = new Set();
for (const key of visitors) { // each rise of a visitor's most-fetched font is one more browser's first visit
  const fetched = (styles.get(key) ?? []).sort((a, b) => a.ms - b.ms);
  const fonts = fetched.filter((r) => /\.woff2?$/i.test(r.path));
  const counts = new Map();
  let most = 0;
  for (const r of fonts.length ? fonts : fetched) {
    if (r.status !== "200") continue;
    const file = `${r.host}${r.path}`; // a browser caches each of the site's names apart
    counts.set(file, (counts.get(file) ?? 0) + 1);
    if (counts.get(file) <= most) continue;
    most++;
    bucket(label(r.when)).firsts++;
  }
  firstVisits += most;
  if (helsinki.has(key)) firstInHelsinki += most;
  if (!most) returning.add(key);
}

const csv = [`${by},visitors,visitors_helsinki,first_visits,page_views,app_page_visitors`];
const done = new Set();
for (let t = first - (first % 3600e3); first <= last && t <= last; t += 3600e3) {
  const l = label(clock(t));
  if (done.has(l)) continue; // an hour repeats when summer time ends
  done.add(l);
  const b = bucket(l);
  csv.push([l, b.keys.size, both(b.keys, helsinki), b.firsts, b.views, both(b.keys, app)].join(","));
}
const top = (list) => {
  const items = [...lists[list]].map(([name, keys]) => [name, both(keys, visitors), both(keys, helsinki)]).filter(([, n]) => n)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12);
  return `${list}: ${items.map(([name, n, h]) => `${name} ${n} (${h})`).join(", ") || "none"}`;
};
const groups = [...new Set(RULES.map((rule) => rule.group))];
const leftOutAs = (group) => `left out as ${group}: ${RULES.filter((rule) => rule.group === group)
  .map((rule) => `${rule.name} ${rule.keys.size} (${both(rule.keys, leftInHelsinki)})`).join(", ")}`;
process.stderr.write(`${[
  first <= last ? `logs (Helsinki time): ${clock(first)} .. ${clock(last)}` : `logs: none from ${firstDay} to ${lastDay}`,
  `visitors: ${visitors.size}, of them served from Helsinki: ${helsinki.size}`,
  `browsers on their first visit: ${firstVisits}, from Helsinki: ${firstInHelsinki}`,
  `visitors whose browser had been here before: ${returning.size}, from Helsinki: ${both(returning, helsinki)}`,
  `page views: ${pageViews}`,
  `reached the app page: ${app.size}, from Helsinki: ${both(app, helsinki)}`,
  "in brackets: of them served from Helsinki",
  ...groups.map(leftOutAs),
  ...Object.keys(lists).map(top),
].join("\n")}\n`);
process.stdout.write(`${csv.join("\n")}\n`);
JS
}

row() { # date time edge address method path status referrer browser query id host type: one log line
  printf '%s,%s,%s,1000,%s,%s,d1.cloudfront.net,%s,%s,%s,%s,%s,-,Hit,%s,%s,https,100,0.010,-,TLSv1.3,TLS_AES_128_GCM_SHA256,Hit,HTTP/2.0,-,-,443,0.010,Hit,%s,-,-,-\n' "$@"
}

refuses() { # logs-directory networks-directory words: the count fails, saying the words
  if count "$1" "$2" day 2026-11-19 2026-11-20 >/dev/null 2>"$tmp/refused.txt"; then
    echo "counted what it should have refused: $3" >&2
    return 1
  fi
  grep -qF -- "$3" "$tmp/refused.txt" || { cat "$tmp/refused.txt" >&2; return 1; }
}

self_test() {
  local logs=$tmp/logs networks=$tmp/networks header iphone windows mac bot linux linkedin console claude h i s
  header='date,time,x-edge-location,sc-bytes,c-ip,cs-method,cs\(Host),cs-uri-stem,sc-status,cs\(Referer),cs\(User-Agent),cs-uri-query,cs\(Cookie),x-edge-result-type,x-edge-request-id,x-host-header,cs-protocol,cs-bytes,time-taken,x-forwarded-for,ssl-protocol,ssl-cipher,x-edge-response-result-type,cs-protocol-version,fle-status,fle-encrypted-fields,c-port,time-to-first-byte,x-edge-detailed-result-type,sc-content-type,sc-content-len,sc-range-start,sc-range-end'
  iphone='Mozilla/5.0%20(iPhone;%20CPU%20iPhone%20OS%2018_6%20like%20Mac%20OS%20X)%20AppleWebKit/605.1.15%20(KHTML%2C%20like%20Gecko)%20Version/18.6%20Mobile/15E148%20Safari/604.1'
  windows='Mozilla/5.0%2520(Windows%2520NT%252010.0;%2520Win64;%2520x64)%2520AppleWebKit/537.36%2520(KHTML%252C%2520like%2520Gecko)%2520Chrome/142.0.0.0%2520Safari/537.36'
  mac='Mozilla/5.0%20(Macintosh;%20Intel%20Mac%20OS%20X%2010.15;%20rv:145.0)%20Gecko/20100101%20Firefox/145.0'
  bot='Mozilla/5.0%20(compatible;%20Googlebot/2.1;%20+http://www.google.com/bot.html)'
  linux='Mozilla/5.0%20(X11;%20Linux%20x86_64)%20AppleWebKit/537.36%20(KHTML%2C%20like%20Gecko)%20Chrome/142.0.0.0%20Safari/537.36'
  linkedin='Mozilla/5.0%20(Linux;%20Android%2015;%20Pixel%208)%20AppleWebKit/537.36%20(KHTML%2C%20like%20Gecko)%20Chrome/142.0.0.0%20Mobile%20Safari/537.36%20%5BLinkedInApp%5D/9.31.1'
  console='Mozilla/5.0%20(PlayStation%205%208.20)%20AppleWebKit/605.1.15%20(KHTML%2C%20like%20Gecko)'
  claude='Mozilla/5.0%20(Macintosh;%20Intel%20Mac%20OS%20X%2010_15_7)%20AppleWebKit/537.36%20(KHTML%2C%20like%20Gecko)%20Claude/6.28899.2%20Chrome/156.0.8078.100%20Safari/537.36'
  mkdir "$logs" "$networks"
  echo '{"status":"ok","data":{"prefixes":[{"prefix":"203.0.113.128/25","timelines":[]},{"prefix":"198.51.100.8/30"}]}}' >"$networks/AS64496.json"
  echo '{"status":"ok","data":{"prefixes":[{"prefix":"2001:db8:dc::/48"}]}}' >"$networks/AS64497.json"
  { # A from Google on an iPhone, then the app page; C scans from a data centre with B's browser
    # string and no style sheet; B is just below C's network; D is a bot; F is A the evening
    # before; E arrives through kunpa.fi from a tagged link; G on Linux from a network address,
    # H in LinkedIn's browser, I on a console at an odd path; J fetches only the icon; K and K6
    # come from data centres, K reading robots.txt too; L reads robots.txt, L2 a sitemap; M loads
    # ten pages in 60 seconds, N in 61 (its last first) from just below K's network; Q is the
    # Claude app's browser; R was marked with ?team the evening before, R2 is another browser at
    # R's address; T is two iPhones at one address, the first fetching its font in the hour after
    # its page, then one of them back; U comes back at a new address after a deploy renamed the
    # style sheet; V fetches the font on kuutti.app, then on kumpa.fi, its first lines read last
    echo "$header"
    row 2026-11-19 07:10:00 HEL51-P1 192.0.2.1 GET / 200 https://www.google.com/ "$iphone" - a1 kumpa.fi text/html
    row 2026-11-19 07:10:01 HEL51-P1 192.0.2.1 GET /_astro/site.css 200 https://kumpa.fi/ "$iphone" - a2 kumpa.fi text/css
    row 2026-11-19 07:20:00 HEL51-P1 192.0.2.1 GET /app/index.html 304 https://kumpa.fi/ "$iphone" - a3 kumpa.fi -
    row 2026-11-19 07:30:00 SIN2-C1 198.51.100.9 GET /.env 404 - "$windows" - c1 kumpa.fi text/html
    row 2026-11-19 07:30:01 SIN2-C1 198.51.100.9 GET / 200 - "$windows" - c2 kumpa.fi text/html
    row 2026-11-19 08:00:00 IAD89-C1 192.0.2.66 GET / 200 - "$bot" - d1 kumpa.fi text/html
    row 2026-11-19 08:00:01 IAD89-C1 192.0.2.66 GET /_astro/site.css 200 - "$bot" - d2 kumpa.fi text/css
    row 2026-11-18 21:00:00 HEL51-P1 192.0.2.1 GET / 200 - "$iphone" - f1 kumpa.fi text/html
    row 2026-11-19 22:30:00 HEL50-P2 2001:db8::5 GET /about/ 200 - "$mac" 'utm_source=Instagram&fbclid=abc' e1 www.kumpa.fi text/html
    row 2026-11-19 22:30:01 HEL50-P2 2001:db8::5 GET /_astro/inter.woff2 200 https://kumpa.fi/about/ "$mac" - e2 www.kumpa.fi font/woff2
    row 2026-11-19 07:50:00 ARN56-P1 203.0.113.7 GET / 200 http://172.16.0.1/ "$linux" - g1 kumpa.fi text/html
    row 2026-11-19 07:50:01 ARN56-P1 203.0.113.7 GET /_astro/site.css 200 https://kumpa.fi/ "$linux" - g2 kumpa.fi text/css
    row 2026-11-19 07:55:00 HEL51-P2 203.0.113.8 GET /app/ 200 android-app://com.linkedin.android/ "$linkedin" - h1 kumpa.fi text/html
    row 2026-11-19 07:55:01 HEL51-P2 203.0.113.8 GET /_astro/site.css 200 https://kumpa.fi/app/ "$linkedin" - h2 kumpa.fi text/css
    row 2026-11-19 08:10:00 FRA56-P3 203.0.113.9 GET /%C3%A4%C3%A4/ 200 - "$console" - i1 kumpa.fi text/html
    row 2026-11-19 08:10:01 FRA56-P3 203.0.113.9 GET /_astro/inter.woff2 200 - "$console" - i2 kumpa.fi font/woff2
    row 2026-11-19 08:20:00 FRA56-P3 203.0.113.10 GET / 200 - "$windows" - j1 kumpa.fi text/html
    row 2026-11-19 08:20:01 FRA56-P3 203.0.113.10 GET /favicon.png 200 - "$windows" - j2 kumpa.fi image/png
    row 2026-11-19 08:30:00 IAD89-C1 203.0.113.128 GET / 200 - "$linux" - k1 kumpa.fi text/html
    row 2026-11-19 08:30:01 IAD89-C1 203.0.113.128 GET /_astro/site.css 200 - "$linux" - k2 kumpa.fi text/css
    row 2026-11-19 08:30:02 IAD89-C1 203.0.113.128 GET /robots.txt 200 - "$linux" - k5 kumpa.fi text/plain
    row 2026-11-19 08:31:00 HEL51-P1 2001:db8:dc::9 GET / 200 - "$mac" - k3 kumpa.fi text/html
    row 2026-11-19 08:31:01 HEL51-P1 2001:db8:dc::9 GET /_astro/site.css 200 - "$mac" - k4 kumpa.fi text/css
    row 2026-11-19 08:40:00 FRA56-P3 203.0.113.11 GET /robots.txt 200 - "$windows" - l1 kumpa.fi text/plain
    row 2026-11-19 08:40:01 FRA56-P3 203.0.113.11 GET / 200 - "$windows" - l2 kumpa.fi text/html
    row 2026-11-19 08:40:02 FRA56-P3 203.0.113.11 GET /_astro/site.css 200 - "$windows" - l3 kumpa.fi text/css
    row 2026-11-19 08:45:00 FRA56-P3 203.0.113.12 GET /sitemap-index.xml 200 - "$windows" - l4 kumpa.fi application/xml
    row 2026-11-19 08:45:01 FRA56-P3 203.0.113.12 GET / 200 - "$windows" - l5 kumpa.fi text/html
    row 2026-11-19 08:45:02 FRA56-P3 203.0.113.12 GET /_astro/site.css 200 - "$windows" - l6 kumpa.fi text/css
    i=0
    for s in 00:00 00:05 00:10 00:15 00:20 00:25 00:30 00:35 00:40 01:00; do
      row 2026-11-19 "09:$s" FRA56-P3 203.0.113.13 GET / 200 - "$linux" - "m$((i++))" kumpa.fi text/html
    done
    row 2026-11-19 09:00:01 FRA56-P3 203.0.113.13 GET /_astro/site.css 200 - "$linux" - m-css kumpa.fi text/css
    i=0
    for s in 11:01 10:00 10:05 10:10 10:15 10:20 10:25 10:30 10:35 10:40; do
      row 2026-11-19 "09:$s" FRA56-P3 203.0.113.127 GET / 200 - "$windows" - "n$((i++))" kumpa.fi text/html
    done
    row 2026-11-19 09:10:01 FRA56-P3 203.0.113.127 GET /_astro/site.css 200 - "$windows" - n-css kumpa.fi text/css
    row 2026-11-19 09:20:00 HEL51-P1 192.0.2.50 GET / 200 - "$claude" - q1 kumpa.fi text/html
    row 2026-11-19 09:20:01 HEL51-P1 192.0.2.50 GET /_astro/site.css 200 - "$claude" - q2 kumpa.fi text/css
    row 2026-11-18 20:00:00 HEL51-P1 192.0.2.60 GET / 200 - "$mac" team r0 kumpa.fi text/html
    row 2026-11-19 09:30:00 HEL51-P1 192.0.2.60 GET / 200 - "$mac" - r1 kumpa.fi text/html
    row 2026-11-19 09:30:01 HEL51-P1 192.0.2.60 GET /_astro/site.css 200 - "$mac" - r2 kumpa.fi text/css
    row 2026-11-19 09:31:00 HEL51-P1 192.0.2.60 GET / 200 - "$iphone" - s1 kumpa.fi text/html
    row 2026-11-19 09:31:01 HEL51-P1 192.0.2.60 GET /_astro/site.css 200 - "$iphone" - s2 kumpa.fi text/css
    row 2026-11-19 09:59:59 HEL51-P1 192.0.2.70 GET / 200 - "$iphone" - t1 kumpa.fi text/html
    row 2026-11-19 10:00:00 HEL51-P1 192.0.2.70 GET /fonts/inter.woff2 200 - "$iphone" - t2 kumpa.fi font/woff2
    row 2026-11-19 11:30:00 HEL51-P1 192.0.2.70 GET / 200 - "$iphone" - t3 kumpa.fi text/html
    row 2026-11-19 11:30:01 HEL51-P1 192.0.2.70 GET /fonts/inter.woff2 200 - "$iphone" - t4 kumpa.fi font/woff2
    row 2026-11-19 12:00:00 HEL51-P1 192.0.2.70 GET / 304 - "$iphone" - t5 kumpa.fi -
    row 2026-11-19 12:00:01 HEL51-P1 192.0.2.70 GET /fonts/inter.woff2 304 - "$iphone" - t6 kumpa.fi -
    row 2026-11-19 13:05:00 HEL51-P1 192.0.2.80 GET / 200 - "$windows" - u1 kumpa.fi text/html
    row 2026-11-19 13:05:01 HEL51-P1 192.0.2.80 GET /_astro/site2.css 200 - "$windows" - u2 kumpa.fi text/css
    row 2026-11-19 13:05:01 HEL51-P1 192.0.2.80 GET /fonts/inter.woff2 304 - "$windows" - u3 kumpa.fi -
    row 2026-11-19 15:10:00 FRA56-P3 192.0.2.90 GET / 200 - "$mac" - v3 kumpa.fi text/html
    row 2026-11-19 15:10:01 FRA56-P3 192.0.2.90 GET /fonts/inter.woff2 200 - "$mac" - v4 kumpa.fi font/woff2
  } >"$logs/kumpa.fi-1.csv"
  { echo "$header"; row 2026-11-19 07:10:00 HEL51-P1 192.0.2.1 GET / 200 https://www.google.com/ "$iphone" - a1 kumpa.fi text/html; } >"$logs/kumpa.fi-2.csv"
  : >"$logs/kunpa.fi-0.csv"
  { echo "$header"; row 2026-11-19 22:29:59 HEL50-P2 2001:db8::5 GET /about/ 301 - "$mac" - e0 kunpa.fi -; } >"$logs/kunpa.fi-1.csv"
  { echo "$header"
    row 2026-11-19 07:40:00 IAD89-C1 198.51.100.7 GET / 200 - "$windows" - b1 kuutti.app text/html
    row 2026-11-19 07:40:01 IAD89-C1 198.51.100.7 GET /_astro/inter.woff2 304 - "$windows" - b2 kuutti.app -
    row 2026-11-19 14:00:00 FRA56-P3 192.0.2.90 GET / 200 - "$mac" - v1 kuutti.app text/html
    row 2026-11-19 14:00:01 FRA56-P3 192.0.2.90 GET /fonts/inter.woff2 200 - "$mac" - v2 kuutti.app font/woff2
  } >"$logs/kuutti.app-1.csv"

  # a failed count shows in the diffs below, its error in place of the summary
  count "$logs" "$networks" day 2026-11-19 2026-11-20 >"$tmp/day.csv" 2>"$tmp/day.txt" || true
  count "$logs" "$networks" hour 2026-11-19 2026-11-20 >"$tmp/hour.csv" 2>"$tmp/hour.txt" || true
  diff -u - "$tmp/day.txt" <<'EOF'
logs (Helsinki time): 2026-11-19 09:10 .. 2026-11-20 00:30
visitors: 11, of them served from Helsinki: 6
browsers on their first visit: 10, from Helsinki: 6
visitors whose browser had been here before: 2, from Helsinki: 1
page views: 24
reached the app page: 2, from Helsinki: 2
in brackets: of them served from Helsinki
left out as our own visits: the Claude app's browser 1 (1), marked with ?team 1 (1)
left out as crawlers: from data centres 2 (1), read robots.txt or a sitemap 2 (0), 10 pages within a minute 1 (0)
arrived through: kumpa.fi 10 (6), kuutti.app 2 (0), kunpa.fi 1 (1)
pages: / 8 (4), /app/ 2 (2), (other) 1 (0), /about/ 1 (1)
referring sites: (an address) 1 (0), com.linkedin.android 1 (1), www.google.com 1 (1)
devices: Windows 3 (1), iPhone 3 (3), Mac/iPad 2 (1), Android 1 (1), Linux/ChromeOS 1 (0), other 1 (0)
in-app browsers: LinkedIn 1 (1)
query parameters: fbclid 1 (1), utm_source 1 (1)
tagged links: utm_source=instagram 1 (1)
EOF
  diff -u "$tmp/day.txt" "$tmp/hour.txt"
  diff -u - "$tmp/day.csv" <<'EOF'
day,visitors,visitors_helsinki,first_visits,page_views,app_page_visitors
2026-11-19,10,5,9,23,2
2026-11-20,1,1,1,1,0
EOF
  {
    echo "hour,visitors,visitors_helsinki,first_visits,page_views,app_page_visitors"
    echo "2026-11-19T09:00,4,2,3,5,2"
    echo "2026-11-19T10:00,1,0,1,1,0"
    echo "2026-11-19T11:00,3,2,2,12,0"
    echo "2026-11-19T12:00,0,0,1,0,0"
    echo "2026-11-19T13:00,1,1,1,1,0"
    echo "2026-11-19T14:00,1,1,0,1,0"
    echo "2026-11-19T15:00,1,1,0,1,0"
    echo "2026-11-19T16:00,1,0,1,1,0"
    echo "2026-11-19T17:00,1,0,0,1,0"
    for h in {18..23}; do echo "2026-11-19T$h:00,0,0,0,0,0"; done
    echo "2026-11-20T00:00,1,1,1,1,0"
  } >"$tmp/want.csv"
  diff -u "$tmp/want.csv" "$tmp/hour.csv"

  count "$logs" "$networks" day 2026-11-21 2026-11-22 >"$tmp/none.csv" 2>"$tmp/none.txt" || true
  echo "logs: none from 2026-11-21 to 2026-11-22" | diff -u - <(head -1 "$tmp/none.txt")
  echo "day,visitors,visitors_helsinki,first_visits,page_views,app_page_visitors" | diff -u - "$tmp/none.csv"

  mkdir "$tmp/autumn" # summer time ends at 04:00 on 25 October 2026: the hour from 03:00 comes twice
  {
    echo "$header"
    row 2026-10-24 23:30:00 HEL51-P1 192.0.2.1 GET / 200 - "$iphone" - k1 kumpa.fi text/html
    row 2026-10-24 23:30:01 HEL51-P1 192.0.2.1 GET /_astro/site.css 200 - "$iphone" - k2 kumpa.fi text/css
    row 2026-10-25 01:30:00 HEL51-P1 192.0.2.1 GET /about/ 200 - "$iphone" - k3 kumpa.fi text/html
  } >"$tmp/autumn/kumpa.fi-1.csv"
  count "$tmp/autumn" "$networks" hour 2026-10-25 2026-10-25 >"$tmp/autumn.csv" 2>"$tmp/autumn.txt" || cat "$tmp/autumn.txt" >&2
  printf '%s\n' hour,visitors,visitors_helsinki,first_visits,page_views,app_page_visitors 2026-10-25T02:00,1,1,1,1,0 2026-10-25T03:00,1,1,0,1,0 |
    diff -u - "$tmp/autumn.csv"

  mkdir "$tmp/changed" "$tmp/broken"
  echo "date,time" >"$tmp/changed/kumpa.fi-1.csv"
  refuses "$tmp/changed" "$networks" 'has the log format changed'
  echo '<html>busy</html>' >"$tmp/broken/AS64496.json"
  refuses "$logs" "$tmp/broken" "AS64496.json: RIPEstat's answer has no list of networks"
  echo '{"data":{"prefixes":[]}}' >"$tmp/broken/AS64496.json"
  refuses "$logs" "$tmp/broken" "AS64496.json: RIPEstat lists no networks"
  echo '{"data":{"prefixes":[{"prefix":"203.0.113.0/33"}]}}' >"$tmp/broken/AS64496.json"
  refuses "$logs" "$tmp/broken" "AS64496.json: not a network: 203.0.113.0/33"
  echo "self-test passed" >&2
}

if [[ $self_test ]]; then
  self_test
  exit
fi

epoch() { date -u -j -f %Y-%m-%dT%H:%M:%S "$1" +%s 2>/dev/null || date -u -d "$1" +%s; }
iso() { date -u -r "$1" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d "@$1" +%Y-%m-%dT%H:%M:%SZ; }
days_before() { date -j -v-"$2"d -f %Y-%m-%d "$1" +%Y-%m-%d 2>/dev/null || date -d "$1 -$2 days" +%Y-%m-%d; }
valid() { [[ $1 =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "not a date: $1 (YYYY-MM-DD)" >&2; exit 2; }; }

last_day=${last_day:-$(TZ=Europe/Helsinki date +%Y-%m-%d)}
valid "$last_day"
first_day=${first_day:-$(days_before "$last_day" 6)}
valid "$first_day"
[[ ! $first_day > $last_day ]] || { echo "--since is after --until" >&2; exit 2; }

aws sts get-caller-identity --region "$region" >/dev/null 2>&1 ||
  { echo "no AWS session: pnpm aws:login (or aws sso login --sso-session kuutti)" >&2; exit 1; }
app_id=$(aws amplify list-apps --region "$region" --query "apps[?name=='$app_name'].appId | [0]" --output text)
[[ $app_id != None ]] || { echo "no Amplify app called $app_name in $region" >&2; exit 1; }
domains=$(aws amplify list-domain-associations --app-id "$app_id" --region "$region" --query 'domainAssociations[].domainName' --output text)

mkdir "$tmp/networks"
printf '%s\n' "${hosting_as[@]}" |
  xargs -P 6 -I % curl -sS --fail --retry 2 --max-time 120 -o "$tmp/networks/AS%.json" \
    "https://stat.ripe.net/data/announced-prefixes/data.json?resource=AS%&sourceapp=site-traffic" ||
  { echo "RIPEstat did not list the data centres' networks; try again in a while" >&2; exit 1; }
echo "fetched the data centres' networks" >&2

grab() { # domain from to depth: the window's log into $tmp/logs, a refused window in halves
  local domain=$1 from=$2 to=$3 depth=$4 url
  if url=$(aws amplify generate-access-logs --app-id "$app_id" --domain-name "$domain" --region "$region" \
    --start-time "$(iso "$from")" --end-time "$(iso "$to")" --query logUrl --output text 2>"$tmp/error"); then
    # The presigned address reaches curl through a pipe from a builtin, never as
    # an argument the process list shows, and is never printed.
    printf 'url = "%s"\n' "$url" | curl -sS --fail --max-time 300 -o "$tmp/logs/$domain-$from.csv" -K -
  elif grep -q 'reduce time range' "$tmp/error" && ((depth < 5)); then
    grab "$domain" "$from" $(((from + to) / 2)) $((depth + 1))
    grab "$domain" $(((from + to) / 2)) "$to" $((depth + 1))
  else
    echo "Amplify gave no log of $domain for $(iso "$from") .. $(iso "$to"):" >&2
    cat "$tmp/error" >&2
    return 1
  fi
}

mkdir "$tmp/logs"
now=$(date -u +%s)
start=$(($(epoch "${first_day}T00:00:00") - 3 * 3600)) # Helsinki's midnight is 21:00 or 22:00 UTC the evening before
end=$(($(epoch "${last_day}T00:00:00") + 86400))
end=$((end < now ? end : now))
for domain in $domains; do
  for ((from = start; from < end; from += 86400)); do
    grab "$domain" "$from" $((from + 86400 < end ? from + 86400 : end)) 0
  done
  echo "fetched the logs of $domain" >&2
done
count "$tmp/logs" "$tmp/networks" "$by" "$first_day" "$last_day"
