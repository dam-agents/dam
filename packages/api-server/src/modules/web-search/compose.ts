import type { Db } from "db";
import type { WebSearchService } from "api-server-api";
import { createWebSearchRepository } from "./infrastructure/web-search-repository.js";
import {
  createWebSearchService,
  type CreateWebSearchServiceDeps,
} from "./services/web-search-service.js";

export function composeWebSearchForOwner(
  deps: Omit<CreateWebSearchServiceDeps, "repo"> & { db: Db },
): WebSearchService {
  const { db, ...serviceDeps } = deps;
  return createWebSearchService({
    ...serviceDeps,
    repo: createWebSearchRepository(db),
  });
}

// UNIT_BOUNDARY_DESCRIPTION: what the ext_authz gate reads for web search: an agent's switch and its rule, and how a permanent verdict on a held search writes that rule.
export function createWebSearchGatePorts(db: Db) {
  const repo = createWebSearchRepository(db);
  return {
    control: { isOn: (agentId: string) => repo.controlOf(agentId) },
    rules: {
      verdictOf: async (agentId: string) =>
        (await repo.ruleOf(agentId))?.verdict ?? null,
    },
    ruleWriter: {
      write: async (input: {
        agentId: string;
        verdict: "allow" | "deny";
        decidedBy: string;
      }) => {
        await repo.writeRule(input);
      },
    },
  };
}

export function createWebSearchCleanupHook(
  db: Db,
): (agentId: string) => Promise<void> {
  const repo = createWebSearchRepository(db);
  return (agentId) => repo.clearRule(agentId);
}

export function listWebSearchRuleAgentIds(db: Db): Promise<string[]> {
  return createWebSearchRepository(db).listAgentIds();
}
