-- An automatic shadow ban's review deadline goes from 48 hours to a week (#715,
-- ADR-033 History; the maintainer's "7 days (168 h)", 17/11/2026): the next
-- version of auto_shadow_ban_review_hours, written by this migration, after
-- the newest whoever wrote it. Reports keep their own 24 hours
-- (moderation_response_hours). The seed's MATCHING_CONFIG_V1 is version 1 and
-- keeps 48.
INSERT INTO "matching_config" ("version", "key", "value", "created_by")
SELECT "version" + 1, "key", '168'::jsonb, 'migration:0011' FROM "matching_config"
WHERE "key" = 'auto_shadow_ban_review_hours' ORDER BY "version" DESC LIMIT 1;
