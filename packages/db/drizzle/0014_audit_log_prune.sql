-- The staff-action log keeps five years, then the night lets a row go (#714,
-- ADR-076, amending ADR-006 §6; TD-7). The trigger function lets the DELETE of
-- a row through once the row was written more than five years ago, and refuses
-- every other UPDATE, DELETE and TRUNCATE as before, whoever asks. On a deployed
-- database only the table's owner (kuutti_audit, infra/scripts/db-audit-owner.sh)
-- holds DELETE, and the application role reaches it through audit_log_prune()
-- alone: SECURITY DEFINER, so it runs as that owner; no argument, so the caller
-- cannot widen it; its own search_path and time zone, so a schema of the
-- caller's with another now() earlier on the path, or a session's time zone,
-- moves neither its line nor the trigger's. now() is the transaction's start,
-- the database's clock, the same instant for both. EXECUTE leaves PUBLIC here,
-- and the owner script grants it to the application role.
-- On a deployed database this replaces a function kuutti_audit owns: the deploy
-- that carries it needs the owner script's `release` before it and the script
-- again after (infra/README.md).
CREATE OR REPLACE FUNCTION public.audit_log_immutable() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  SET timezone = 'UTC'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.at < now() - interval '5 years' THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % refused', TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE FUNCTION public.audit_log_prune() RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  SET timezone = 'UTC'
AS $$
DECLARE
  pruned bigint;
BEGIN
  DELETE FROM public.audit_log WHERE at < now() - interval '5 years';
  GET DIAGNOSTICS pruned = ROW_COUNT;
  RETURN pruned;
END;
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.audit_log_prune() FROM PUBLIC;
