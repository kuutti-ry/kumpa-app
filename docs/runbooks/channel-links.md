# A channel's link and its printed code

A channel is one place Kumpa is handed out: a poster, a sticker, a partner's page or letter. Each gets a link of its own, so that the stores can count on their side how many installs came through it. The API keeps nothing of who followed which link: no row, no log line naming the channel, nothing in the app (#653, #768, ADR-044 §13). The website's access log does hold each scan of a printed code, as it holds every visit to the site: the path with the channel, the visitor's address and the phone's User-Agent, which Amplify keeps until the app is deleted (`infra/README.md`, The website). This runbook covers:

- how a channel's link and its printed code are made;
- the website's rule that carries the printed address;
- where the numbers are read, and what hides them;
- how a code is checked before it goes to print.

## The link

The link is `https://kumpa.fi/q/<channel>`, on paper and anywhere else. `<channel>` is one to thirty lower-case letters a to z, digits and hyphens (thirty is Apple's limit for a campaign): `2027-posters`, not `Posters 2027`.

There is no list of channels anywhere. A name exists by being handed out, and a name somebody makes up only stays under the stores' thresholds. Choose names that say nothing about the people who would follow them: the stores show the name next to its numbers, and the website's access log keeps it beside each visitor's address. A code for an evening whose audience says something about the people there is named for the date or the place, never for what the evening is about.

Where the link goes:

1. The website answers 302 to `https://api.kumpa.fi/i?from=<channel>` (the rule below).
2. The API's one link answers 302 by the phone (`apps/api/src/rewards/link.ts`):
   - An iPhone or iPad goes to the App Store with Apple's campaign tokens, `pt=<provider token>&ct=<channel>&mt=8`, once `APP_STORE_PROVIDER_TOKEN` is set, and untagged until then.
   - An Android phone goes to Play with `referrer=utm_source%3D<channel>`: the channel is the UTM source inside the install referrer.
   - Anything else goes to `https://kumpa.fi/`. So does a phone whose store has no listing yet.

The API drops a name of the wrong shape, and the phone goes to its store untagged. A channel never rides beside an invitation's code: `/i/{code}?from=…` drops the channel.

The app never sees the channel. An iPhone cannot pass it on, and on Android the app's reader of the referrer takes only what reads as an invitation code, which `utm_source=…` never does.

The printed address is the website's, not the API's, so a printed code outlives a move of the API's host: the rule's target changes and the print does not. `kuutti.app/q/<channel>` answers the same, from the same Amplify app.

## The code

```bash
pnpm qr -- <channel>
```

This writes `qr-<channel>.svg` in the folder it was run from (`pnpm qr -- <channel> --out <dir>` puts it in `<dir>`). The file holds the printed address as a vector QR code:

- black on white, at error correction M;
- with the four modules of quiet zone the standard asks for;
- with the address as the file's title.

Nothing else is in the file. The address in words, the size and the place on the page belong to the print's layout (#415).

The script refuses a name the link would drop, and sends nothing anywhere (`scripts/qr.ts`). `node scripts/qr.ts --self-test` runs in CI's lint job.

- **Size.** At least 2 cm a side including the quiet zone, and about a tenth of the reading distance: 2 cm at arm's length, 10 cm on a poster read from a metre away. Print nothing in the white margin.
- **The address in words** beside the code, `kumpa.fi/q/<channel>`, for a camera that does not read it and for anyone who would rather type.
- **Before print,** scan the proof with an iPhone's camera and with an Android phone's. Each should open its store (before the listings, `kumpa.fi`), and the address typed into a computer's browser should land on `kumpa.fi`.
- **An address with a slash after the name** (`/q/<channel>/`) answers 404. The script never writes one, so watch for it only when typing the address by hand.

## The website's rule

The website is the Amplify app `kumpa-app-site` in eu-central-1. Its redirects are the app's custom rules, set with the CLI (`infra/README.md`, The website, which has the full command for all seven rules). Two of the rules are for channels, after the hosts' redirects and the status rewrite:

```json
{"source": "/q/<channel>", "target": "https://api.kumpa.fi/i?from=<channel>", "status": "302"}
{"source": "/q", "target": "https://api.kumpa.fi/i", "status": "302"}
```

Amplify puts the path's name into the target's query as it was sent: `kumpa.fi/q/x%26pt%3D1` arrives as `from=x%26pt%3D1`, which the API drops. A query on `/q/<channel>` is not carried on. `/q` alone forwards its own query, so `kumpa.fi/q?from=<channel>` works too. The rules were set on 2026-11-28 and checked that day with the three kinds of User-Agent on both hosts:

```bash
for h in kumpa.fi kuutti.app; do curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' "https://$h/q/channel-7"; done
```

Each line should read `302 https://api.kumpa.fi/i?from=channel-7`.

## The provider token

Until Apple's provider token is configured, an iPhone goes to the App Store untagged. Its install counts, but under no campaign. App Store Connect generates the token only once the app has analytics data, so not before the opening:

1. In App Store Connect, under the app's Analytics, Acquisition, Campaigns, generate a campaign link. The link carries `pt=<digits>`: that number is the team's provider token, the same for every campaign. It is public, since every campaign link shows it.
2. The maintainer sets it for production:
   ```bash
   aws ssm put-parameter --name /kuutti/prod/app-store-provider-token --type String --value <the digits>
   ```
   The API reads it at its next start. Staging needs it only to try the tagging there.
3. Check that an iPhone's User-Agent gets the tags:
   ```bash
   curl -s -o /dev/null -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X)' -w '%{redirect_url}\n' 'https://api.kumpa.fi/i?from=channel-7'
   ```
   The answer is the App Store's address with `pt`, `ct=channel-7` and `mt=8`.

Links handed out before the token keep working, and start counting once it is set.

## Where the numbers are, and what hides them

- **App Store Connect**, the app's Analytics, Acquisition, Campaigns: product page views and first-time downloads per campaign, named by `ct`. A campaign shows only after 24 hours and five first-time downloads, each within 24 hours of the tap. Whether Apple counts people who do not share analytics was not confirmed (10/11/2026): read the first numbers against Play's.
- **Play Console**, the store listing acquisition report: visitors and installs by UTM source, which is the channel. Small sources are grouped as "Other".
- **Neither store** needs an SDK, an identifier or a consent prompt, and both show only totals. A computer's visit is in neither: it lands on the website, whose visitor counts never name a channel (`infra/scripts/site-traffic.sh`).

Kumpa does not count clicks itself. That would cover channels under the stores' thresholds and visits from a computer, and it is not built until the maintainer asks for it (#653, question 1).
