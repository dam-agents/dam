import { sql, type Db } from "db";
import { SHARED_KB_TEMPLATE_ID } from "api-server-api";
import {
  CORE_FEATURES,
  type ActiveDayFact,
  type AgentCreatedFact,
  type CoreFeature,
  type FeatureFirstFact,
  type KitAgentFact,
  type SlackSetupFact,
  type UserFact,
} from "../domain/analytics-report.js";

const epochMs = (column: string) =>
  sql.raw(`(EXTRACT(EPOCH FROM ${column}) * 1000)::float8`);

const toDate = (ms: number | string) => new Date(Number(ms));
const toDateOrNull = (ms: number | string | null) =>
  ms === null ? null : toDate(ms);

const FEATURES = new Set<string>(CORE_FEATURES);
const isCoreFeature = (f: string): f is CoreFeature => FEATURES.has(f);

export type AnalyticsRepository = {
  users(): Promise<UserFact[]>;
  activeDays(): Promise<ActiveDayFact[]>;
  featureFirsts(): Promise<FeatureFirstFact[]>;
  slackSetups(): Promise<SlackSetupFact[]>;
  kitAgents(): Promise<KitAgentFact[]>;
  agentsCreated(): Promise<AgentCreatedFact[]>;
  outOfMemoryAgentIds(sinceDays: number): Promise<Set<string>>;
  knowledgeBaseConnectionIds(): Promise<Set<string>>;
};

export function createAnalyticsRepository(db: Db): AnalyticsRepository {
  return {
    async users() {
      const rows = await db.execute<{ sub: string; first_seen: number }>(sql`
        SELECT actor_sub AS sub, ${epochMs("first_seen_at")} AS first_seen
        FROM usage_users`);
      return rows.map((r) => ({ sub: r.sub, firstSeenAt: toDate(r.first_seen) }));
    },

    async activeDays() {
      const rows = await db.execute<{ sub: string; day: string }>(sql`
        SELECT actor_sub AS sub, day::text AS day FROM usage_active_days`);
      return rows.map((r) => ({ sub: r.sub, day: r.day }));
    },

    async featureFirsts() {
      const rows = await db.execute<{
        sub: string;
        feature: string;
        first_at: number;
      }>(sql`
        SELECT actor_sub AS sub, feature, ${epochMs("first_at")} AS first_at
        FROM usage_feature_firsts`);
      return rows.flatMap((r) =>
        isCoreFeature(r.feature)
          ? [{ sub: r.sub, feature: r.feature, firstAt: toDate(r.first_at) }]
          : [],
      );
    },

    async slackSetups() {
      const rows = await db.execute<{ sub: string; first_at: number }>(sql`
        SELECT actor_sub AS sub, ${epochMs("first_at")} AS first_at
        FROM usage_slack_setup_firsts`);
      return rows.map((r) => ({ sub: r.sub, firstAt: toDate(r.first_at) }));
    },

    async kitAgents() {
      const rows = await db.execute<{
        agent_id: string;
        sub: string;
        kit_id: string | null;
        created_at: number;
        onboarded_at: number | null;
        checklist_started: boolean;
      }>(sql`
        SELECT agent_id, actor_sub AS sub, kit_id,
               ${epochMs("created_at")} AS created_at,
               ${epochMs("onboarded_at")} AS onboarded_at,
               checklist_started
        FROM usage_kit_agents`);
      return rows.map((r) => ({
        agentId: r.agent_id,
        sub: r.sub,
        kitId: r.kit_id ?? "unknown",
        createdAt: toDate(r.created_at),
        onboardedAt: toDateOrNull(r.onboarded_at),
        checklistStarted: r.checklist_started,
      }));
    },

    async agentsCreated() {
      const rows = await db.execute<{
        agent_id: string;
        owner_sub: string;
        created_at: number;
        kit_id: string | null;
      }>(sql`
        SELECT agent_id, owner_sub, ${epochMs("created_at")} AS created_at, kit_id
        FROM usage_agents_created`);
      return rows.map((r) => ({
        agentId: r.agent_id,
        ownerSub: r.owner_sub,
        createdAt: toDate(r.created_at),
        kitId: r.kit_id,
      }));
    },

    async outOfMemoryAgentIds(sinceDays) {
      const rows = await db.execute<{ agent_id: string }>(sql`
        SELECT DISTINCT agent_id FROM usage_agent_oom_days
        WHERE day >= (now() AT TIME ZONE 'UTC')::date - ${sinceDays}::int`);
      return new Set(rows.map((r) => r.agent_id));
    },

    async knowledgeBaseConnectionIds() {
      const rows = await db.execute<{ id: string }>(sql`
        SELECT id FROM connections WHERE template_id = ${SHARED_KB_TEMPLATE_ID}`);
      return new Set(rows.map((r) => r.id));
    },
  };
}
