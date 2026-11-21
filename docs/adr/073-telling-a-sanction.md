# ADR-073: Telling a person of a sanction: what, why, and how to contest it

- Status: accepted 2026-11-17 (#715, the maintainer's word "Accept ADR-073" in a session of that day; built as written here on his decisions of that day; the points under "Open, the maintainer's" are his to confirm or change), amended 2026-11-21 (§3: the address to write to is `hello@kumpa.fi`, the website's, #715; see History)
- Date: 2026-11-17
- Follows: TD-5 (moderation and the audit log), TD-7 (the standing on the identity, refused at the callback), TD-18 (no mail without a reason; the optional e-mail; notifications), ADR-024 (§3 the second look, §6 what a shadow ban withholds; §7 and §8 amended here), ADR-032 (§2 and §3 amended here: a moderator's shadow ban's notice), ADR-033 (a rule's shadow ban stays untold; §6's review hours amended here), ADR-041 (the velocity rules, untold as ADR-033's are), ADR-043 (§1 amended here: a confirmed address receives a sanction's statement), ADR-068 §5 (the announcement's mail, whose shape this follows), ADR-030 §9 (a reporter is never named), CLAUDE.md rule 8 (no link in a mail) and Product constraints (every tunable in `matching_config`); issues #715, #105, #307, #176, #190

## Context

The panel has asked for a reason since #307: a closed list (harassment, misrepresentation, under age, commercial use, scraping, other), required at every sanction, with staff's note beside it. What the person learned of it varied. A warning's notice said its reason. A suspension and a ban were refused at the bank login with no reason. A shadow ban was told to nobody, from any route (ADR-024 §7, #105), and the export left an open one out (ADR-024's open point on GDPR Art. 15 and the DSA).

#715 asks that each sanction be told to its person politely: what was done, why, the rule it rests on, and how to contest it. The DSA's Art. 17 asks the same of a hosting provider, and its Recital 55 names shadow banning. The maintainer's reading, 2026-11-17: the DSA's information society service is one "normally provided for remuneration", and Kumpa asks nobody for money, so the regulation is not stretched to cover it. People may contest all the same. The statement below follows Art. 17's elements as good practice, without its transparency database or its formal internal complaint system.

## Decision

1. **The statement.** Every sanction staff applied tells its person, in the app's words from `messages.yaml` and never in staff's note (which may name a reporter, ADR-024 §8):
   - what it does: the warning's, the shadow ban's, the suspension's with its day, the ban's;
   - why: the reason of the closed list chosen in the panel, in the words the export gives it;
   - the rule of the terms the reason rests on: a section of the terms of use in its own words shortened (§3 for under age, §4 for the others, §6 for `other`);
   - that a moderator decided;
   - how to contest it (§3).

   One function turns a sanction's reason into these lines, `sanctionStatement` in `packages/i18n`, for the phone and the API alike, as `describePhoto` does for the photo descriptions.
2. **Where each kind is told.**
   - A warning: its notice (ADR-032 §3), now with the statement.
   - A moderator's shadow ban: at once (the maintainer, "Tell it at once", 2026-11-17). It gets a notice of its own kind, `shadow_ban`, written in the sanction's transaction and pointing at its sanction, carrying the reason. One lifted since is not shown, as a warning's is not. The export lists it while it is open.
   - An automatic rule's shadow ban: never, whether it is open, kept or reversed (the maintainer, 2026-11-17: a rule only puts the person in the moderators' queue, with no notice). The terms' §6 and the privacy policy's automated decisions say that a rule limits what others see without notice until a moderator has reviewed the account, and that stands. A moderator who finds more than the rule saw applies a sanction of their own, which is told. The export lists a rule's ban only once it is lifted, and the reports rule's never, since its time is the last report's, which ends the reporter's conversation in the same moment and so names the reporter (ADR-030 §9, §12; `listSanctionsOfAccount` in `safety/sanctions.ts`).
   - A suspension and a ban: the bank login's refusal carries the reason (`&reason=` beside `&until=`, from the newest open sanction of that kind on the identity), and the sign-in screen says the statement under the refusal. Only a reason of the closed list is shown, so a crafted link shows nothing more. A moderator always decided these two.

   What a shadow ban does is unchanged: the person is hidden from everyone else as before (ADR-024 §6, ADR-033), and `GET /onboarding` still reads the state as `active`, since the app routes by it. Only what the person is told changes.
3. **How to contest it.** Each statement ends the same way: write to `hello@kumpa.fi`, for now (the maintainer, 2026-11-17; the address is the website's, `hello@kuutti.app` until his word of 2026-11-21). Someone other than who decided looks at it again, through ADR-024 §3's second look in the panel. The statement names no court (the maintainer dropped the sentence, 2026-11-17). There is no form in the app: mail is enough for five thousand people, and a form would need data and a retention of its own.
4. **The email** (the maintainer, "E-mail it too", 2026-11-17). Each sanction staff applied is mailed once, after it commits, to its account's confirmed address. It goes in the language the person read the terms in, whatever the notification switches say, from the one sender every mail has (ADR-043). It is plain text with no link (rule 8): a subject for each kind, what it does, the statement, why the person gets it, and the signature. Like an announcement, it is a service message about the person's own account and sits outside #196's consents (ADR-068 §5).
   - A sanction lifted before the send, or an account erased by then, gets nothing.
   - A failure is logged with the account, the kind and `MailFailed`'s reason and status, never the address, and nothing is retried.
   - The mail leaves from the push's background (`push.sanction`, the notifications slice's), after the answer that applied the sanction, so no answer's time says whether anybody was mailed. `app.ts` hands it to the panel's two apply routes alone.
   - A lift and a review send nothing; a lift takes the notice away.
5. **The panel says it.** Each sanction step says what the person is told and that the note is not. The automatic shadow bans' confirm and reverse keep saying that the person is not told.
6. **The data.** `notice_kind` gains `shadow_ban` (migration `0010_shadow_ban_notice`). The notice's checks are written in the old kinds, because Postgres refuses a new enum value in the transaction that adds it: a sanction's notice is any kind that is neither an invitation's nor an announcement's. Nothing new is held about the person. The notice is erased and exported as every notice is (ADR-032 §5), and the mail keeps no copy.
7. **The review hours.** ADR-033 §6's `auto_shadow_ban_review_hours` goes from 48 to 168, a week (the maintainer, "7 days (168 h)", 2026-11-17), as the key's next version written by migration `0011_shadow_ban_review_week` (its SQL in ADR-033's History). Reports keep their own 24 hours, `moderation_response_hours`. Nothing the person is told names the hours.

## Consequences

- A moderator's shadow ban no longer hides itself from its owner. A rule's still does, so against scraping the rules keep their secrecy until a moderator looks.
- Nobody is told that they were reported by way of a rule: the reports rule tells nothing, and who reported stays told to nobody (ADR-030 §9).
- The terms' §6 and the privacy policy's automated decisions stand as written, so neither needs a new version. The policy's purposes already name notices about the service in Kumpa and by e-mail on a legitimate interest, and its retention keeps warnings and restrictions that have ended until the account is deleted: the notice and the mail fall under both as they read (version 2026-11-1).
- A moderator's decision now reaches an address the person confirmed. The mail names no reporter, no conversation and no other person, as the notice does not.
- The bank login's refusal names its reason in the deep link, and the refusal's log line carries the reason's code; no note and no person reach either.
- A rule's ban may hide a person for up to a week before it reads as Late on the list and the front page; past that it still stays until a moderator decides.
- Today's English is the agent's; the Finnish and the Swedish are machine text, flagged for a native review (`pnpm i18n:review`).

## Open, the maintainer's

1. A way to contest from the app, if mail turns out not to be enough.
2. The export's leaving out a rule's open ban and every ban of the reports rule (§2). The first follows the terms' "without notice until a moderator has reviewed"; the second reads GDPR Art. 15(4)'s limit where a copy would affect another person's rights: the reporter, named by the ban's moment.

## Alternatives

- **The DSA's Art. 17 as binding**, with its full statement, the Commission's transparency database (Art. 24(5)) and Art. 20's internal complaint system: not stretched to a service that asks no money (the maintainer, 2026-11-17).
- **A rule's shadow ban told at once**, with the kind of rule that applied it and when a moderator would look, the reports rule's only once a moderator kept it: built first, then set aside the same day. A rule only queues the person for a look, and the terms say it acts without notice.
- **A rule's shadow ban told once a moderator keeps it**: a keep confirms what the rule saw and adds no decision of the moderator's own, so it stays untold (the maintainer, 2026-11-17).
- **A court named in the contest**: dropped (the maintainer, 2026-11-17).
- **A form in the app to contest**: mail is enough at this size, and a form would need data of its own.
- **The mail under the Moderators' decisions switch**: a decision about the person's own account is told whatever the switches say.
- **Staff's note in the statement**: never. It may name a reporter or quote a conversation (ADR-024 §8, ADR-030 §9).

## History

- 2026-11-17: written with #715, telling every shadow ban, the reports rule's once a moderator kept it. The same day, on the maintainer's word: a rule's shadow ban is never told, the court sentence goes, `hello@kuutti.app` stands for now, and the review hours go to 168 (§2, §3, §4, §7).
- 2026-11-17: accepted on the maintainer's word, "Accept ADR-073", in a session of that day, as it stands after the same day's changes (PR #719).
- 2026-11-21: §3's address is `hello@kumpa.fi`, on the maintainer's word in a session of that day, which moved the website's public address from `hello@kuutti.app` (the website's decision 37). The statement names it in the app, at the bank login and in the mail, in all three languages (PR #742).
