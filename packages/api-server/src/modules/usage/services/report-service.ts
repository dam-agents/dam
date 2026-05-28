import { sql, type Db } from "db";

// Source of truth for queryable usage views. View names ARE the SQL identifiers
// (the SELECT is built as `SELECT * FROM "<name>"` at call time) — so adding a
// view in 0014_usage_views.sql and pushing its name here is the only change
// needed to expose it via the JSON endpoint, the CLI, and the HTML report.
export const VIEW_NAMES = [
  // Auth
  "usage_auth_users_7d",
  "usage_auth_surface_by_user",
  "usage_auth_by_source_7d",
  "usage_auth_by_source_day_7d",
  "usage_multi_surface_users",
  "usage_distinct_users_per_day_7d",
  // Channel
  "usage_channel_turns_by_agent",
  "usage_channel_turns_by_day_7d",
  "usage_channel_top_agents_30d",
  // Sessions
  "usage_sessions_by_type_30d",
  "usage_sessions_by_mode_30d",
  "usage_active_agents_7d",
  "usage_sessions_by_agent_30d",
  "usage_session_active_span",
  "usage_schedule_fires_by_schedule",
  "usage_schedule_fires_by_agent",
  // Approvals
  "usage_approvals_summary_30d",
  // Skills
  "usage_skill_installs_by_skill",
  "usage_skill_installs_by_user",
  // Egress
  "usage_egress_hosts_by_agent",
  // Connections
  "usage_connections_by_user",
  "usage_connections_by_key",
  "usage_connection_churn_by_user",
  // Imports
  "usage_imports_by_agent",
  "usage_imports_by_user",
  "usage_imports_by_day_7d",
  // Helpers (also queryable for inspection)
  "usage_core_actor_subs",
  "usage_core_agents",
] as const;

export type ViewName = (typeof VIEW_NAMES)[number];

const VIEW_NAMES_SET = new Set<string>(VIEW_NAMES);

// Helper views — queryable via the JSON endpoint and CLI for ad-hoc inspection,
// but excluded from the HTML report because they're plumbing, not user-facing.
const INTERNAL_VIEWS = new Set<ViewName>([
  "usage_core_actor_subs",
  "usage_core_agents",
]);

export const REPORTABLE_VIEW_NAMES = VIEW_NAMES.filter(
  (n) => !INTERNAL_VIEWS.has(n),
);

export function isViewName(name: string): name is ViewName {
  return VIEW_NAMES_SET.has(name);
}

// Built once from the static VIEW_NAMES tuple — no runtime input ever flows
// into sql.raw, so the unsafe primitive is closed over a known-safe set.
const VIEW_QUERIES = new Map(
  VIEW_NAMES.map((n) => [n, sql.raw(`SELECT * FROM "${n}"`)] as const),
);

export function createReportService(db: Db) {
  return {
    async getReport(view: ViewName): Promise<Record<string, unknown>[]> {
      const query = VIEW_QUERIES.get(view);
      if (!query) throw new Error(`Unknown usage view: ${view}`);
      const rows = await db.execute<Record<string, unknown>>(query);
      return rows as unknown as Record<string, unknown>[];
    },
  };
}

export type ReportService = ReturnType<typeof createReportService>;
