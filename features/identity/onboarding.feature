# features/identity/onboarding.feature
Feature: Onboarding and consents
  Matching cannot start without four answers (gender, seeks, an age window,
  a home) and nothing may start without two consents given for the exact
  wording and version the person read (the English text binds, ADR-010 §20).
  The special-category consent that the seek answer needs can be withdrawn
  (ADR-019 §4). The account becomes active when everything required is
  there; the name, the intent and the photos are asked in the same flow and
  keep it incomplete until done (#46, #146, ADR-010). The words of one's own
  (a bio, a ready line or two answered prompts) are no step: one offer at the
  end of the walk, once on a phone (#681). The home is
  features/pond/home.feature's (ADR-061).

  The app opens on what Kumpa is, then asks a newcomer the name, the gender,
  whom they seek with its consent, and the home before the bank login, then
  the terms and the privacy notice as links, then the bank (#681, ADR-010
  §22; the maintainer, 18/11/2026 and 19/11/2026). With no account yet the
  answers are held on the phone alone, in its keychain for this device, bound
  to one bank attempt and gone an hour after the last answer; the consent for
  sensitive answers is held in memory for this run alone, and is asked of
  whoever is at the phone when the app comes back to it; that attempt's
  exchange saves them through the account's own routes before the app goes
  home. Somebody with an account goes through "I already have an account",
  past the terms when the phone recorded the current wordings (#418, ADR-010
  §15). Onboarding's welcome step is the fallback for consents missing after
  the sign-in, and asks only what did not land.

  Scenario: A consent counts only for the current version of its wording
    Given the terms have a current consent version
    When the account sends a consent for an older version
    Then the answer is 409 agreement_outdated and no consent row is written

  Scenario: The same consent is recorded once
    Given the account gave the terms consent for the current version
    When it sends the same consent again
    Then there is still one consent row for the terms

  Scenario: The special-category consent can be withdrawn and given again
    Given the account gave the special-category consent
    When it withdraws and later gives it again
    Then two rows exist, one withdrawn and one active, and the status shows the active one

  Scenario: Terms and privacy have no withdrawal route
    When the account tries to withdraw the terms or the privacy consent
    Then the request is refused as not a kind a person withdraws and the consent stays

  Scenario: The account becomes active when every required answer is there
    Given a registered account that has answered nothing
    When it gives both consents, declares a gender, gives the special-category consent, sets seeks and an age window, and gives a postal code
    Then the status lists fewer missing steps after each answer, in the order the app asks, and the account is active at the end with the profile steps still open

  Scenario: The onboarding lists the profile steps, in the order the app asks them
    Given an active account whose profile is empty
    When it saves a name and an intent, then uploads three photos
    Then the missing steps shrink from name, intent and photos to photos alone, and then to none, with no words asked

  Scenario: A change away from non-binary clears the identity label
    Given a non-binary person whose profile has an identity label and a hide on it
    When they change their gender to another
    Then the label is gone from the profile and the rest of it stays, the hide with it

  Scenario: The seek consent is recorded with the answer and withdrawing it blanks the seek rows
    Given an onboarded account with a politics answer on its profile
    When it withdraws the special-category consent
    Then the seek row is gone and the age window stays, the politics answer and the profile's consent are gone, and the status asks the seek step again

  Scenario: Erasure removes the preferences and the consents and blanks the gender
    Given an onboarded account
    When the account is deleted
    Then its preference rows and its consent rows are gone and the tombstone has no gender

  Scenario: The export lists gender, preferences and every consent
    Given an onboarded account that withdrew the special-category consent and gave it again
    When it downloads its export
    Then the export carries the gender, the two hard preferences and every consent row

  Scenario: The first screen says what Kumpa is before anything is asked
    Given a phone with nobody signed in
    When the app opens
    Then it says what Kumpa is and why it asks for a bank ID, with Get started and I already have an account
    And it shows no legal text and sends nothing

  Scenario: The questions before the bank are held on the phone and sent nowhere
    Given a newcomer who chose Get started
    When they give a name, a gender, whom they seek with its consent, and a postal code
    Then each answer is in this phone's keychain alone, with the time of the last, and nothing has been sent
    And the terms come next, saying that the bank keeps the answers

  Scenario: The consent for sensitive answers is asked of whoever is at the phone
    Given a newcomer who gave the consent with whom they seek
    When the app leaves the screen before a bank attempt carries the consent, or is closed
    Then the switch is off when they come back and nothing goes on without it
    And the consent was never in the phone's keychain

  Scenario: The bank button is reached only after the terms and the privacy summary are accepted
    Given a phone that has not recorded the current versions of the terms and the privacy summary
    When the person goes on from the first screen
    Then the terms, with the rules and both texts as links, stand where the bank button would be
    And the bank button shows only once both are accepted

  Scenario: The bank login saves the held answers right after the exchange
    Given a newcomer whose answers are bound to the bank attempt they opened
    When that attempt's code is exchanged
    Then the terms and the privacy notice, the name, the gender, the consent, whom they seek and the home are saved in the new account before the app goes home
    And the answers are gone from the phone

  Scenario: Answers held for another attempt are saved in nobody's account
    Given answers bound to one bank attempt
    When the code of another attempt is exchanged
    Then nothing held is saved and the answers are gone from the phone

  Scenario Outline: A refusal that lasts removes the held answers
    Given a newcomer whose answers are bound to the bank attempt they opened
    When the bank login comes back refused with <refusal>
    Then the answers are gone from the phone and the first screen offers nothing to go on with

    Examples:
      | refusal        |
      | auth_under_18  |
      | auth_banned    |
      | auth_suspended |
      | auth_cooldown  |

  Scenario: A cancelled bank login keeps the held answers
    Given a newcomer whose answers are bound to the bank attempt they opened
    When the bank login comes back cancelled
    Then the answers stay, and the next attempt carries them and saves them after its exchange

  Scenario: Held answers go an hour after the last answer
    Given answers held on the phone
    When an hour and a millisecond pass after the last answer
    Then they are removed as they are read, and each new answer moves the hour on

  Scenario: The answers given before the bank become consent rows right after the exchange
    Given the person accepted both before the bank
    When the bank login's code is exchanged
    Then the terms and the privacy summary are posted for the versions shown before the app goes home
    And the phone remembers the versions it recorded

  Scenario: A phone that recorded the current wordings goes straight to the bank
    Given this phone recorded the current versions of the terms and the privacy summary after an earlier sign-in
    When the person chooses I already have an account
    Then the bank button shows at once, and the exchange posts no consent

  Scenario: The welcome step asks for the terms and the privacy notice when they are missing after the sign-in
    Given an account whose status lists the terms and the privacy notice as missing after the sign-in
    When onboarding opens
    Then the welcome step shows the terms screen, the rules and both texts as links, with no step number
    And accepting them records both and the phone remembers the versions

  Scenario: The offer to finish the profile is shown once after the walk
    Given a walk of onboarding that asked something, on a profile with no words of its own
    When the last step is answered
    Then the offer to finish the profile shows, with a way to go on without it
    And the phone remembers it was shown, so that no later walk on it shows it again
