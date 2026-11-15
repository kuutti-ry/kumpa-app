# features/pond/opening.feature
Feature: A pond opens when an admin opens it
  Nobody waits at the pond (#500, ADR-060; the maintainer, 29/10/2026). Matching
  opens the day an admin turns its switch on in the panel, after a confirm
  step, and nothing else opens or closes it: no count, no share, no night and
  no other screen of the panel. There is one switch, called Matching in the
  panel (#500, the maintainer, 01/11/2026), and no pond behind it any more: it
  is one value among matching's own, and "a pond" below is everybody who has
  told their home (ADR-061 §8; the maintainer, 15/11/2026, #607).
  Matching is open for a person when the switch is on
  and their profile and onboarding are complete, and they are told one of three
  things, with no number, no step and no place in a line.

  Scenario: Matching opens in a pond when an admin opens it, and not before
    Given a pond nobody has opened, with thirty-one people who all fit
    When each of them reads the queue
    Then nobody has a round, and each is told that it has not opened yet
    When an admin opens the pond
    Then each is told that matching is open
    When each of them reads the queue
    Then each has a round

  Scenario Outline: A person is told one of three things
    Given a person who is <person> in a pond that is <pond>
    When they ask
    Then they are told <state>

    Examples:
      | person     | pond   | state      |
      | complete   | open   | open       |
      | complete   | closed | closed     |
      | unfinished | open   | incomplete |
      | unfinished | closed | incomplete |

  Scenario: Only a finished profile and current consents count
    Given an open pond with a person whose profile lacks its photos, one whose consent is for an older wording, a shadow-banned one and a paused one
    When each of them reads the queue
    Then none of them is a card in anybody's round
    And the shadow-banned person has a round of their own, like anybody

  Scenario: Another person's state is never served
    Given two people in an open pond, one finished and one not
    When each asks
    Then each is told their own, and naming the other in the request changes nothing

  Scenario: Closing a pond opens no new round and ends no conversation
    Given an open pond where "A" has today's round and a conversation
    When an admin closes the pond
    Then "A" reads today's round and the conversation as they were, and is told that matching has not opened
    And the next day's read opens "A" no round

  Scenario: The switch is written to the audit log once, with no words
    Given a pond nobody has opened
    When an admin opens it, and presses again
    Then matching is open, and the audit log has one row: the admin and that it opened
    When the admin closes it
    Then the audit log has a second row that says so

  Scenario: Only an admin turns the switch
    Given a pond nobody has opened
    When a moderator, or somebody with no staff session, reads the switch or asks to turn it on
    Then each is refused and the pond stays closed

  Scenario: The switch is not one of the tunables
    Given a pond nobody has opened
    When an admin lists the tunables, and writes the switch a new value there
    Then the list leaves the switch out, the write is refused as no such key, and the pond stays closed
