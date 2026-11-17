# ADR-073: Telling a person of a sanction: what, why, and how to contest it

- Status: proposed (#715, built as written here on the maintainer's decisions of 2026-11-17 in a session; the points under "Open, the maintainer's" are his; accepting this record is his)
- Date: 2026-11-17
- Follows: TD-5 (moderation and the audit log), TD-7 (the standing on the identity, refused at the callback), TD-18 (no mail without a reason; the optional e-mail; notifications), ADR-024 (§3 the second look, §6 what a shadow ban withholds; §7 and §8 amended here), ADR-032 (§2 and §3 amended here: a shadow ban's notice), ADR-033 (amended here: an automatic shadow ban is told), ADR-041 (the velocity rules, told by their kind), ADR-043 (§1 amended here: a confirmed address receives a sanction's statement), ADR-068 §5 (the announcement's mail, whose shape this follows), ADR-030 §9 (a reporter is never named), CLAUDE.md rule 8 (no link in a mail) and Product constraints (every tunable in `matching_config`); issues #715, #105, #307, #176, #190

## Context

The panel has asked for a reason since #307: a closed list (harassment, misrepresentation, under age, commercial use, scraping, other), required at every sanction, with staff's note beside it. What the person learned of it varied. A warning's notice said its reason. A suspension and a ban were refused at the bank login with no reason. A shadow ban was told to nobody, from any route (ADR-024 §7, #105), and the export left an open one out (ADR-024's open point on GDPR Art. 15 and the DSA).

#715 asks that each sanction be told to its person politely: what was done, why, the rule it rests on, whether it was automatic, and how to contest it. The DSA's Art. 17 asks the same of a hosting provider, and its Recital 55 names shadow banning. The maintainer's reading, 2026-11-17: the DSA's information society service is one "normally provided for remuneration", and Kumpa asks nobody for money, so the regulation is not stretched to cover it. People may contest all the same. The statement below follows Art. 17's elements as good practice, without its transparency database or its formal internal complaint system.

## Decision

1. **The statement.** Every sanction tells its person, in the app's words from `messages.yaml` and never in staff's note (which may name a reporter, ADR-024 §8):
   - what it does: the warning's, the shadow ban's, the suspension's with its day, the ban's;
   - why: the reason of the closed list, in the words the export gives it;
   - the rule of the terms the reason rests on: a section of the terms of use in its own words shortened (§3 for under age, §4 for the others, §6 for `other`);
   - who decided: a moderator, or an automatic rule with what it saw in plain words (many reports in a short time, the same first message to several people, many profiles or photos opened in a short time). Never its threshold, the count, the window or who reported. An automatic one names the terms' §6 on automatic rules in place of its reason, which says less than the rule (ADR-033's `other`, ADR-041's `scraping`);
   - for an automatic shadow ban, when a moderator will look (`auto_shadow_ban_review_hours`, read when the notice is read), or that one has looked and kept it;
   - how to contest it (§3).

   One function turns a sanction's keys into these lines, `sanctionStatement` in `packages/i18n`, for the phone and the API alike, as `describePhoto` does for the photo descriptions.
2. **Where each kind is told.**
   - A warning: its notice (ADR-032 §3), now with the statement.
   - A shadow ban: at once, by a moderator or a rule (the maintainer, "Tell it at once", 2026-11-17). It gets a notice of its own kind, `shadow_ban`, written in the sanction's transaction and pointing at its sanction. The notice carries the reason, the rule or null, whether it was reviewed, and the review hours. One lifted since is not shown, as a warning's is not. The export lists an open shadow ban among the sanctions.
   - The reports rule's own shadow ban is the exception (the maintainer, "After a moderator looks", 2026-11-17, on the security review of #715). Its notice is written only when a moderator keeps it, in the review's transaction and dated by that look, and one reversed or lifted before the look is never told. Told at once, it would arrive in the same moment as the end the last report made of the reporter's conversation (ADR-030 §12), and would name the reporter by that moment (ADR-030 §9). The other rules meet only the person's own acts and are told at once. For the same reason the export never lists a ban of the reports rule, whose time is the last report's; once kept, its owner has its notice, dated by the look (`listSanctionsOfAccount`, `toldWhenKept` in `safety/sanctions.ts`).
   - A suspension and a ban: the bank login's refusal carries the reason (`&reason=` beside `&until=`, from the newest open sanction of that kind on the identity), and the sign-in screen says the statement under the refusal. Only a reason of the closed list is shown, so a crafted link shows nothing more. A moderator always decided these two.

   What a shadow ban does is unchanged: the person is hidden from everyone else as before (ADR-024 §6, ADR-033), and `GET /onboarding` still reads the state as `active`, since the app routes by it. Only what the person is told changes.
3. **How to contest it.** Each statement ends the same way: write to `hello@kuutti.app` (the maintainer, 2026-11-17). Someone other than who decided looks at it again, through ADR-024 §3's second look in the panel, and a court is still open (the terms' §11). An automatic shadow ban that no moderator has looked at yet says only the address and the court, since its statement already says when a moderator will look. There is no form in the app: mail is enough for five thousand people, and a form would need data and a retention of its own.
4. **The email** (the maintainer, "E-mail it too", 2026-11-17). Each sanction is mailed once, after it commits, to its account's confirmed address. It goes in the language the person read the terms in, whatever the notification switches say, from the one sender every mail has (ADR-043). It is plain text with no link (rule 8): a subject for each kind, what it does, the statement, why the person gets it, and the signature. Like an announcement, it is a service message about the person's own account and sits outside #196's consents (ADR-068 §5).
   - A sanction lifted before the send, or an account erased by then, gets nothing.
   - A failure is logged with the account, the kind and `MailFailed`'s reason and status, never the address, and nothing is retried.
   - The mail leaves from the push's background (`push.sanction`, the notifications slice's), after the answer that applied the sanction, so no answer's time says whether anybody was mailed. It is handed in by `app.ts` to the panel's two apply routes, to the review route and to the automatic rules, which call it after their transaction commits.
   - A lift sends nothing, and a review sends nothing but the keep of the reports rule's ban, which is that ban's first telling (§2) and is mailed after the review's answer. Any other review's outcome shows in the notice; a lift takes the notice away.
5. **The panel says it.** Each sanction step says what the person is told and that the note is not. Confirming an automatic shadow ban changes its notice, and reversing one takes the notice away. For the reports rule's, confirming is what tells the person, in the app and by mail, and reversing says that they were never told (§2).
6. **The data.** `notice_kind` gains `shadow_ban` (migration `0010_shadow_ban_notice`). The notice's checks are written in the old kinds, because Postgres refuses a new enum value in the transaction that adds it: a sanction's notice is any kind that is neither an invitation's nor an announcement's. Nothing new is held about the person. The notice is erased and exported as every notice is (ADR-032 §5), and the mail keeps no copy.

## Consequences

- A shadow ban no longer hides itself from its owner, except the reports rule's until a moderator keeps it. A script reads its notice, so against scraping the rules stand on the hiding from everyone else and on the second look, no longer on secrecy. ADR-033's "without telling them which rule they met" no longer holds: they are told the kind of rule, never its numbers.
- The rule on reports tells its person that many people reported them in a short time, never who or how many (the maintainer's preview of 2026-11-17). Before, the reported person never learned from any route that anybody had reported them; who reported stays told to nobody (ADR-030 §9). Told at a moderator's keep, its moment follows the moderator's look and no longer the last report, but a keep within seconds of the ban would narrow the gap again: the review step is the protection, not a delay of a set length.
- A reports rule's ban that a moderator reverses is seen only by staff, and an open one is in neither the person's notices nor their export until it is kept.
- The terms' §6 says automatic rules can limit an account "without notice", which is no longer so. The app now tells more than the terms promise, which harms nobody. The wording is a new version of the terms, the site's first (ADR-010 §4), and the maintainer's.
- A moderator's decision now reaches an address the person confirmed. The mail names no reporter, no conversation and no other person, as the notice does not.
- The bank login's refusal names its reason in the deep link, and the refusal's log line carries the reason's code; no note and no person reach either.
- The review hours a statement names are the panel's own (48 today), read from `matching_config` when the notice or the mail is read. A change of the value changes what an unread notice says.
- Today's English is the agent's; the Finnish and the Swedish are machine text, flagged for a native review (`pnpm i18n:review`).

## Open, the maintainer's

1. The terms' §6, "without notice": a new version of the terms, the site's first, or the sentence left as it is.
2. The court sentence: kept as "You can also take the matter to a court", or dropped.
3. The address, `hello@kuutti.app`, until the rename moves the association's mail (ADR-072). It stands in the two contest lines of each language.
4. Whether the privacy policy's notices by email cover a sanction's mail as they read today, or need a line.
5. A way to contest from the app, if mail turns out not to be enough.
6. The export's leaving out the reports rule's bans (§2), read as GDPR Art. 15(4)'s limit where a copy would affect another person's rights: the reporter, named by the ban's moment. A kept one's notice is in the export, dated by the look.

## Alternatives

- **The DSA's Art. 17 as binding**, with its full statement, the Commission's transparency database (Art. 24(5)) and Art. 20's internal complaint system: not stretched to a service that asks no money (the maintainer, 2026-11-17).
- **A shadow ban told only once a moderator has looked**, so a rule's mistake is seen only by staff: the maintainer chose to tell it at once, but for the reports rule's (§2).
- **The reports rule's ban told at once, like the other rules'**: its moment would be the last report's, which ends the reporter's conversation in that same moment, so the person could tell who reported. The maintainer chose the moderator's look (2026-11-17).
- **A form in the app to contest**: mail is enough at this size, and a form would need data of its own.
- **The mail under the Moderators' decisions switch**: a decision about the person's own account is told whatever the switches say.
- **Staff's note in the statement**: never. It may name a reporter or quote a conversation (ADR-024 §8, ADR-030 §9).

## History

- 2026-11-17: written with #715. The same day, after the security review, the reports rule's ban told only once a moderator keeps it (§2, §4, §5), on the maintainer's word.
