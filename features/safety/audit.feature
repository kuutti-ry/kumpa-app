# features/safety/audit.feature
Feature: The audit log is append-only
  Every moderator action and every photo a member of staff looks at is a row
  that says who, what, on which subject and when (TD-5, security checklist).
  History is not rewritten: not by a route, not by the application role. A row
  is kept five years, then the night deletes it (TD-7, ADR-076); nothing
  deletes one sooner.

  Scenario: An audit row is written with who, what, subject and when
    When a member of staff does something audited
    Then audit_log has a row with their identity, the action, the subject and a time

  Scenario: An audit row cannot be updated or deleted
    Given an audit row written less than five years ago
    When the application role tries to update or delete it
    Then the database refuses and the row is unchanged

  Scenario: An audit row past five years may be deleted, and still not updated
    Given an audit row written more than five years ago
    When it is updated, the table truncated, or it is deleted with a younger row
    Then the database refuses each, and deletes it alone

  Scenario: The night deletes the audit rows written more than five years ago
    Given audit rows written more than five years ago, exactly five years ago and since
    When the night's prune runs
    Then the rows past five years are gone, whoever wrote them, and the rest are kept
