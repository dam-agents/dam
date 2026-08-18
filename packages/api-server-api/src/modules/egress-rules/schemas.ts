import { z } from "zod";

export const ruleVerdictSchema = z.enum(["allow", "deny"]);

const HOSTNAME =
  /^(\*\.)?[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$/;
const egressHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((h) => h === "*" || HOSTNAME.test(h), {
    message: "host must be a DNS hostname, a *.wildcard, or bare *",
  });

export const egressPresetSchema = z.enum(["none", "trusted", "all"]);

export const egressRuleListForAgentInputSchema = z.object({
  agentId: z.string().min(1),
});

export const egressRuleCurrentPresetInputSchema = z.object({
  agentId: z.string().min(1),
});

export const egressRuleCreateInputSchema = z.object({
  agentId: z.string().min(1),
  host: egressHostSchema,
  port: z.number().int().min(1).max(65535).optional(),
  method: z.string().min(1).default("*"),
  pathPattern: z.string().min(1).default("*"),
  verdict: ruleVerdictSchema,
});

export const egressRuleUpdateInputSchema = z.object({
  id: z.string().min(1),
  method: z.string().min(1).optional(),
  pathPattern: z.string().min(1).optional(),
  verdict: ruleVerdictSchema.optional(),
});

export const egressRuleGetInputSchema = z.object({
  id: z.string().min(1),
});

export const egressRuleRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export const egressRuleApplyPresetInputSchema = z.object({
  agentId: z.string().min(1),
  preset: egressPresetSchema,
});
