import type { Db } from "db";
import { agents, agentSettings, eq } from "db";
import { agentConfigOptionsSchema, type AgentSettings } from "api-server-api";

export interface AgentSettingsRepository {
  get(agentId: string): Promise<AgentSettings | null>;
  upsert(agentId: string, settings: AgentSettings): Promise<void>;
  deleteByAgent(agentId: string): Promise<void>;
  /** Whether the agent has advertised the `harness-config` contribution. An
   *  agent that hasn't reported capabilities yet (never booted) is treated as
   *  supported, so the UI doesn't flicker the section off on first start. */
  supportsHarnessConfig(agentId: string): Promise<boolean>;
}

/** Postgres-backed per-agent harness defaults, keyed by agentId. Lifecycle is
 *  bounded by the agent: the row goes away when the agent is deleted, via the
 *  AgentDeleted saga in this module. */
export function createAgentSettingsRepository(db: Db): AgentSettingsRepository {
  return {
    async get(agentId) {
      const [row] = await db
        .select()
        .from(agentSettings)
        .where(eq(agentSettings.agentId, agentId));
      if (!row) return null;
      return {
        model: row.model,
        mode: row.mode,
        configOptions: normalizeConfigOptions(row.configOptions),
      };
    },

    async upsert(agentId, settings) {
      const values = {
        agentId,
        model: settings.model,
        mode: settings.mode,
        configOptions: settings.configOptions,
        updatedAt: new Date(),
      };
      await db
        .insert(agentSettings)
        .values(values)
        .onConflictDoUpdate({
          target: agentSettings.agentId,
          set: {
            model: values.model,
            mode: values.mode,
            configOptions: values.configOptions,
            updatedAt: values.updatedAt,
          },
        });
    },

    async deleteByAgent(agentId) {
      await db.delete(agentSettings).where(eq(agentSettings.agentId, agentId));
    },

    async supportsHarnessConfig(agentId) {
      const [row] = await db
        .select({ capabilities: agents.runtimeCapabilities })
        .from(agents)
        .where(eq(agents.id, agentId));
      return harnessConfigSupported(row?.capabilities);
    },
  };
}

/** Decide whether an agent's advertised capabilities include `harness-config`.
 *  Unknown capabilities (agent never booted, or no row) are treated as
 *  supported so the UI section doesn't flicker off on first start. */
export function harnessConfigSupported(capabilities: unknown): boolean {
  if (capabilities == null) return true;
  const caps = capabilities as { contributions?: unknown };
  return (
    Array.isArray(caps.contributions) &&
    caps.contributions.includes("harness-config")
  );
}

/** The jsonb column is `unknown` to Drizzle; validate defensively on read so a
 *  hand-edited row can never crash the state build. */
export function normalizeConfigOptions(
  raw: unknown,
): Record<string, string | boolean> {
  const parsed = agentConfigOptionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
