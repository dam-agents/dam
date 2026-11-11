import { TRPCError } from "@trpc/server";
import type {
  WebSearchRuleView,
  WebSearchService,
  WebSearchStateView,
} from "api-server-api";
import type { WebSearchRepository } from "../infrastructure/web-search-repository.js";
import type { WebSearchRuleRow } from "../domain/types.js";
import { securityLog } from "../../../core/security-log.js";

export interface CreateWebSearchServiceDeps {
  repo: WebSearchRepository;
  isAgentOwnedBy(agentId: string, ownerSub: string): Promise<boolean>;
  ownerSub: string;
  actor: string;
  resolveUserEmail(sub: string): Promise<string | null>;
}

// UNIT_BOUNDARY_DESCRIPTION: what the owner reads and sets about an agent's web search: whether control is on, and the agent's one web search rule, which the owner sets to always allow or always deny, or clears so every search asks again. Turning control on or off is an Agent setting, changed with the agent's other settings.
export function createWebSearchService(
  deps: CreateWebSearchServiceDeps,
): WebSearchService {
  async function assertOwned(agentId: string): Promise<void> {
    if (await deps.isAgentOwnedBy(agentId, deps.ownerSub)) return;
    securityLog("warn", "authz.owner_mismatch", {
      category: "authz",
      actor: deps.ownerSub,
      actorKind: "user",
      agentId,
      decision: "deny",
      reason: "not-owner",
      detail: { surface: "web-search" },
    });
    throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
  }

  async function viewOf(row: WebSearchRuleRow): Promise<WebSearchRuleView> {
    const email = await deps.resolveUserEmail(row.decidedBy).catch(() => null);
    return {
      verdict: row.verdict,
      decidedBy: row.decidedBy,
      ...(email ? { decidedByEmail: email } : {}),
      decidedAt: row.decidedAt.toISOString(),
    };
  }

  async function stateOf(agentId: string): Promise<WebSearchStateView> {
    const [control, rule] = await Promise.all([
      deps.repo.controlOf(agentId),
      deps.repo.ruleOf(agentId),
    ]);
    return { control, rule: rule ? await viewOf(rule) : null };
  }

  return {
    async state(agentId) {
      await assertOwned(agentId);
      return stateOf(agentId);
    },

    async setRule(agentId, verdict) {
      await assertOwned(agentId);
      if (verdict === null) await deps.repo.clearRule(agentId);
      else
        await deps.repo.writeRule({
          agentId,
          verdict,
          decidedBy: deps.actor,
        });
      securityLog("info", "web_search_rule.set", {
        category: "authz-list",
        actor: deps.actor,
        actorKind: "user",
        agentId,
        result: "success",
        detail: { verdict: verdict ?? "ask" },
      });
      return stateOf(agentId);
    },
  };
}
