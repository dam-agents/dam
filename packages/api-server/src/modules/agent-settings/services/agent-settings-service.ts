import { TRPCError } from "@trpc/server";
import type {
  AgentSettings,
  AgentSettingsInput,
  AgentSettingsService,
} from "api-server-api";
import type { AgentSettingsRepository } from "../infrastructure/agent-settings-repository.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";

const EMPTY: AgentSettings = { model: null, mode: null, configOptions: {} };

export function createAgentSettingsService(deps: {
  repo: AgentSettingsRepository;
  runtimeMutator: RuntimeMutator;
  isOwnedAgent: (agentId: string) => Promise<boolean>;
}): AgentSettingsService {
  async function requireOwned(agentId: string): Promise<void> {
    if (!(await deps.isOwnedAgent(agentId))) {
      throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
    }
  }

  return {
    async get(agentId) {
      await requireOwned(agentId);
      const [settings, supported] = await Promise.all([
        deps.repo.get(agentId),
        deps.repo.supportsHarnessConfig(agentId),
      ]);
      return { ...(settings ?? EMPTY), supported };
    },

    async set(agentId, input: AgentSettingsInput) {
      await requireOwned(agentId);
      const settings: AgentSettings = {
        model: input.model,
        mode: input.mode,
        configOptions: input.configOptions,
      };
      await deps.repo.upsert(agentId, settings);
      // Re-deliver the agent's desired state: the state-builder picks the new
      // row up as a `harness-config` contribution. Mirrors connection grants —
      // the user-facing response never waits on agent reachability.
      await deps.runtimeMutator.bump(agentId, []);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      return settings;
    },
  };
}
