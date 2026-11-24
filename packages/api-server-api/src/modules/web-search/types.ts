import type { z } from "zod";
import type { webSearchVerdictSchema } from "./schemas.js";

export type WebSearchVerdict = z.infer<typeof webSearchVerdictSchema>;

// UNIT_BOUNDARY_DESCRIPTION: an agent's one remembered answer to a held web search: every later search is allowed, or every one is refused, without asking. It never names a query, because the agent writes the query.
export interface WebSearchRuleView {
  verdict: WebSearchVerdict;
  decidedBy: string;
  decidedByEmail?: string;
  decidedAt: string;
}

export interface WebSearchStateView {
  control: boolean;
  rule: WebSearchRuleView | null;
}

export interface WebSearchService {
  state(agentId: string): Promise<WebSearchStateView>;
  setRule(
    agentId: string,
    verdict: WebSearchVerdict | null,
  ): Promise<WebSearchStateView>;
}
