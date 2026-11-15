-- The switch that opens matching becomes a tunable of its own (#607, ADR-060 §1,
-- ADR-061 §8; the maintainer, 15/11/2026): one versioned row, born here at the
-- value the one pond's switch stands at, so that an environment where an admin
-- has opened matching stays open and every other one starts closed. The pond's
-- row goes in the next migration. An aggregate answers one row whether the
-- table holds one or none. The seed's MATCHING_CONFIG_V1 carries the key closed.
INSERT INTO "matching_config" ("version", "key", "value", "created_by")
SELECT 1, 'matching_open', to_jsonb(COALESCE(bool_or("matching_open"), false)), 'migration:0004' FROM "ponds";
