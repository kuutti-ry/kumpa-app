# features/chat/anchors.feature
Feature: A match opens with the parts its likes named
  When two likes make a match, the parts each like named (#463, ADR-077;
  matching's anchored-likes.feature) are copied to the conversation as
  references, because a day's queue is kept only a year (ADR-062 §13). The
  conversation shows them above its first message: what the person liked of
  the other, and what the other liked of them. They are drawn from the two
  profiles as they stand at the read, a photo through the photo rules as they
  stand (ADR-008, ADR-056), and a part that has gone is left out. They are not
  messages: no sender, no line in the list, nothing for the opener rules
  (ADR-033) to read.

  Scenario: A match carries both likes' parts into the conversation
    Given "B" liked "A" yesterday naming "A"'s bio
    When "A" likes "B" today naming "B"'s first photo, and the two match
    Then "A"'s conversation says "A" liked "B"'s photo and "B" liked "A"'s bio, and "B"'s says the same from "B"'s side

  Scenario: A like that named nothing brings nothing into the conversation
    Given "B" liked "A" yesterday naming nothing
    When "A" likes "B" today naming "B"'s bio, and the two match
    Then "A"'s conversation says only that "A" liked "B"'s bio

  Scenario: A part that has gone since is left out of the conversation
    Given "A" and "B" matched on likes naming "A"'s second photo and "B"'s answered prompt
    And "A" has removed that photo since
    When "B" opens the conversation
    Then it says only that "A" liked "B"'s answer to that prompt

  Scenario: The parts are no message
    Given "A" and "B" matched on likes naming each other's bios, and nobody has written
    When "A" asks for the list and opens the conversation
    Then the list's row has no last message, the conversation has no messages, and the opener rules still count nobody's first
