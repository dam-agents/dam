import type { EgressRuleSource, RuleVerdict } from "api-server-api";

export interface EgressRuleRow {
  id: string;
  agentId: string;
  host: string;
  /** Upstream port when not 443. Transparency only — matching is host-based. */
  port?: number;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: Date;
  status: "active" | "revoked";
  source: EgressRuleSource;
}
