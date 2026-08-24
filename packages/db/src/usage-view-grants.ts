import type postgres from "postgres";

// UNIT_BOUNDARY_DESCRIPTION: Re-grants SELECT on every source passthrough view
// to the `usage_readers` group role, on every api-server boot.
//
// Postgres attaches privileges to the object, not the name, so recreating a
// view destroys every grant on it. View migrations must recreate rather than
// replace whenever a column is renamed or reordered, so an optional read-only
// consumer loses access on exactly the deploys that change what it reads.
// Healing here rather than in each migration means there is no per-migration
// step to forget, and a newly added passthrough is covered the moment it
// exists. It lives in its own module because it is a privilege operation, not
// schema evolution: nothing about it belongs in the migration history.
//
// The passthroughs alone are granted, never the aggregate views: aggregation
// belongs to the consumer, and a consumer that could read an aggregate would
// eventually key a metric on one, which is what makes renaming that aggregate
// break it. Withholding them keeps the passthrough column lists the only
// contract, enforced here rather than by review.
//
// Selecting from `pg_views` is what keeps the grant to views only — a future
// table named `usage_src_*` stays private with nobody having to remember that.
// Restricting to views this role owns keeps the set to what it can actually
// grant, so the step cannot fail on a privilege it lacks and take the boot
// down with it; migrations create every view as this role, so the two sets are
// the same in practice. Each `\_` is LIKE's escape for a literal underscore,
// so the pattern cannot match `usageXsrcXfoo`. Views are granted in name order
// so concurrently booting replicas take catalog locks in the same order and
// cannot deadlock.
//
// A no-op on every install that has not created the role, which is most.
export async function grantUsageViews(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    DO $$
    DECLARE v text;
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'usage_readers') THEN
        FOR v IN
          SELECT viewname FROM pg_catalog.pg_views
          WHERE schemaname = 'public'
            AND viewname LIKE 'usage\\_src\\_%'
            AND viewowner = current_user
          ORDER BY viewname
        LOOP
          EXECUTE format('GRANT SELECT ON %I TO usage_readers', v);
        END LOOP;
      END IF;
    END $$;
  `);
}
