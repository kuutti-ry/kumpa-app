# ADR-077: The anchored like: a like may name one part of the card

- Status: proposed (#463, built as written here on the maintainer's decisions of 2026-11-26 in chat: a part picked by a tap, then Like or the flower; the ready line as the bio; a photo shown with a small copy of the person's own; stacked on #754's one-scroll card; the Finnish and Swedish words are machine drafts for the native review; accepting it is the maintainer's)
- Date: 2026-11-26
- Follows: TD-12 (what a decision on a card is), TD-6 (what a verified stranger learns before a match), TD-7 (what erasure removes), ADR-062 (one queue: a decision and its revisions until the day ends, §13 a day's entries kept a year), ADR-037 (the liked-you card), ADR-039 (the fish, a like with a mark), ADR-038 (the match, and its like final), ADR-031 (the conversation as the match's record), ADR-033 (the opener rules), ADR-064 (the Later list), ADR-007 (erasure and the export), ADR-008 (who is signed a photo), CLAUDE.md's Product constraints, issues #463 and #754

## Context

A like has been a bare yes: the person liked learns that somebody liked them and nothing of why. #463 asked for the like to point at what it is for: one photo, one answered prompt, the bio, or one of the "you too" items a card shows. That gives the person liked something to answer and the match a first thing to talk about, without the liker writing anything. The maintainer filed it for later on 2026-10-25 (`docs/decisions.md`, "a like is a bare yes"). #754's card shows every part of a profile on one scroll, which made each part something one can point at, and on 2026-11-26 he asked for it on top of that card and answered the issue's three open choices.

What this must not become: a comment, which row 464 refuses (a like carries no text), or a count of which parts draw likes, which would be a desirability signal (CLAUDE.md's Product constraints).

## Decision

1. **What a like may name.** One part of the card it is given on, as the card the queue built for that place shows it: an approved photo, by its id; an answered prompt, by its key; the bio, the ready line counting as the bio (the maintainer, 2026-11-26); or one "you too" item, by its field (hobbies, languages, university, guild) and option. A fish may name one as a like does, since a fish is a like with a mark (ADR-039). A pass or a skip names none, and the contract refuses one that tries. Nothing of the sender travels with it: no words, no copy of anything on the card.
2. **A reference, in three columns.** `queue_entry` keeps it as `anchor_kind`, `anchor_ref` and `anchor_field` (migration 0017). Constraints hold the shape: a part only on a like, a reference for every kind but the bio, a field for a shared item alone. What a reference points at is always read from the profile as it stands, so a photo removed, a prompt cleared or an item no longer shared is no part at all.
3. **Checked before anything is written.** The decision's transaction reads the card's parts for that place (`cardParts`, the profile slice's, which records nothing) and refuses a part that is not on it with 400 `anchor_not_on_card`, the card left undecided. The phone keeps the card, clears the pick and says why.
4. **The decision's rules carry it.** The same like with the same part writes nothing. Another part, or none, is a revision at a time of its own, as a changed decision is (ADR-062). A like that made a match keeps its part, as the like itself is final (ADR-038).
5. **The person liked reads it.** On a `liked_you` or `fish` card (ADR-037, ADR-039) the answer carries `likedYour`: the part the waiting like named, drawn from the person's own profile as the liker's card of them would show it now, and absent where the like named none or the part has gone. A photo comes with its card fields, so the phone shows the words and a small copy of the person's own photo (the maintainer, 2026-11-26). The same card opened from the Later list (ADR-064) says it too. Reading it records nothing, and the liker learns nothing of it.
6. **A match carries both parts.** At the match each like's part is copied to its liker's own `conversation_participant` row, because a day's entries go after a year (ADR-062 §13) and a conversation outlives them. The conversation shows them above its first message, once nothing earlier is left to load: what the reader liked of the other, and what the other liked of them, each drawn from its profile as it stands and left out once gone. An ended conversation shows neither. They are no messages: no sender, no line in the list, nothing for the opener rules (ADR-033) or for a report's frozen copy of the conversation (ADR-030 §12).
7. **Photos follow the photo rules.** The phone asks for a thumb through the photo route, which signs one's own photo and another's only on a card one was shown (ADR-008); where it signs none, the line keeps its words and the thumb its blurhash.
8. **Erasure and the export.** A day's entries go with the person as before. At an erasure both participant rows' parts go from every conversation the person is in, the counterpart's too, since each points into one of the two cards (TD-7, ADR-007). The export says the person's own likes' parts in words in the request's language, a prompt by its key and a shared item by its field and option, and never the other person's photo id, words or name; the other's like of the person is the other's.
9. **Nothing counts them.** No event, no order, no number reads which parts draw likes, for anybody. A part changes only what the two people are told.
10. **The phone.** Every part of the card is a button while the card waits for a decision: a tap draws an outline, a check and "In your like" on it, a second tap clears it, and one part is picked at a time. There is no like button on each part (the maintainer, 2026-11-26). A line above the decision buttons names the part, with a Clear button; Like and the flower say it in their accessibility hints, and Pass and Later send none. The pick is kept for its place while the card is shown, through an Undo too.

## Consequences

- The person liked gets a reason to answer and the match a first line to start from, and nobody writes anything to get there.
- A part is a reference, so it shows nothing its owner has since taken off the card, and nothing stays of it once the owner is erased.
- Installed store builds of 0.127.0 read `QueueEntry` and `ConversationDetail` without `.strict()`, so the two new keys are dropped there without an error; they send no part and show none. No opt-in like #745's `later` is needed.
- The round decision buttons keep their words, and the line naming the part floats above them, rather than a button's own words changing.
- A part's words are the app's: "Liked your photo", "Liked your answer to: {prompt}". The Finnish and Swedish are machine drafts until the native review.

## Open, the maintainer's

1. Accepting this record.
2. Whether the privacy notice names the part a like may carry, or "your likes and passes" already covers it.

## Alternatives considered

**A like button on each part**, which likes at once. Not chosen by the maintainer on 2026-11-26: it puts many more decision buttons down the scroll beside the floating ones; a tap that picks, then the one Like, keeps the decision where it is.

**A copy of the part with the like.** The liked person would see exactly what was liked, even after changing it. Rejected: it keeps one person's words or photo in another's records, past their own removal of it, and against row 464.

**Written bios only**, a ready line not pickable as canned text. Not chosen by the maintainer on 2026-11-26: the ready line is what the person chose to show where a bio would stand, and the person liked reads "your bio" for either.

**Words alone for a photo**, as the issue's spec had it. Not chosen by the maintainer on 2026-11-26: with up to six photos "Liked your photo" does not say which, and a small copy of the person's own photo shows nothing of anybody else's.

## History

- 2026-11-26 (#463): written and built as above, stacked on #754.
