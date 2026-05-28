import { z } from "zod";

export const ruleVerdictSchema = z.enum(["allow", "deny"]);

// Used both by egress-rules procedures (applyPreset) and by
// agents.create (transient bulk-seed selector at agent creation; the
// preset is not stored on the agent spec — the seeded rules' `source`
// is the truth). See ADR-035.
export const egressPresetSchema = z.enum(["none", "trusted", "all"]);

export const egressRuleListForAgentInputSchema = z.object({
  agentId: z.string().min(1),
});

export const egressRuleCurrentPresetInputSchema = z.object({
  agentId: z.string().min(1),
});

export const egressRuleCreateInputSchema = z.object({
  agentId: z.string().min(1),
  host: z.string().min(1),
  method: z.string().min(1),
  pathPattern: z.string().min(1),
  verdict: ruleVerdictSchema,
});

export const egressRuleUpdateInputSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1),
  pathPattern: z.string().min(1),
  verdict: ruleVerdictSchema,
});

export const egressRuleRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export const egressRuleApplyPresetInputSchema = z.object({
  agentId: z.string().min(1),
  preset: egressPresetSchema,
});
