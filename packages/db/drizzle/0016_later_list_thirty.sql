-- Later puts the person on the list the star had (#681, ADR-064 History), so
-- the list holds thirty rather than ten (the maintainer, 18/11/2026): the next
-- version of stars_max, written by this migration, after the newest whoever
-- wrote it. The seed's MATCHING_CONFIG_V1 is version 1 and keeps 10.
INSERT INTO "matching_config" ("version", "key", "value", "created_by")
SELECT "version" + 1, "key", '30'::jsonb, 'migration:0016' FROM "matching_config"
WHERE "key" = 'stars_max' ORDER BY "version" DESC LIMIT 1;
