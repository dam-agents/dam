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
  | "kit"
  | `connection:${string}`
  | "preset:trusted"
  | "preset:all"
  | typeof CHILD_DRIVER_SOURCE
  | typeof CHILD_INHERITED_SOURCE
  | typeof PLATFORM_ENVIRONMENTS_SOURCE;

// UNIT_BOUNDARY_DESCRIPTION: the sources of a detached child's own rules: those its launching agent set on an open child, and those copied from its parent onto a scoped child at launch.
export const CHILD_DRIVER_SOURCE = "driver";
export const CHILD_INHERITED_SOURCE = "inherited";

// UNIT_BOUNDARY_DESCRIPTION: an allow rule that opens a child to any host, or to a whole top-level domain ("*.com"): its owner, a person, grants it on an approval; the agent that sets the child's rules never writes it.
export function isFullEgressRule(rule: {
  host: string;
  verdict: string;
}): boolean {
  if (rule.verdict !== "allow") return false;
  const host = rule.host.trim().toLowerCase();
  return host === "*" || /^\*\.[^.*]+$/.test(host);
}

// UNIT_BOUNDARY_DESCRIPTION: the source of the one rule the platform itself adds to every Agent on an install that serves Environments: the environments domain, allowed, with the Agent's key sent to the Environment gate. Shown to its owner as a rule of its own, which they can remove and restore, never edit.
export const PLATFORM_ENVIRONMENTS_SOURCE = "platform:environments";

export interface EgressRuleView {
  id: string;
  agentId: string;
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
  verdict: RuleVerdict;
  decidedBy: string;
  decidedByEmail?: string;
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
  platformRule(agentId: string): Promise<PlatformRuleState>;
  restorePlatformRule(agentId: string): Promise<EgressRuleView>;
}

// UNIT_BOUNDARY_DESCRIPTION: whether an Agent carries the platform's Environments rule: `active` (listed among its rules), `removed` (its owner removed it, and it can be restored), or `unavailable` (the install serves no Environments, or the Agent is an Environment).
export type PlatformRuleState =
  | { state: "active"; host: string }
  | { state: "removed"; host: string }
  | { state: "unavailable" };
