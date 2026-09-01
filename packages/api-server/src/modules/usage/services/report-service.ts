import { sql, type Db } from "db";

export const VIEW_NAMES = [
  "usage_auth_users_7d",
  "usage_auth_surface_by_user",
  "usage_auth_by_source_7d",
  "usage_auth_by_source_day_7d",
  "usage_multi_surface_users",
  "usage_distinct_users_per_day_7d",
  "usage_channel_turns_by_agent",
  "usage_channel_turns_by_day_7d",
  "usage_channel_top_agents_30d",
  "usage_schedule_fires_by_schedule",
  "usage_schedule_fires_by_agent",
  "usage_approvals_summary_30d",
  "usage_skill_installs_by_skill",
  "usage_skill_installs_by_user",
  "usage_egress_hosts_by_agent",
  "usage_connections_by_user",
  "usage_connections_by_provider",
  "usage_connection_churn_by_user",
  "usage_imports_by_agent",
  "usage_imports_by_user",
  "usage_imports_by_day_7d",
  "usage_entry_point_choices_30d",
  "usage_first_entry_point_by_user",
  "usage_core_actor_subs",
  "usage_core_agents",
] as const;

export type ViewName = (typeof VIEW_NAMES)[number];

const VIEW_NAMES_SET = new Set<string>(VIEW_NAMES);

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
