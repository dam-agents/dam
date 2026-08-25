import type postgres from "postgres";

export interface UsageViewGrants {
  role: string;
  rolePresent: boolean;
  readable: string[];
  unreadable: string[];
}

const ROLE = "usage_readers";
const RECONCILE_LOCK_KEY = 0x67_72_61_6e_74;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reconciles SELECT on the usage source passthrough
 * views for the `usage_readers` group role, once per api-server start, and
 * reports what the role can read afterwards.
 *
 * What must hold is a state, not an event: if the role exists, it can read
 * every `usage_src_*` view. Three unrelated things break that — a passthrough
 * is added, a passthrough is recreated (privileges attach to the object, not
 * the name, so recreating one discards them), or the role is created after the
 * views already exist. The first two come from migrations; the third comes
 * from the chart's role SQL or, where the chart does not manage Postgres, from
 * an operator. Those actors have no ordering relationship to each other, which
 * is why this reconciles rather than living in the migration that happens to
 * make it necessary: a migration runs once, in an order it cannot coordinate
 * with whoever creates the role, and a grant it skips is skipped for good.
 * Reconciling costs a few catalog queries per start and is correct whatever
 * order those actors ran in.
 *
 * Only ever grants, never revokes, so it cannot undo privilege state a human
 * set deliberately. Replicas booting together would otherwise collide: two
 * sessions granting on the same view update one `pg_class` row and the loser
 * fails with `tuple concurrently updated`, which would abort a boot. An
 * advisory lock serializes them instead, taken before any catalog work so the
 * acquisition order is identical everywhere and cannot deadlock. It blocks
 * rather than skipping on contention: a skipped reconcile would still run the
 * readback below and could report a half-granted state as `unreadable`, which
 * is the one signal here that has to stay trustworthy.
 *
 * The passthroughs alone are granted, never the aggregate views: aggregation
 * belongs to the consumer, and a consumer that could read an aggregate would
 * eventually key a metric on one, which is what makes renaming that aggregate
 * break it.
 *
 * Selecting from `pg_views` is what keeps the grant to views only — a future
 * table named `usage_src_*` stays private with nobody having to remember that.
 * Restricting to views this role owns keeps the set to what it can actually
 * grant, so a view owned by someone else cannot fail the step and take the
 * boot down with it. Each `\_` is LIKE's escape for a literal underscore, so
 * the pattern cannot match `usageXsrcXfoo`.
 *
 * The returned readback is the point of the reconcile being observable: it is
 * measured from the catalog after the grants, so it reports what the role can
 * really read rather than what this code meant to do. `unreadable` is the
 * alarm — a passthrough the role still cannot read is the silent failure this
 * whole mechanism exists to prevent, and the caller logs it as a warning.
 */
export async function reconcileUsageViewGrants(
  sql: postgres.Sql,
): Promise<UsageViewGrants> {
  const [role] = await sql<{ present: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}) AS present
  `;
  if (!role?.present) {
    return { role: ROLE, rolePresent: false, readable: [], unreadable: [] };
  }

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(${RECONCILE_LOCK_KEY})`;
    await tx.unsafe(`
      DO $$
      DECLARE v text;
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
          FOR v IN
            SELECT viewname FROM pg_catalog.pg_views
            WHERE schemaname = 'public'
              AND viewname LIKE 'usage\\_src\\_%'
              AND viewowner = current_user
            ORDER BY viewname
          LOOP
            EXECUTE format('GRANT SELECT ON %I TO ${ROLE}', v);
          END LOOP;
        END IF;
      END $$;
    `);
  });

  const rows = await sql<{ view: string; readable: boolean }[]>`
    SELECT c.relname AS view,
           has_table_privilege(${ROLE}, c.oid, 'SELECT') AS readable
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'v'
      AND c.relname LIKE 'usage\\_src\\_%'
    ORDER BY c.relname
  `;

  return {
    role: ROLE,
    rolePresent: true,
    readable: rows.filter((r) => r.readable).map((r) => r.view),
    unreadable: rows.filter((r) => !r.readable).map((r) => r.view),
  };
}
