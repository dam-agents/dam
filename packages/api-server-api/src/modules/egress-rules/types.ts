import type { z } from "zod";
import type {
  egressPresetSchema,
  egressRuleCreateInputSchema,
  egressRuleUpdateInputSchema,
  ruleVerdictSchema,
} from "./schemas.js";

export type RuleVerdict = z.infer<typeof ruleVerdictSchema>;

export type EgressPreset = z.infer<typeof egressPresetSchema>;

export type EgressRuleSource =
  | "manual"
  | "inbox"
  | `connection:${string}`
  | "preset:trusted"
  | "preset:all";

export interface EgressRuleView {
  id: string;
  agentId: string;
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedAt: string;
  source: EgressRuleSource;
}

export type EgressRuleCreateInput = z.infer<typeof egressRuleCreateInputSchema>;
export type EgressRuleUpdateInput = z.infer<typeof egressRuleUpdateInputSchema>;

export interface EgressRulesService {
  listForAgent(agentId: string): Promise<EgressRuleView[]>;
  get(id: string): Promise<EgressRuleView>;
  currentPreset(agentId: string): Promise<EgressPreset>;
  trustedHosts(): Promise<readonly string[]>;
  create(input: EgressRuleCreateInput): Promise<EgressRuleView>;
  update(input: EgressRuleUpdateInput): Promise<EgressRuleView>;
  revoke(id: string): Promise<void>;
  applyPreset(agentId: string, preset: EgressPreset): Promise<void>;
}
