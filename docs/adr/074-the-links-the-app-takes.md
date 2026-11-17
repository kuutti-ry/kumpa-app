# ADR-074: The links the app takes: the bank's return on https, and an invitation's link

- Status: proposed (#184, built as written here in the pull request for #184's native batch, on the maintainer's word of 2026-11-17 in chat on the native name and on what rides along; nothing is verified until the parameters of Open 1 are set and the App ID has its capabilities, which are his; accepting it is the maintainer's)
- Date: 2026-11-17
- Follows: TD-1 (every account is a bank login, so the code that ends one has to reach the person's own app), TD-2 (Expo and EAS are the native shell: a native change orphans every installed build, so native changes go together), ADR-026 §4 (which refusals of the limiter are redirected), ADR-027 (the code bound to the phone, What it does not close, and §5's random source), ADR-044 §13 (the one link of an invitation), ADR-045 §3 (the lock's salt), ADR-056 §4 (no screenshot is noticed), ADR-057 and ADR-063 (the store builds and the version they show), ADR-069 (App Attest, and its module in a build), ADR-072 (two names for every host), CLAUDE.md rule 8 (no web surface); issues #184, #36, #574, #580, #700. It amends ADR-027 §5, ADR-044 §13 and ADR-045 §3, and carries out what ADR-057, ADR-063 and ADR-069 left for a native batch

## Context

The bank login ends in the phone's browser, and the browser hands the app a one-time code. Until now that hand-over was the scheme `kuutti://auth?code=…`. Any Android app can declare a scheme, so ADR-027 bound the code to the phone that started the login, and named what would make the doors it left harder: links the system has verified as this app's, which reach no other app.

The API has served the two files such links need since #36 (`assetlinks.json` and `apple-app-site-association`, from configuration), but the parameters behind them were set nowhere, the app claimed no link, and nothing answered at the address the files were for. Claiming a link is a line of `app.json`, and any change there moves the native fingerprint and orphans every installed build. #184 collected what needs a new binary so that this happens once.

By 17/11/2026 the batch held, from the issue and its comments:

- the verified links and their https side, with #184's Done-when: a used or forged code shows the app's own words and never a raw error, and nothing of the code reaches Sentry;
- the invitation link's native half (ADR-044 §13): the one link `api.<host>/i/{code}` sends a phone to its store, and an installed app was to take the code from it, as from Play's install referrer on Android;
- App Attest's two lines (ADR-069: the module and the entitlement; everything else is on `main`);
- the store version, `0.0.0` in `app.json` while the counted version had passed 0.126;
- lines other records left for a native batch: `expo-crypto` for the sign-in's verifier and the lock's salt (ADR-027 §5, ADR-045 §3), the Expo template's `SYSTEM_ALERT_WINDOW` (ADR-057), and React Native's deprecated Clipboard behind Copy in a conversation.

Every host has two names while `kuutti.app` and `kumpa.fi` both answer (ADR-072), and one build serves staging and production, since a build profile carries no native configuration (ADR-057 §8).

Asked on 17/11/2026, the maintainer answered: the native name is **Kumpa** (#700), and all three of the lines other records left ride along.

## Decision

1. **The app claims two paths on the API's four hosts.** `/auth/return`, exactly, and everything under `/i/`, on `api.kumpa.fi`, `api.kuutti.app`, `api.staging.kumpa.fi` and `api.staging.kuutti.app`: `ios.associatedDomains` (`applinks:`) and one Android intent filter with `autoVerify` in `apps/mobile/app.json`. `/i` alone is not claimed: it is the store's link for somebody without a code. The API's files say the same: the AASA's components are `/auth/return` and `/i/*`, and `assetlinks.json` delegates the package's links as before (`apps/api/src/identity/links.ts`). A test reads `app.json` and holds its hosts, paths, package and bundle to that file's constants (`links.test.ts`), so the two cannot drift apart unseen.

2. **The bank's return is https where the API serves that platform's file.** After a login that is let in, `/auth/callback` redirects to `https://<the registered callback's host>/auth/return?code=…` when the attempt's platform (the one `/auth/start` recorded) has its parameter: `ANDROID_CERT_FINGERPRINTS` for Android, `IOS_TEAM_ID` for an iPhone. Otherwise it redirects to `kuutti://auth?code=…`, as before (`verifiedReturns`, `appReturnUrl`). A callback that is not https, a developer's own computer, has no https return whatever is set: no phone verifies such a link, and the code would cross the network in the clear. The host is the registered callback's (`OIDC_REDIRECT_URI`), never the request's own. So the parameter is the switch, per platform and per environment: setting it serves the file and moves the return, removing it moves both back, and neither needs a build. A refusal keeps the scheme (`kuutti://auth?error=…`): it carries nothing secret, and it has to reach the app on a phone where no link verifies.

   In the app the link is the scheme's return under another address. `app/+native-intent.ts`, which every link from outside passes first, turns `https://<host>/auth/return?…` into the app's own `/auth?…` (`signInReturnPath`, `apps/mobile/src/features/identity/return-link.ts`): the same screen, with the same guards, so a return this phone did not start is refused as it always was (ADR-027 §1).

3. **`GET /auth/return` on the API is the fallback.** A phone that did not hand the link to the app leaves it in the browser: a build from before the links, a link the system has not verified yet, a browser that keeps its own links. The route sends the browser on to the scheme, where the callback sent it before: `302` to `kuutti://auth?code=…` when the query's code has a one-time code's shape, and to `kuutti://auth?error=auth_code_used` for anything else, the refusal every bad code gets, so the person reads the app's sentence and no JSON is left in a tab. `cache-control: no-store`. It is a door for a browser, not a page: nothing is looked up, nothing is kept, and the request's log line names the route, never the query. A code is still spent only by the exchange, with this phone's verifier.

4. **An invitation's link leaves its code on the phone** (ADR-044 §13, amended here). The maintainer's, of 07/11/2026 (#184's comment, #574): an installed app takes the code from `/i/{code}`, keeps it across the bank login and puts it in the code's field; on Android, Play's install referrer is read into that field at first start.

   - A link `https://<host>/i/<something>` handed to the app goes home, where somebody not signed in meets the bank login. If what it carries reads as a code by the schema's normaliser, the app keeps it (`takeInvitationLink`, `apps/mobile/src/features/rewards/held-code.ts`), in the phone's secure store, through the preferences (`invitationCode`). One code at a time, the newest link's.
   - With none held, an Android phone asks Play once what the install came with (`expo-application`'s `getInstallReferrerAsync`), the first time the code's field is about to show. An answer is asked for again only after a failure; an answer that is no code, an organic install's words included, is dropped unkept.
   - The code is put in the field (`RedeemInvitation.tsx`), in its two groups, unless the person typed first. Nothing is redeemed by itself and nothing is sent before Use the code: a link is somebody else's words and a tap on one is no decision, and a redeem spends one of the day's tries.
   - The held code goes after a code that worked, whichever it was, since a person takes one invitation; and after `invitation_unknown` or `invitation_not_for_you` when it was the held code that was refused, so a dead code is not offered twice. It stays through a day's tries run out, a failure on the way and the refusal of another code.

   Following from that, the agent's and not put to him: any path under `/i/` goes home, with a code kept only if it reads as one; the newest link wins; Play is asked when the field first shows and not at the app's start, so nothing is asked of Play for somebody who is never offered the field; the two refusals that drop the code; that the link leads home and not to the field (Left out).

5. **A link's host is not looked at in the app.** The system hands over only links on the hosts `app.json` names, once verified; an app that addresses this one directly can name any host it likes, and a check of the host would stop neither. What is bounded is what a link may do: a return goes through the sign-in's guards and its code works only with this phone's verifier, and an invitation's link fills a field.

6. **Nothing of a code is recorded.** The API logs the route's name for `/auth/return` and for `/i/{code}`, never the address. The app's Sentry drops any integration that records a link from outside (`src/lib/sentry.ts`: today the SDK's deep-link integration is opt-in, and the filter keeps it off if a later version makes it a default), and a console line goes from the breadcrumbs whole (`stripBreadcrumb`), since the router's warning about a link it could not open quotes the link. The held code is in no log line, breadcrumb or report, and a failure to read or write it is reported with the error alone, as every preference's is.

7. **What else the batch carries.**
   - **The store version** is the counted version: `app.json`'s `version` is the root `package.json`'s at this pull request (CLAUDE.md, Versioning), which ends ADR-057's and ADR-063's `0.0.0`.
   - **App Attest in a build** (ADR-069): `@expo/app-integrity` pinned at 57.0.2 among the app's dependencies, never imported, and the entitlement `com.apple.developer.devicecheck.appattest-environment` as `production`. Nothing else: the app's half already reaches the module by its name.
   - **The native name is Kumpa** (the maintainer, 17/11/2026, #700): `app.json`'s `name`, the photo picker's permission text and the Face ID purpose in three languages. The bundle and package identifier, the scheme and the slug stay.
   - **`expo-crypto`** (ADR-027 §5 and ADR-045 §3, amended here): the sign-in's verifier is 32 bytes and the lock's salt 16 bytes of `getRandomValues`, the system's generator (SecRandomCopyBytes on iOS, SecureRandom on Android), as lowercase hex. The formats stay, so the API does not change. `getRandomValues` and not `getRandomBytes`, which falls back to `Math.random` in a development build without a synchronous bridge. The SHA-256 stays `@noble/hashes`: `expo-crypto`'s digest is asynchronous, and the challenge is computed where the code is synchronous.
   - **`SYSTEM_ALERT_WINDOW` is out of the manifest** (`android.blockedPermissions`), which nothing used (ADR-057, Consequences).
   - **`expo-clipboard`** in place of React Native's deprecated Clipboard behind Copy in a conversation (`SharedContacts.tsx`). Its answer is awaited, so "copied" is said once the phone has taken the value, and a copy that failed says nothing and leaves no line of an earlier one.

   The four packages are Expo's own, MIT, in the SDK's range, with no install script.

## Consequences

- **Nothing changes at a sign-in until a parameter is set.** Both files answer 404, the callback returns on the scheme, and a link under `/i/` opens the browser and goes to the store as before. The first build from this change can therefore be installed and tried before anything is switched.
- **An older build keeps signing in after the switch.** Its return stays in the browser, and the fallback of §3 sends it on to the scheme.
- **Android 11 and older verify an app's hosts together or not at all.** A phone on those versions hands the app no link until every host of the filter serves its file, so staging's phones on them wait for production's parameter too, and for both names of each. The fallback covers them meanwhile. Android 12 and later verify each host by itself.
- **One build claims staging's and production's hosts.** A staging build opens a production invitation's link and keeps its code; typed there, staging's API does not know it, and the code is dropped. A return for another environment was not started on this phone and is refused.
- **What ADR-027 left open narrows, and does not close.** Where a platform's parameter is set and the link verifies, the code no longer travels on a scheme another app can declare, and an attempt another app started in the phone's browser returns to Kumpa, which refuses a return it did not start. An app that shows the bank's page in a view of its own still reads the code off the redirect, whatever its address, and the fallback of §3 still ends on the scheme. Proving that the caller is the real app is ADR-069's.
- **Whether a browser hands this redirect to the app is seen only on a phone.** The return is a redirect from `/auth/callback` to `/auth/return` on the callback's own host, and a phone's browser may keep a link it reached that way to itself. Where it does, the return ends on the scheme through §3, as today, and nothing is narrowed on that platform. A bank login on a real phone of each platform says which (`docs/runbooks/devices.md`), and the security checklist's line stays open until then.
- **The code rides in an https address** on its way from the callback, which the browser may keep in its history like the bank's own return before it. It lives sixty seconds, is spent once, and works only with the verifier of the phone that started the login.
- **A held code stays on the phone, and only there.** The API holds nothing new: no table, no column, nothing in the export, nothing for erasure to remove. Like every preference it outlives a sign-out and the deletion of the account, and on an iPhone the keychain keeps it across a reinstall. It names nobody, the API knows it only by a one-way fingerprint, and it is of no use to an account that may not take a code. On a phone two people use, a code one of them took from a link is offered to whoever reaches the field first, to use, change or clear.
- **Anybody's link fills the field.** A link somebody else sent, or another app that addresses this one, replaces the code the phone held, and the field does not say where its code came from. The person's own press still decides, so what it can cost is the one invitation a person takes, used on a stranger's code.
- **An address past its rate limit is answered 429 in JSON at `/auth/return`**, as at `/auth/callback`: ADR-026 §4 redirects the limiter's refusal at the two sign-in starts alone. One return per login stays far under the limit.
- **Every installed build is orphaned once more**: the merge moves the fingerprint of both platforms and starts one Android development build by itself (`eas-build.yml`); the store builds are the maintainer's to dispatch.

## Left out on purpose, and what would make it needed

- **A refusal on the verified link.** It would save nothing: a refusal carries no secret, and on the scheme it reaches every phone.
- **Leading a signed-in person from the link to the code's field.** Somebody new meets the field in onboarding with the code in it. Somebody whose profile is complete cannot use a code, and for the few in between the field is in Settings, filled in. A route of its own would be due if testers lose the code on the way.
- **A Maestro flow for the https links.** The flows run on a build that claims the links, which exists only after this merge; `sign-in-links.yaml` keeps holding the scheme's return, and the hook's wiring is held by `routes.test.tsx`.
- **`expo-system-ui`**, which `userInterfaceStyle` asks for on Android and `knip.ts` leaves to the maintainer: not in #184's list and not asked on 17/11/2026 (Open 3).
- **The native libraries' licences on the licences screen** (#419's Open 2), **`@expo/cli`** (#431) and **the phone's own nudity check** (#48): each a change of its own, none decided for this batch.

## Open, the maintainer's

1. The parameters, per environment, and a restart of the API after each: `/kuutti/staging/android-cert-fingerprints` (EAS's and Play's fingerprints, `docs/vendors/google-play.md`) and `/kuutti/staging/ios-team-id`, then production's pair. Until then nothing is verified (`docs/runbooks/devices.md`, Verified links).
2. The App ID's capabilities, Associated Domains and App Attest: they reach the provisioning profile only through an interactive `eas credentials` with his Apple sign-in, never from CI, so the first iOS build from the batch comes after that step.
3. Whether `expo-system-ui` goes into a later native change.
4. Whether `/auth/return` should refuse an address past its limit in the app's words, as the two starts do (ADR-026 §4).
5. Accepting this record.

## Alternatives considered

- **The https return everywhere, with no switch.** The fallback would carry every phone whose link does not verify, so it would work; it would also put a second redirect in every sign-in of an environment that serves no file, for nothing, and leave no way back but a deploy.
- **A page at `/auth/return` with a button that opens the app.** A page of the product on the web (rule 8), with the code in its address for as long as the tab stays open. A redirect needs neither.
- **Routes of the app's own for the two links** (`app/auth/return.tsx`, `app/i/[code].tsx`). The return would be a second screen for one job, and an invitation's code would pass through the router, its state and whatever records a navigation. The hook takes both before the router sees them.
- **Redeeming the code at the link.** A tap on a link would spend a try, and take the one invitation a person may ever use, without their word.
- **Keeping the code in memory alone.** Android may end the app while the bank's browser is in front, and the code has to outlive the sign-in.
- **Checking the link's host against the API's address.** §5: the system already chooses which links arrive, and a direct intent can name any host.
- **Reading Play's referrer at the app's first start.** It would ask Play about every install, also of somebody who is never offered the field, and before anything in the app needs the answer.
- **`expo-crypto`'s digest in place of `@noble/hashes`** (ADR-027 §5 had expected it): asynchronous, for a hash the code computes synchronously in two places, and one library fewer is not worth the rewrite.

## History

- 2026-11-17: written with #184's native batch, on the maintainer's answers of that day in chat (the name Kumpa; all three of the lines other records left for a batch). ADR-027, ADR-044 and ADR-045 are amended the same day, and ADR-057, ADR-063 and ADR-069 note what was carried out.
