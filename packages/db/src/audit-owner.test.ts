import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "./migrate.ts";
import { createPool } from "./pool.ts";
import { withTemporaryDatabase } from "./test/temporary-database.ts";

// The audit boundary (#49, ADR-006): infra/scripts/db-audit-owner.sql, run
// exactly as on RDS — by a non-superuser master role that is a member of the
// application role, against a database the application role owns — leaves the
// application role able to append to and read audit_log, and to delete through
// the night's prune the rows past five years and nothing else (#714, ADR-076),
// and unable to disable the trigger or replace a function. The release file
// hands ownership back for a deploy, and the owner script takes it back only
// from a table and functions exactly as the migrations left them, so nothing
// the application role added meanwhile runs later in the audit role's hands.
// Needs a superuser on the test database to stage the roles (the compose
// Postgres); skipped elsewhere.

const SCRIPTS = resolve(import.meta.dirname, "../../../infra/scripts");
const OWNER_SQL = readFileSync(resolve(SCRIPTS, "db-audit-owner.sql"), "utf8");
const RELEASE_SQL = readFileSync(resolve(SCRIPTS, "db-audit-release.sql"), "utf8");
const MIGRATIONS = resolve(import.meta.dirname, "../drizzle");
/** The prune as migration 0014 makes it, to put back what a plant changed. */
const PRUNE_SQL = (
  readFileSync(resolve(MIGRATIONS, "0014_audit_log_prune.sql"), "utf8")
    .split("--> statement-breakpoint")
    .find((statement) => statement.includes("CREATE FUNCTION public.audit_log_prune()")) ?? ""
).replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION");

const fill = (sql: string, app: string, audit: string) =>
  sql.replaceAll("__APP_ROLE__", app).replaceAll("__AUDIT_ROLE__", audit);
const as = (url: string, role: string) =>
  createPool({ connectionString: url.replace(/\/\/[^@]+@/, `//${role}:probe@`), max: 1 });

describe("audit_log boundary", () => {
  it("applied by the master role, leaves the application role with INSERT and SELECT and no way around the trigger", async () => {
    await withTemporaryDatabase(async (url) => {
      const su = createPool({ connectionString: url, max: 2 });
      const isSuper = (
        await su.query<{ rolsuper: boolean }>(
          "SELECT rolsuper FROM pg_roles WHERE rolname = current_user",
        )
      ).rows[0]?.rolsuper;
      if (!isSuper) {
        await su.end();
        return;
      }
      const tag = Math.random().toString(36).slice(2, 8);
      const app = `probe_app_${tag}`;
      const master = `probe_admin_${tag}`;
      const audit = `probe_audit_${tag}`;
      const probe = `probe_${tag}`;
      const database = new URL(url).pathname.slice(1);
      await migrate(su, MIGRATIONS);
      // The RDS shape: the application role owns the database (hence the public
      // schema) and every table the migrations made; the master role is a
      // CREATEROLE member of it and not a superuser.
      await su.query(`CREATE ROLE ${app} LOGIN PASSWORD 'probe'`);
      await su.query(`CREATE ROLE ${master} LOGIN PASSWORD 'probe' NOSUPERUSER CREATEROLE`);
      await su.query(`GRANT ${app} TO ${master}`);
      await su.query(`ALTER DATABASE ${database} OWNER TO ${app}`);
      await su.query(`DO $$ DECLARE r record; BEGIN
        FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
          EXECUTE format('ALTER TABLE public.%I OWNER TO %I', r.tablename, '${app}');
        END LOOP; END $$`);
      await su.query(`ALTER FUNCTION public.audit_log_immutable() OWNER TO ${app}`);
      await su.query(`ALTER FUNCTION public.audit_log_prune() OWNER TO ${app}`);
      const actor =
        (
          await su.query<{ id: string }>(
            "INSERT INTO identity (hetu_hmac) VALUES ('probe-actor') RETURNING id",
          )
        ).rows[0]?.id ?? "";

      const asMaster = as(url, master);
      const asApp = as(url, app);
      try {
        await asMaster.query(fill(OWNER_SQL, app, audit));
        const owners = () =>
          su.query<{ t: string; f: string; p: string }>(
            `SELECT (SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.audit_log'::regclass) AS t,
                    (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.audit_log_immutable()'::regprocedure) AS f,
                    (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = pg_catalog.to_regprocedure('public.audit_log_prune()')) AS p`,
          );
        expect((await owners()).rows[0]).toEqual({ t: audit, f: audit, p: audit });

        await asApp.query(
          "INSERT INTO audit_log (actor_identity_id, action, subject_type, subject_id) VALUES ($1, 'probe', 'photo', $1)",
          [actor],
        );
        expect((await asApp.query("SELECT count(*) AS n FROM audit_log")).rows[0]?.n).toBe("1");
        for (const statement of [
          "UPDATE audit_log SET action = 'x'",
          "DELETE FROM audit_log",
          "TRUNCATE audit_log",
          "ALTER TABLE audit_log DISABLE TRIGGER ALL",
          "CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$",
          "DROP TABLE audit_log",
          "DROP SCHEMA public CASCADE",
          "ALTER SCHEMA public OWNER TO CURRENT_USER",
        ]) {
          await expect(asApp.query(statement), statement).rejects.toMatchObject({ code: "42501" });
        }
        // A migration still creates and drops its own tables in the schema.
        await asApp.query("CREATE TABLE public.probe_table (n int)");
        await asApp.query("DROP TABLE public.probe_table");
        // The owner side still refuses rewrites: the trigger, not a grant, is the rule.
        await expect(asMaster.query("DELETE FROM public.audit_log")).rejects.toThrow(/append-only/);

        // The night's prune (#714, ADR-076). A row of six years beside the young one.
        await su.query(
          `INSERT INTO audit_log (actor_identity_id, action, subject_type, subject_id, at)
           VALUES ($1, 'probe.old', 'photo', $1, now() - interval '6 years')`,
          [actor],
        );
        const left = async () =>
          (await su.query<{ action: string }>("SELECT action FROM audit_log ORDER BY at")).rows.map(
            (r) => r.action,
          );
        // The application role deletes nothing itself, old or not, and cannot change the prune.
        for (const statement of [
          "DELETE FROM audit_log WHERE at < now() - interval '5 years'",
          "CREATE OR REPLACE FUNCTION audit_log_prune() RETURNS bigint LANGUAGE sql AS $$ SELECT 0::bigint $$",
          "ALTER FUNCTION audit_log_prune() SECURITY INVOKER",
          "ALTER FUNCTION audit_log_prune() RESET ALL",
          "ALTER FUNCTION audit_log_prune() OWNER TO CURRENT_USER",
        ]) {
          await expect(asApp.query(statement), statement).rejects.toMatchObject({ code: "42501" });
        }
        // The owner side may delete an old row, never update it, and a table of old rows
        // still cannot be truncated: the statement trigger asks no age.
        await expect(
          asMaster.query(
            "UPDATE public.audit_log SET action = 'x' WHERE at < now() - interval '5 years'",
          ),
        ).rejects.toThrow(/append-only: UPDATE refused/);
        await expect(asMaster.query("TRUNCATE public.audit_log")).rejects.toThrow(
          /append-only: TRUNCATE refused/,
        );
        // Nobody but the application role is granted the prune.
        expect(
          (
            await su.query<{ e: boolean }>(
              "SELECT has_function_privilege('public', 'public.audit_log_prune()', 'EXECUTE') AS e",
            )
          ).rows[0]?.e,
        ).toBe(false);
        // The application role owns the database, so it may make a schema with a now() of its
        // own, open it to everybody, the prune's owner included, and put it first on the path:
        // it moves neither the prune's line nor the trigger's.
        await asApp.query(`CREATE SCHEMA ${probe}`);
        await asApp.query(
          `CREATE FUNCTION ${probe}.now() RETURNS timestamptz LANGUAGE sql AS $$ SELECT 'infinity'::timestamptz $$`,
        );
        await asApp.query(`GRANT USAGE ON SCHEMA ${probe} TO PUBLIC`);
        await asApp.query(`SET search_path = ${probe}, pg_catalog, public`);
        const pruned = await asApp.query<{ n: string }>("SELECT audit_log_prune() AS n");
        await asApp.query("RESET search_path");
        expect(pruned.rows[0]?.n).toBe("1");
        expect(await left()).toEqual(["probe"]);
        // A second night finds nothing more.
        expect((await asApp.query("SELECT audit_log_prune() AS n")).rows[0]?.n).toBe("0");
        // Applying it again changes nothing and fails nothing.
        await asMaster.query(fill(OWNER_SQL, app, audit));

        // The release hands it back for a deploy; a migration as the app role works again.
        await asMaster.query(fill(RELEASE_SQL, app, audit));
        expect((await owners()).rows[0]).toEqual({ t: app, f: app, p: app });
        await asApp.query("ALTER TABLE audit_log ADD COLUMN probe_column int");
        await asApp.query("ALTER TABLE audit_log DROP COLUMN probe_column");

        // While it holds the table, the application role could add to it what would outlast
        // the handover and run as the owner: the prune's DELETE fires every trigger on the
        // table in the owner's hands, and ANALYZE evaluates an index's expressions there.
        // The owner script refuses each, hands nothing over, and takes the table back once
        // it is gone again (#714, ADR-076 §6).
        await asApp.query(
          `CREATE FUNCTION ${probe}.planted() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
        );
        await asApp.query(
          `CREATE FUNCTION ${probe}.same(timestamptz) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$`,
        );
        const plants: [string, string[], string[]][] = [
          [
            "a statement trigger",
            [
              `CREATE TRIGGER planted BEFORE DELETE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION ${probe}.planted()`,
            ],
            ["DROP TRIGGER planted ON audit_log"],
          ],
          [
            "the prune's search path",
            [`ALTER FUNCTION audit_log_prune() SET search_path = ${probe}, pg_catalog`],
            ["ALTER FUNCTION audit_log_prune() SET search_path = pg_catalog, pg_temp"],
          ],
          [
            "the trigger function's search path",
            [`ALTER FUNCTION audit_log_immutable() SET search_path = ${probe}, pg_catalog`],
            ["ALTER FUNCTION audit_log_immutable() SET search_path = pg_catalog, pg_temp"],
          ],
          [
            "the prune's body",
            [PRUNE_SQL.replace("WHERE at < now()", "WHERE at <= now()")],
            [PRUNE_SQL],
          ],
          [
            "an index on an expression",
            [`CREATE INDEX ${probe}_index ON audit_log (${probe}.same(at))`],
            [`DROP INDEX ${probe}_index`],
          ],
          [
            "extended statistics",
            [
              `CREATE STATISTICS ${probe}_statistics (ndistinct) ON action, subject_type FROM audit_log`,
            ],
            [`DROP STATISTICS ${probe}_statistics`],
          ],
          [
            "a policy",
            [
              "ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY",
              `CREATE POLICY ${probe} ON audit_log USING (true)`,
            ],
            [
              `DROP POLICY ${probe} ON audit_log`,
              "ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY",
            ],
          ],
          [
            "a rule",
            [`CREATE RULE ${probe} AS ON DELETE TO audit_log DO ALSO NOTIFY ${probe}`],
            [`DROP RULE ${probe} ON audit_log`],
          ],
          [
            "an inheriting table",
            [`CREATE TABLE ${probe}.child () INHERITS (public.audit_log)`],
            [`DROP TABLE ${probe}.child`],
          ],
          [
            "a foreign key to it",
            [`CREATE TABLE ${probe}.pointer (id uuid REFERENCES public.audit_log (id))`],
            [`DROP TABLE ${probe}.pointer`],
          ],
          [
            "an unlogged table",
            ["ALTER TABLE audit_log SET UNLOGGED"],
            ["ALTER TABLE audit_log SET LOGGED"],
          ],
          [
            "a default in the future",
            ["ALTER TABLE audit_log ALTER COLUMN at SET DEFAULT 'infinity'"],
            ["ALTER TABLE audit_log ALTER COLUMN at SET DEFAULT now()"],
          ],
          [
            "a column's collation",
            ['ALTER TABLE audit_log ALTER COLUMN action TYPE text COLLATE "C"'],
            ['ALTER TABLE audit_log ALTER COLUMN action TYPE text COLLATE "default"'],
          ],
          [
            "a column's type",
            ["ALTER TABLE audit_log ALTER COLUMN detail TYPE text"],
            ["ALTER TABLE audit_log ALTER COLUMN detail TYPE jsonb USING detail::jsonb"],
          ],
        ];
        for (const [what, plant, undo] of plants) {
          for (const statement of plant) await asApp.query(statement);
          await expect(asMaster.query(fill(OWNER_SQL, app, audit)), what).rejects.toMatchObject({
            code: "55000",
            message: expect.stringMatching(/not as the migrations left it/),
          });
          expect((await owners()).rows[0], what).toEqual({ t: app, f: app, p: app });
          for (const statement of undo) await asApp.query(statement);
        }
        // What it grants meanwhile outlasts the handover too, since an owner's grants pass to
        // the next owner: a TRIGGER or REFERENCES left to the database's owner (whose one member
        // is the application role), to everybody or on a column alone would let it add a trigger
        // the prune runs as the owner, or a key that blocks it, once the table is back. The
        // owner script leaves the table only its own grants and the application role's two.
        for (const statement of [
          "GRANT TRIGGER, REFERENCES ON audit_log TO pg_database_owner WITH GRANT OPTION",
          "GRANT REFERENCES (id), UPDATE (action) ON audit_log TO PUBLIC",
          "GRANT EXECUTE ON FUNCTION audit_log_prune() TO pg_database_owner",
          // The owner's own may be taken away: the prune would then fail every night.
          `REVOKE DELETE ON audit_log FROM ${app}`,
        ]) {
          await asApp.query(statement);
        }
        await asMaster.query(fill(OWNER_SQL, app, audit));
        expect((await owners()).rows[0]).toEqual({ t: audit, f: audit, p: audit });
        for (const statement of [
          "ALTER TABLE audit_log DISABLE TRIGGER ALL",
          `CREATE TRIGGER planted BEFORE DELETE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION ${probe}.planted()`,
          `CREATE TABLE ${probe}.pointer (id uuid REFERENCES public.audit_log (id))`,
          "UPDATE audit_log SET action = 'x'",
        ]) {
          await expect(asApp.query(statement), statement).rejects.toMatchObject({ code: "42501" });
        }
        const grants = await su.query<{ grantee: string; privilege: string }>(
          `SELECT coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') AS grantee,
                  a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END AS privilege
             FROM pg_class c, aclexplode(c.relacl) a
            WHERE c.oid = 'public.audit_log'::regclass AND a.grantee <> c.relowner
           UNION ALL
           SELECT coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || '.' || t.attname, a.privilege_type
             FROM pg_attribute t, aclexplode(t.attacl) a
            WHERE t.attrelid = 'public.audit_log'::regclass
           UNION ALL
           SELECT coalesce(nullif(a.grantee, 0)::regrole::text, 'PUBLIC') || ' on ' || p.proname, a.privilege_type
             FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
            WHERE p.oid IN ('public.audit_log_immutable()'::regprocedure, 'public.audit_log_prune()'::regprocedure)
              AND a.grantee <> p.proowner
           ORDER BY 1, 2`,
        );
        expect(grants.rows).toEqual([
          { grantee: app, privilege: "INSERT" },
          { grantee: app, privilege: "SELECT" },
          { grantee: `${app} on audit_log_prune`, privilege: "EXECUTE" },
        ]);
        expect(
          (
            await su.query<{ d: boolean }>(
              `SELECT has_table_privilege('${audit}', 'public.audit_log', 'DELETE') AS d`,
            )
          ).rows[0]?.d,
        ).toBe(true);

        // The application role owns the database, so without any release it may give every
        // session there a search path of its own, with the public schema first, and it may
        // always create functions in that schema: a same-named one, or one that matches an
        // unquoted literal better than the catalog's, would run in the master's hands in either
        // script. Both pin the catalog alone before they name anything; each runs here in a
        // session of its own, as db-audit-owner.sh runs them.
        for (const statement of [
          `ALTER DATABASE ${database} SET search_path = public, pg_catalog`,
          ...[
            "set_config(text, text, boolean) RETURNS text",
            "convert_to(text, text) RETURNS bytea",
            "to_regprocedure(text) RETURNS regprocedure",
            "to_regclass(text) RETURNS regclass",
          ].map(
            (signature) =>
              `CREATE FUNCTION public.${signature} LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'shim ran as %', current_user; END $$`,
          ),
        ]) {
          await asApp.query(statement);
        }
        try {
          // Between them the prune is made again from the same text: it has the shape, and a
          // new function's grant, EXECUTE for everybody, which the owner script takes away.
          for (const [what, sql, owner, meanwhile] of [
            ["the release", RELEASE_SQL, app, ["DROP FUNCTION audit_log_prune()", PRUNE_SQL]],
            ["the owner script", OWNER_SQL, audit, []],
          ] as const) {
            const session = as(url, master);
            try {
              const path = await session.query<{ p: string }>(
                "SELECT pg_catalog.current_setting('search_path') AS p",
              );
              expect(path.rows[0]?.p, what).toBe("public, pg_catalog");
              await session.query(fill(sql, app, audit));
            } finally {
              await session.end();
            }
            expect((await owners()).rows[0], what).toEqual({ t: owner, f: owner, p: owner });
            for (const statement of meanwhile) await asApp.query(statement);
          }
        } finally {
          await asApp.query(`ALTER DATABASE ${database} RESET search_path`);
          for (const signature of [
            "set_config(text, text, boolean)",
            "convert_to(text, text)",
            "to_regprocedure(text)",
            "to_regclass(text)",
          ]) {
            await asApp.query(`DROP FUNCTION public.${signature}`);
          }
        }
        expect((await owners()).rows[0]).toEqual({ t: audit, f: audit, p: audit });
        expect(
          (
            await su.query<{ e: boolean }>(
              "SELECT has_function_privilege('public', 'public.audit_log_prune()', 'EXECUTE') AS e",
            )
          ).rows[0]?.e,
        ).toBe(false);

        // A database the prune's migration (0014) has not reached, as before this deploy: the
        // release still hands the rest back, and the owner script refuses it whole.
        await su.query("DROP FUNCTION public.audit_log_prune()");
        await asMaster.query(fill(RELEASE_SQL, app, audit));
        expect((await owners()).rows[0]).toEqual({ t: app, f: app, p: null });
        await expect(asMaster.query(fill(OWNER_SQL, app, audit))).rejects.toMatchObject({
          code: "55000",
        });
        expect((await owners()).rows[0]).toEqual({ t: app, f: app, p: null });
      } finally {
        await asApp.end();
        await asMaster.end();
        await su.query(`ALTER DATABASE ${database} OWNER TO current_user`);
        // The database is dropped by the helper; the roles are cluster-wide and
        // must own nothing in it first (the audit role owns the schema by now).
        // The audit role is the owner script's; a run refused first never made it.
        for (const role of [app, audit, master]) {
          const made = await su.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role]);
          if (made.rowCount === 0) continue;
          await su.query(`DROP OWNED BY ${role} CASCADE`);
          await su.query(`DROP ROLE ${role}`);
        }
        await su.end();
      }
    });
  });
});
