-- The audit boundary (#49, ADR-006, security checklist line 67): audit_log,
-- its trigger function and its prune belong to a role the API never connects
-- as, so the application role can neither rewrite rows nor disable the trigger
-- that refuses UPDATE, TRUNCATE and a DELETE before five years (only the owner
-- may ALTER TABLE ... DISABLE TRIGGER, or CREATE OR REPLACE a function). The schema goes with
-- it: its owner may drop any table in it, and the application role owned it
-- as the database's owner; it keeps CREATE and USAGE, which is all a
-- migration needs. Written for the RDS master role, which is not a superuser:
-- the executor becomes a member of the audit role with SET
-- (createrole_self_grant). Idempotent.
-- __APP_ROLE__ and __AUDIT_ROLE__ are substituted by db-audit-owner.sh
-- (kuutti_app, kuutti_audit); packages/db/src/audit-owner.test.ts runs this
-- file as a non-superuser in the master's position on a fresh database.
-- First, before anything is handed over (#714, ADR-076 §6): audit_log and its
-- two functions are exactly as the migrations left them. While a release had
-- them in the application role's hands, it could add to them, and what it added
-- would outlast this script: a trigger, a rule, a policy, an index or extended
-- statistics with an expression, an inheriting table, a foreign key that
-- blocks a delete, an UNLOGGED table that a crash empties, a column's type,
-- collation or default, a function's body or settings. The prune runs as the owner, and so does every trigger
-- its DELETE fires and every expression ANALYZE evaluates, so any of them
-- would run in the audit role's hands. The shape leaves out owners and grants,
-- which this script sets, and whether the triggers are enabled, which it sets
-- too. Its hash is the migrations' (0014's) on a fresh database, which
-- packages/db/src/audit-owner.test.ts holds; a migration that changes the table
-- or its functions writes the new one here.
-- The catalog alone, before anything is named: the application role owns the
-- database, so it may give every session there a search path of its own, and it
-- may always create functions in the public schema, so a same-named one, or one
-- that fits an unquoted literal better than the catalog's, would otherwise run
-- in the master's hands here (db-audit-owner.sh pins it at connection too).
-- Every name below is the catalog's or schema-qualified, and deparsed in full.
SET search_path = pg_catalog, pg_temp;
DO $$
DECLARE
  t regclass;
  shape text;
  got text;
  want constant text := '3a6753b8d23259fb5106ff4e7bb42c1b9e6eef35e1ec76a0b32371c8c5b71f22';
BEGIN
  t := to_regclass('public.audit_log');
  SELECT concat_ws(E'\n',
    (SELECT format('table %s %s rls %s %s', relkind, relpersistence, relrowsecurity, relforcerowsecurity)
       FROM pg_class WHERE oid = t),
    (SELECT string_agg('column ' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
              || CASE WHEN a.attcollation <> 0 THEN ' collate ' || a.attcollation::regcollation::text ELSE '' END
              || CASE WHEN a.attnotnull THEN ' not null' ELSE '' END
              || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
              || CASE WHEN a.attgenerated <> '' THEN ' generated' ELSE '' END
              || CASE WHEN a.attidentity <> '' THEN ' identity' ELSE '' END,
              E'\n' ORDER BY a.attname)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = t AND a.attnum > 0 AND NOT a.attisdropped),
    (SELECT string_agg('constraint ' || conname || ' ' || pg_get_constraintdef(oid), E'\n' ORDER BY conname)
       FROM pg_constraint WHERE conrelid = t),
    (SELECT string_agg('referenced by ' || conrelid::regclass::text || ' ' || conname, E'\n' ORDER BY conname)
       FROM pg_constraint WHERE confrelid = t AND conrelid <> t),
    (SELECT string_agg('index ' || pg_get_indexdef(indexrelid), E'\n' ORDER BY pg_get_indexdef(indexrelid) COLLATE "C")
       FROM pg_index WHERE indrelid = t),
    (SELECT string_agg('trigger ' || pg_get_triggerdef(oid), E'\n' ORDER BY tgname)
       FROM pg_trigger WHERE tgrelid = t AND NOT tgisinternal),
    (SELECT string_agg('rule ' || rulename, E'\n' ORDER BY rulename) FROM pg_rewrite WHERE ev_class = t),
    (SELECT string_agg('policy ' || polname, E'\n' ORDER BY polname) FROM pg_policy WHERE polrelid = t),
    (SELECT string_agg('inherits ' || inhrelid::regclass::text || ' from ' || inhparent::regclass::text, E'\n'
              ORDER BY inhrelid::regclass::text COLLATE "C")
       FROM pg_inherits WHERE inhrelid = t OR inhparent = t),
    (SELECT string_agg('statistics ' || stxname, E'\n' ORDER BY stxname) FROM pg_statistic_ext WHERE stxrelid = t),
    (SELECT string_agg('function ' || f || ' ' || coalesce(pg_get_functiondef(to_regprocedure(f)), 'absent'), E'\n'
              ORDER BY f COLLATE "C")
       FROM unnest(ARRAY['public.audit_log_immutable()', 'public.audit_log_prune()']) AS f)
  ) INTO shape;
  got := encode(sha256(convert_to(shape, 'UTF8')), 'hex');
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION 'audit_log is not as the migrations left it, so nothing is handed over (#714, ADR-076)'
      USING ERRCODE = 'object_not_in_prerequisite_state',
        DETAIL = shape,
        HINT = 'Its shape hashes to ' || got || ', the migrations'' to ' || want
          || '. Compare with a fresh database''s (infra/README.md, Photo moderation).';
  END IF;
END
$$;
SET createrole_self_grant = 'set, inherit';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '__AUDIT_ROLE__') THEN
    CREATE ROLE __AUDIT_ROLE__ NOLOGIN;
  END IF;
END
$$;
ALTER SCHEMA public OWNER TO __AUDIT_ROLE__;
GRANT CREATE, USAGE ON SCHEMA public TO __APP_ROLE__;
ALTER TABLE public.audit_log OWNER TO __AUDIT_ROLE__;
ALTER FUNCTION public.audit_log_immutable() OWNER TO __AUDIT_ROLE__;
-- The night's prune (#714, ADR-076): a SECURITY DEFINER function, so in the
-- audit role's hands it deletes as the table's owner, and the application role,
-- which holds no DELETE, may call it and nothing more. A database the migration
-- that makes it (0014) has not reached is refused by the first check.
ALTER FUNCTION public.audit_log_prune() OWNER TO __AUDIT_ROLE__;
-- The grants, exactly these whatever was there (#714, ADR-076 §6). An owner's
-- grants pass to the next owner, so what the application role granted during a
-- release would outlast the handover: TRIGGER or REFERENCES left to PUBLIC, to
-- pg_database_owner (whose one member it is) or on a column would let it add,
-- once the table is back, a trigger the prune runs as the owner, or a key that
-- blocks the prune. Every grantee but the owner loses everything, and what it
-- granted on with it; the owner gets its own back in full, for the prune's DELETE.
DO $$
DECLARE
  grantee oid;
BEGIN
  FOR grantee IN
    SELECT a.grantee FROM pg_class c, aclexplode(c.relacl) a
     WHERE c.oid = 'public.audit_log'::regclass AND a.grantee <> c.relowner
    UNION
    SELECT a.grantee FROM pg_class c JOIN pg_attribute t ON t.attrelid = c.oid, aclexplode(t.attacl) a
     WHERE c.oid = 'public.audit_log'::regclass AND a.grantee <> c.relowner
  LOOP
    -- A table's REVOKE takes the grantee's column grants with it.
    EXECUTE format('REVOKE ALL ON TABLE public.audit_log FROM %s CASCADE',
      CASE grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee)) END);
  END LOOP;
  FOR grantee IN
    SELECT a.grantee FROM pg_proc p, aclexplode(p.proacl) a
     WHERE p.oid IN ('public.audit_log_immutable()'::regprocedure, 'public.audit_log_prune()'::regprocedure)
       AND a.grantee <> p.proowner
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.audit_log_immutable(), public.audit_log_prune() FROM %s CASCADE',
      CASE grantee WHEN 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grantee)) END);
  END LOOP;
END
$$;
GRANT ALL ON public.audit_log TO __AUDIT_ROLE__;
GRANT SELECT, INSERT ON public.audit_log TO __APP_ROLE__;
-- A function's default is EXECUTE for PUBLIC; a trigger fires without it.
REVOKE ALL ON FUNCTION public.audit_log_immutable(), public.audit_log_prune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_log_prune() TO __APP_ROLE__;
-- Fire under every replication role too (a superuser session in replica mode
-- is the one thing the owner script cannot otherwise reach).
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER audit_log_no_update_or_delete;
ALTER TABLE public.audit_log ENABLE ALWAYS TRIGGER audit_log_no_truncate;
