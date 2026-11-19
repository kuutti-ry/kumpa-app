# features/notifications/announcements.feature
Feature: An announcement tells everybody what they must know, once two admins agree
  Whoever runs Kuutti can tell everybody something they must know, such as a
  service break or a change in the rules (#573, ADR-068). One admin writes it
  in English and Finnish, and in Swedish or not; another admin approves it,
  and only then does it go: a notice in the app to every account that is not
  erased, an email to every confirmed address, and a push that says only that
  there is an announcement, in the app's own words. A Swedish reader of one
  written without Swedish reads the English. The Announcements switch stops
  the push and the email, never the notice. Nothing takes it back once sent.
  Each email carries the person's own one-click unsubscribe in its headers,
  never in its words (#196, RFC 8058): the mail app's Unsubscribe posts to
  it and turns the switch off, as Settings would.

  Scenario: An announcement goes only once another admin approves it
    Given an admin wrote an announcement
    When the same admin approves it, and then another admin does
    Then the first approval is refused and nothing is sent, and the second sends it

  Scenario: An approved announcement reaches everybody as a notice in their language
    Given people who read Finnish, Swedish and English, and an announcement written without Swedish
    When another admin approves it
    Then each has it among their notices, in Finnish, in English and in English

  Scenario: The push says only that there is an announcement, to those whose switch is on
    Given "A" and "B" each have a phone, and "B" switched announcements off
    When an announcement is approved outside the quiet hours
    Then "A"'s phone gets the app's line and the kind alone, and "B"'s phone gets nothing

  Scenario: An announcement approved in the quiet hours is pushed once they end
    Given "A" and "B" each have a phone
    When an announcement is approved in the quiet hours and "B" reads it before they end
    Then nothing is pushed until they end, and then only "A" is

  Scenario: The email goes to confirmed addresses whose switch is on, in the language of their terms
    Given "A" confirmed an address and read the terms in Swedish, "B" confirmed one and switched announcements off, and "C" left theirs unconfirmed
    When an announcement written without Swedish is approved
    Then only "A" is mailed, in English, its title as the subject, no link in its words and its own unsubscribe in its headers

  Scenario: One click on an announcement email's Unsubscribe turns that person's announcements off
    Given "A" and "B" were each mailed an announcement
    When "A"'s mail app posts to the unsubscribe link of "A"'s email
    Then "A"'s Announcements switch is off and "B"'s is on, and the next announcement mails only "B"

  Scenario: Opening an unsubscribe link, or posting to one nobody holds, changes nothing
    Given "A" was mailed an announcement
    When the link of "A"'s email is opened, and a link nobody holds is posted to
    Then the opening is answered 405 and the other 404, and "A"'s switch is still on

  Scenario: A draft can be deleted, a sent announcement cannot
    Given an admin wrote two announcements and another admin approved one
    When an admin deletes each
    Then the draft goes, and the sent one stays with every notice it wrote
