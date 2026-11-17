# features/matching/decisions.feature
Feature: The queue's cards, seen and decided
  A queue day is the log of one person's queue on one Finnish calendar day
  (#96, TD-11, ADR-034, ADR-062): its cards in order, each with why it is there
  (TD-12). A read answers the next cards not yet decided, at most ten. The phone
  reports a card seen; the person likes it, passes it or skips it, and may change
  that until the day ends (the maintainer, 19/10/2026). A card of a day that has
  ended can no longer be decided: it ended with its day. A card that can no
  longer be shown, by a block either way or a sanction, is left out and cannot be
  decided; one that no longer fits is filters.feature's. Erasure removes the
  person's queue days and every entry in which they are somebody's card, and the
  night removes what is past a year.

  Scenario: A read shows the undecided cards in order, each with its reason, at most ten
    Given "A"'s queue today holds "B", "C" and "D", and twelve more
    When "A" reads the queue
    Then ten cards come in their places, each with its reason, and none decided

  Scenario: A decided card is not read again
    Given "A"'s queue today holds "B", "C" and "D", and "A" decided "B" and "C"
    When "A" reads the queue
    Then "D" alone comes

  Scenario: A card that can no longer be shown is left out, and cannot be seen or decided
    Given "A"'s queue today holds "B" and "C"
    And "A" blocked "B" and "C" was suspended since
    When "A" reads the queue, reports both seen and likes both
    Then neither card is shown, and every write answers not_found with nothing written

  Scenario: A card seen is recorded once
    Given "A"'s queue today holds "B"
    When "A" reports the card seen twice
    Then its seen time is the first report's

  Scenario: A like is recorded, and the same decision again writes nothing
    Given "A"'s queue today holds "B"
    When "A" likes the card twice
    Then the card is liked at the first time

  Scenario: A decision may change until the day ends
    Given "A"'s queue today holds "B"
    When "A" likes the card, then passes it, then likes it again
    Then the card is liked, at the last time, and each decision had a time of its own

  Scenario: A card of a day that has ended cannot be seen or decided
    Given "A"'s queue of yesterday holds "B"
    When "A" reports yesterday's card seen and likes it
    Then both answers are day_ended and nothing is written

  Scenario: Two devices deciding the same card at once are taken one after the other
    Given "A"'s queue today holds "B"
    When one device likes the card while another passes it at the same moment
    Then the second waits for the first, and the card ends with the second's decision

  Scenario: Only the person's own queue is read or decided
    Given "A" and "E" each have a queue today
    When "E" reports seen and decides at "A"'s places
    Then "E"'s own cards are written, and "A"'s are untouched

  Scenario: Erasure removes the person's queue days and every entry in which they are somebody's card
    Given "A" and "B" have queue days today, each the other's card
    When "B" deletes their account
    Then "B"'s queue is gone, and "A"'s queue keeps its other cards without "B"

  Scenario: The person's export lists their own queue days, never whom
    Given "A"'s queue today holds "B", and "A" liked it
    When "A" downloads their data
    Then the queue is listed by its day with the card's place, reason and decision in words, and "B" is named nowhere

  Scenario Outline: Queue days are kept a year, their entries and relaxations with them
    Given a queue of "A" with an entry and a relaxation, <days> days old
    When the night prunes the queue days
    Then it <outcome>

    Examples:
      | days | outcome                                |
      | 365  | stays                                  |
      | 366  | is gone, with its entry and relaxation |

  # A skip, Later on the button (ADR-062 §3): the decision skip, through the same
  # route. It moves on, spends nothing and costs nobody a clock. The card returns
  # another day, in the order of short-pool.feature. Like and pass stay as they
  # were.

  Scenario: A skip moves on and spends nothing
    Given like_budget_balanced is 1, and "A"'s queue today holds "B" and "C"
    When "A" skips "B" and likes "C"
    Then both are decided, and "C" took the day's one like

  Scenario: A skip starts no clock, and the card returns another day
    Given "A" skipped "B" yesterday
    When "A" reads the queue today
    Then "B" comes back, labelled seen before

  Scenario: A skip may be changed until midnight like any decision
    Given like_budget_balanced is 1, and "A"'s queue today holds "B" and "C"
    When "A" likes "B", skips "B", likes "C", then skips "C" and passes "C"
    Then "B" stays skipped, "C" is passed, and the day's like is back

  Scenario: A skip on a liked-you card answers nothing, and the like keeps waiting
    Given "B" liked "A" yesterday, and "B" is in "A"'s queue today as liked you
    When "A" skips the card
    Then no match is made, and tomorrow's read opens with "B", labelled liked you, while the like has not expired

  Scenario: A card displayed and left undecided on an ended day reads as a skip
    Given "A" was shown "B" yesterday, left it undecided, and skipped "C" three days ago
    When "A" reads the queue today
    Then "C" and then "B" come back, in the order of the skips

  # A second pass (ADR-062 §6, §15): passed again after the clock has run, a
  # person waits a year. The mark is on the entry, so that it outlasts the first
  # pass's record.

  Scenario Outline: A pass is a second pass only with a pass of an earlier day behind it
    Given "A" <before>
    When "A" passes "B" today
    Then the pass is <marked>

    Examples:
      | before                                 | marked   |
      | never met "B"                          | a first  |
      | passed "B" forty days ago              | a second |
      | passed "B" twice before                | a second |
      | skipped "B" forty days ago             | a first  |
      | liked "B" a hundred days ago           | a first  |

  Scenario: A pass changed back and forth the same day is one pass
    Given "A"'s queue today holds "B", and "A" never passed "B" before
    When "A" passes "B", likes "B", and passes "B" again
    Then the pass is a first

  Scenario: Changing a second pass clears its mark
    Given "A" passed "B" forty days ago, and has passed "B" again today
    When "A" changes it to a skip
    Then the entry holds no mark

  Scenario: A pass whose earlier one has been pruned counts as a first
    Given "A" passed "B" more than a year ago, and the night has pruned that queue
    When "A" passes "B" today
    Then the pass is a first, and "B" returns after the first pass's clock

  Scenario: A third pass is another year
    Given "A" passed "B" twice, the second a year ago
    When "A" passes "B" today
    Then the pass is marked, and "B" returns a year from today

  # The day's likes (#98's first cut, ADR-036; the maintainer, 20/10/2026):
  # one budget for everybody, like_budget_balanced a Finnish day, counted
  # from the day's standing decisions. A like back spends one like any other
  # like (#503; the maintainer, 30/10/2026); a pass or a skip is never counted.

  Scenario: The day's likes stop at the budget, and the next is refused with the time they come back
    Given like_budget_balanced is 2 and "A"'s queue today holds "B", "C" and "D"
    When "A" likes all three
    Then "B" and "C" are liked, and the like of "D" is refused with the wait until midnight, nothing of it written

  Scenario: A like back spends one of the day's likes
    Given like_budget_balanced is 1 and "A"'s queue today holds "B" who liked "A", and "C"
    When "A" likes "B" and then "C"
    Then the two are a match, and the like of "C" is refused with the wait until midnight

  Scenario: A like back past the budget is refused, and the like it would answer keeps waiting
    Given like_budget_balanced is 1 and "A"'s queue today holds "B" who liked "A", and "C"
    When "A" likes "C" and then "B"
    Then the like of "B" is refused with the wait until midnight, no match is made, and B's like still stands

  Scenario: A pass is never counted, and a like taken back gives its place back
    Given like_budget_balanced is 1 and "A"'s queue today holds "B", "C" and "D"
    When "A" passes "B", likes "C", is refused "D", then changes "C" to a pass
    Then "A" can like "D"

  Scenario: Two devices liking at once cannot pass the budget together
    Given like_budget_balanced is 1 and "A"'s queue today holds "B" and "C"
    When one device likes "B" while another likes "C"
    Then the second waits for the first, and its like is refused

  # What the queue says of the day's likes (#524; the maintainer, 30/10/2026):
  # how many are left, from like_budget_balanced down to zero, by the count
  # the refusal uses, in the queue's answer and in every decision's.

  Scenario: The queue says how many of the day's likes are left, and each decision's answer says it again
    Given like_budget_balanced is 2 and "A"'s queue today holds "B", "C" and "D"
    When "A" reads the queue, likes "B" and "C", and is refused "D"
    Then the queue says two are left, the two answers one and none, and the queue read again none

  Scenario: Before the day's first read, all of the day's likes are left
    Given like_budget_balanced is 3 and "A" has no queue today
    When "A" reads the queue
    Then the answer says three are left

  Scenario: A pass leaves the likes left as they were, and a like taken back gives one back
    Given like_budget_balanced is 2 and "A"'s queue today holds "B" and "C"
    When "A" passes "B", likes "C", then changes "C" to a pass
    Then the answers say two, one and two are left

  Scenario: A like back takes one off the likes left
    Given like_budget_balanced is 2 and "A"'s queue today holds "B" who liked "A"
    When "A" likes "B"
    Then the answer says one is left

  Scenario: The likes left are the person's own, of today
    Given "A" liked a card yesterday and today, and "E" liked none today
    When "A" and "E" read the queue
    Then "A" has one like fewer left, and "E" has all of theirs
