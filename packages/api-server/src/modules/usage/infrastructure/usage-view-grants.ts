import { sql, type Db } from "db";

export interface UsageViewGrants {
  role: string;
  rolePresent: boolean;
  canConnect: boolean;
  canUseSchema: boolean;
  granted: string[];
  readable: string[];
  unreadable: string[];
  notGrantable: string[];
  failed?: string;
}

const ROLE = "usage_readers";
const LOCK_KEY = "usage-view-grants";
const PREFIX = "usage_src_";
const LOCK_TIMEOUT = "10s";
const STATEMENT_TIMEOUT = "30s";

type CatalogRow = {
  name: string;
  readable: boolean;
  grantable: boolean;
};

const rowsOf = <T>(result: unknown): T[] => result as unknown as T[];

/**
 * UNIT_BOUNDARY_DESCRIPTION: Brings the `usage_readers` group role's SELECT on
 * the usage source passthrough views up to date, and reports what that role can
 * actually reach.
 *
 * What must hold is a state — if the role exists it can read every passthrough
 * — and three unrelated actors can break it: a migration adds a passthrough, a
 * migration recreates one (privileges attach to the object, so recreating
 * discards them), or the role is created only after the views already exist.
 * Migrations, the chart and an operator have no ordering relationship, so this
 * reconciles instead of riding in the migration that happens to need it.
 *
 * Everything here is bounded rather than best-effort, because it runs on the
 * startup path: statement and lock timeouts cap the work, the advisory lock
 * stops concurrent starts colliding on the same catalog row, and the caller
 * treats any failure as degraded rather than fatal. Analytics access is
 * optional; the platform starting is not.
 *
 * The reported sets are measured from the catalog after the grants, and split
 * by whether this role could do anything about them: `unreadable` is a view it
 * can grant and yet cannot read, which should be impossible and is the alarm;
 * `notGrantable` needs an operator, because no restart will fix it.
 */
export async function reconcileUsageViewGrants(
  db: Db,
): Promise<UsageViewGrants> {
  const absent: UsageViewGrants = {
    role: ROLE,
    rolePresent: false,
    canConnect: false,
    canUseSchema: false,
    granted: [],
    readable: [],
    unreadable: [],
    notGrantable: [],
  };

  try {
    const present = rowsOf<{ present: boolean }>(
      await db.execute<{ present: boolean }>(
        sql`SELECT to_regrole(${ROLE}) IS NOT NULL AS present`,
      ),
    );
    if (!present[0]?.present) return absent;

    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`,
      );
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(pg_catalog.hashtext(${LOCK_KEY}))`,
      );

      const reach = rowsOf<{ can_connect: boolean; can_use_schema: boolean }>(
        await tx.execute<{ can_connect: boolean; can_use_schema: boolean }>(sql`
          SELECT has_database_privilege(${ROLE}, current_database(), 'CONNECT') AS can_connect,
                 has_schema_privilege(${ROLE}, 'public', 'USAGE') AS can_use_schema
        `),
      )[0];

      const pending = rowsOf<{ name: string }>(
        await tx.execute<{ name: string }>(sql`
          SELECT c.relname AS name
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('v', 'm')
            AND left(c.relname, ${PREFIX.length}) = ${PREFIX}
            AND pg_has_role(current_user, c.relowner, 'USAGE')
            AND NOT has_table_privilege(${ROLE}, c.oid, 'SELECT')
          ORDER BY c.relname
        `),
      ).map((r) => r.name);

      for (const name of pending) {
        await tx.execute(
          sql`GRANT SELECT ON ${sql.identifier("public")}.${sql.identifier(name)} TO ${sql.identifier(ROLE)}`,
        );
      }

      const catalog = rowsOf<CatalogRow>(
        await tx.execute<CatalogRow>(sql`
          SELECT c.relname AS name,
                 COALESCE(has_table_privilege(${ROLE}, c.oid, 'SELECT'), false) AS readable,
                 pg_has_role(current_user, c.relowner, 'USAGE') AS grantable
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public'
            AND c.relkind IN ('v', 'm')
            AND left(c.relname, ${PREFIX.length}) = ${PREFIX}
          ORDER BY c.relname
        `),
      );

      return {
        role: ROLE,
        rolePresent: true,
        canConnect: reach?.can_connect ?? false,
        canUseSchema: reach?.can_use_schema ?? false,
        granted: pending,
        readable: catalog.filter((r) => r.readable).map((r) => r.name),
        unreadable: catalog
          .filter((r) => !r.readable && r.grantable)
          .map((r) => r.name),
        notGrantable: catalog
          .filter((r) => !r.readable && !r.grantable)
          .map((r) => r.name),
      };
    });
  } catch (cause) {
    return {
      ...absent,
      rolePresent: true,
      failed: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
