# features/matching/anchored-likes.feature
Feature: A like that names the part of the card it is for
  A like, a fish too, may name one part of the card it was given on: a photo,
  an answered prompt, the bio or its ready line, or one of the card's "you too"
  items (#463, ADR-077; the maintainer, 25/10/2026 and 26/11/2026). It is a
  reference to the card the queue built for that place, never a copy of
  anybody's words, and no words of the sender travel with it. It follows the
  decision's rules until the day ends: the same like with the same part writes
  nothing, another part is a revision, and a like that made a match keeps its
  part. A pass or a skip names none. The person liked reads the part on the
  liker's card, drawn from their own profile as it stands at the read; a part
  that has gone since reads as a plain "liked you". Nothing counts which parts
  draw likes, for anybody.

  Scenario Outline: A like may name one part of the card
    Given "A"'s queue today holds "B", whose card has two photos, an answered prompt, a bio and a hobby both share
    When "A" likes the card naming <part>
    Then the like is recorded with <part>

    Examples:
      | part                  |
      | "B"'s second photo    |
      | "B"'s answered prompt |
      | "B"'s bio             |
      | the shared hobby      |

  Scenario Outline: A part that is not on the card at that place is refused, and nothing is written
    Given "A"'s queue today holds "B"
    When "A" likes the card naming <part>
    Then the answer is a 400 and the card stays undecided

    Examples:
      | part                             |
      | a photo of somebody else's       |
      | a prompt "B" has not answered    |
      | the bio of a card without one    |
      | a hobby "B" has and "A" has not  |

  Scenario: A pass or a skip names no part
    Given "A"'s queue today holds "B"
    When "A" passes the card naming "B"'s bio
    Then the answer is a 400 and the card stays undecided

  Scenario: The same like with the same part writes nothing, and another part is a revision
    Given "A" liked "B"'s card today naming "B"'s first photo
    When "A" likes it naming the first photo again, then naming "B"'s bio, then with no part
    Then the second like writes nothing, the third names the bio at a time of its own, and the fourth names nothing

  Scenario: A like that made a match keeps its part
    Given "A"'s like of "B" today named "B"'s bio and met "B"'s standing like
    When "A" likes the card again naming "B"'s first photo
    Then the answer is match_made and the like still names the bio

  Scenario: A fish may name a part as a like does
    Given "A"'s queue today holds "B"
    When "A" sends "B" a fish naming "B"'s answered prompt
    Then the fish is recorded with the prompt

  Scenario Outline: The person liked reads the part on the liker's card, from their own profile as it stands
    Given "B" liked "A" yesterday naming <part> of "A"'s
    When "A" reads the queue
    Then "B"'s card, labelled liked you, says <says>

    Examples:
      | part              | says                                    |
      | the second photo  | "liked your photo", with that photo     |
      | the first prompt  | "liked your answer to" the prompt       |
      | the bio           | "liked your bio"                        |
      | the ready line    | "liked your bio"                        |
      | the shared hobby  | "liked that you both" have the hobby    |

  Scenario Outline: A part that has gone since reads as a plain liked you
    Given "B" liked "A" yesterday naming <part> of "A"'s
    And since then <change>
    When "A" reads the queue
    Then "B"'s card is labelled liked you and names no part

    Examples:
      | part              | change                            |
      | the second photo  | "A" removed that photo            |
      | the first prompt  | "A" cleared that prompt's answer  |
      | the bio           | "A" removed the bio               |
      | the shared hobby  | "B" no longer has the hobby       |

  Scenario: The sender's export names the part, never the other person's words
    Given "A" liked "B" today naming "B"'s answered prompt
    When "A" exports their data
    Then the day's entry says the like named the answer to that prompt, by its key, and carries neither "B"'s answer nor "B"'s name
