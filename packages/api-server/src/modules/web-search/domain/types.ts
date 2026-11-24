import type { WebSearchVerdict } from "api-server-api";

export interface WebSearchRuleRow {
  agentId: string;
  verdict: WebSearchVerdict;
  decidedBy: string;
  decidedAt: Date;
}
