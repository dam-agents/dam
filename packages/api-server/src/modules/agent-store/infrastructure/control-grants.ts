import { sql, type Db } from "db";

export interface ControlGrants {
  role: string;
  rolePresent: boolean;
  skipped: boolean;
  granted: string[];
  missing: string[];
  failed?: string;
}

type Grant = {
  object: string;
  columns?: readonly string[];
  privileges: readonly string[];
};

export const CONTROL_ROLE = "platform_controller";
export const CONTROL_SCHEMA = "control";

const AGENT_READ_COLUMNS = [
  "id",
  "incarnation",
  "owner_sub",
  "template_id",
  "environment_of",
  "name",
  "image",
  "harness",
  "image_pull_secret_ref",
  "secret_ref",
  "hibernation_timeout_ns",
  "nested_virtualization",
  "require_connection_address",
  "telemetry_attribution_id",
  "cpu_limit",
  "memory_limit",
  "disk_size",
  "memory_fallback_bytes",
  "disk_floor_bytes",
  "unsupported_persistent_paths",
  "sweepable",
  "lifetime_ms",
  "generation",
  "created_at",
] as const;

const SIGNAL_READ_COLUMNS = [
  "agent_id",
  "version",
  "last_activity_at",
  "last_activity_token",
  "session_pinned",
  "invocation_pinned",
  "invocation_pin_version",
  "stop_request_token",
  "stop_requested_at",
  "disabled_at",
  "roll_rev",
  "reclaimed_at",
  "reclaimed_activity_token",
  "updated_at",
] as const;

export const CONTROL_GRANTS: readonly Grant[] = [
  {
    object: "control.agents",
    columns: AGENT_READ_COLUMNS,
    privileges: ["SELECT"],
  },
  {
    object: "control.agent_signals",
    columns: SIGNAL_READ_COLUMNS,
    privileges: ["SELECT"],
  },
  {
    object: "control.agent_signals",
    columns: ["reclaimed_at", "reclaimed_activity_token"],
    privileges: ["UPDATE"],
  },
  {
    object: "control.agent_status",
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  },
  {
    object: "control.agent_conditions",
    privileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  },
  { object: "control.agent_l7_hosts", privileges: ["SELECT"] },
  { object: "control.agent_connection_grants", privileges: ["SELECT"] },
  { object: "control.user_budgets", privileges: ["SELECT"] },
  {
    object: "control.agent_store",
    columns: ["absorbed_at", "anchors_ensured_at", "switch_completed_at"],
    privileges: ["SELECT"],
  },
];

const LOCK_KEY = "control-grants";
const LOCK_TIMEOUT = "10s";
const STATEMENT_TIMEOUT = "30s";

const rowsOf = <T>(result: unknown): T[] => result as unknown as T[];

const parts = (object: string): [string, string] => {
  const [schema, name] = object.split(".");
  if (!schema || !name) throw new Error(`not a qualified name: ${object}`);
  return [schema, name];
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: Brings the controller's login role onto exactly the
 * tables and columns it reconciles, and reports what it can reach.
 *
 * The grants live here rather than in a migration because the role's existence
 * is not a migration's business: the bundled chart creates it, an operator
 * creates it on an external database, and either may happen before or after
 * this build's migrations. Re-issuing them on every start converges all of
 * those orders, and the api-server owns the tables, so it can grant on them
 * without holding CREATEROLE.
 *
 * Every list is written out column by column, so what the controller may read
 * is reviewable as one statement and a new definition column is invisible to it
 * until someone grants it deliberately. The tables with no entry here are the
 * ones it must not reach at all — the kit bookkeeping, the snapshot archive, and
 * the connection itself, whose credentials and inputs it never sees.
 *
 * It shares the usage reconcile's containment: bounded statement and lock
 * timeouts, a loser that skips instead of queueing, and no failure that can
 * stop the api-server from starting.
 */
export async function reconcileControlGrants(db: Db): Promise<ControlGrants> {
  const absent: ControlGrants = {
    role: CONTROL_ROLE,
    rolePresent: false,
    skipped: false,
    granted: [],
    missing: [],
  };

  let rolePresent = false;

  try {
    const present = rowsOf<{ present: boolean }>(
      await db.execute<{ present: boolean }>(
        sql`SELECT to_regrole(${CONTROL_ROLE}) IS NOT NULL AS present`,
      ),
    );
    if (!present[0]?.present) return absent;
    rolePresent = true;

    return await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('lock_timeout', ${LOCK_TIMEOUT}, true)`,
      );
      await tx.execute(
        sql`SELECT set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true)`,
      );
      const lock = rowsOf<{ locked: boolean }>(
        await tx.execute<{ locked: boolean }>(
          sql`SELECT pg_try_advisory_xact_lock(pg_catalog.hashtext(${LOCK_KEY})) AS locked`,
        ),
      );
      if (!lock[0]?.locked)
        return { ...absent, rolePresent: true, skipped: true };

      await tx.execute(
        sql`GRANT USAGE ON SCHEMA ${sql.identifier(CONTROL_SCHEMA)} TO ${sql.identifier(CONTROL_ROLE)}`,
      );

      for (const grant of CONTROL_GRANTS) {
        const [schema, name] = parts(grant.object);
        const target = sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
        const columns = grant.columns
          ? sql` (${sql.join(
              grant.columns.map((column) => sql.identifier(column)),
              sql`, `,
            )})`
          : sql``;
        await tx.execute(
          sql`GRANT ${sql.raw(grant.privileges.join(", "))}${columns} ON ${target} TO ${sql.identifier(CONTROL_ROLE)}`,
        );
      }

      const reach = rowsOf<{ can_use_schema: boolean }>(
        await tx.execute<{ can_use_schema: boolean }>(
          sql`SELECT has_schema_privilege(${CONTROL_ROLE}, ${CONTROL_SCHEMA}, 'USAGE') AS can_use_schema`,
        ),
      )[0];

      const missing: string[] = [];
      if (!reach?.can_use_schema) missing.push("USAGE ON control");
      for (const grant of CONTROL_GRANTS) {
        for (const privilege of grant.privileges) {
          const reached = grant.columns
            ? rowsOf<{ name: string }>(
                await tx.execute<{ name: string }>(
                  sql`SELECT name FROM unnest(${sql.raw(
                    `ARRAY[${grant.columns.map((column) => `'${column}'`).join(", ")}]`,
                  )}::text[]) AS t(name)
                      WHERE NOT has_column_privilege(${CONTROL_ROLE}, ${grant.object}, t.name, ${privilege})`,
                ),
              ).map((row) => `${privilege} ON ${grant.object}.${row.name}`)
            : rowsOf<{ allowed: boolean }>(
                  await tx.execute<{ allowed: boolean }>(
                    sql`SELECT has_table_privilege(${CONTROL_ROLE}, ${grant.object}, ${privilege}) AS allowed`,
                  ),
                )[0]?.allowed
              ? []
              : [`${privilege} ON ${grant.object}`];
          missing.push(...reached);
        }
      }

      return {
        role: CONTROL_ROLE,
        rolePresent: true,
        skipped: false,
        granted: CONTROL_GRANTS.map(
          (grant) =>
            `${grant.privileges.join(", ")} ON ${grant.object}${grant.columns ? ` (${grant.columns.join(", ")})` : ""}`,
        ),
        missing,
      };
    });
  } catch (cause) {
    return {
      ...absent,
      rolePresent,
      failed: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
