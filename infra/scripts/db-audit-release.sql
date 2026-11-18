-- The boundary's counterpart: hands audit_log and its functions back to
-- the application role for the length of one deploy, because migrations run as
-- that role and one that touches audit_log would otherwise fail (and with it
-- the boot, the migrations before it applied, ADR-075). Sequence: release, deploy, apply the owner
-- script again. db-audit-owner.sh <env> release.
-- The catalog alone, as in db-audit-owner.sql: the database's owner may set
-- every session's path and put functions in the public schema.
SET search_path = pg_catalog, pg_temp;
ALTER TABLE public.audit_log OWNER TO __APP_ROLE__;
ALTER FUNCTION public.audit_log_immutable() OWNER TO __APP_ROLE__;
-- The prune (#714, ADR-076) is absent before the deploy whose migration makes
-- it (0014), which is itself a deploy this release comes before.
DO $$
BEGIN
  IF to_regprocedure('public.audit_log_prune()') IS NOT NULL THEN
    ALTER FUNCTION public.audit_log_prune() OWNER TO __APP_ROLE__;
  END IF;
END
$$;
