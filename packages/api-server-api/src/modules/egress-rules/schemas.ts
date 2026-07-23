import { z } from "zod";

export const ruleVerdictSchema = z.enum(["allow", "deny"]);

// A narrowed rule's host is promoted onto the gateway's Envoy config
// (an unescaped text/template field) and cert SANs, so it must be a real
// DNS hostname — no quotes, whitespace, or YAML metacharacters that could
// break out of the rendered scalar. `*.` wildcards are allowed (valid SAN
// shape); bare `*` is allowed as the "everything" host used by the deny-all
// / trusted-none rule, which stays on the L4 path and is never promoted.
// This is the friendly front-door check; the Agent CRD's l7Hosts pattern
// is the hard boundary the controller trusts. Only new creates are gated
// (host is not editable), so existing rows are never re-validated.
const HOSTNAME =
  /^(\*\.)?[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$/;
const egressHostSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((h) => h === "*" || HOSTNAME.test(h), {
    message: "host must be a DNS hostname, a *.wildcard, or bare *",
  });

// Used both by egress-rules procedures (applyPreset) and by
// agents.create (transient bulk-seed selector at agent creation; the
// preset is not stored on the agent spec — the seeded rules' `source`
// is the truth).
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
  // Upstream port; omit for 443. Promotes the host onto the L7 chain.
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

export const egressRuleRevokeInputSchema = z.object({
  id: z.string().min(1),
});

export const egressRuleApplyPresetInputSchema = z.object({
  agentId: z.string().min(1),
  preset: egressPresetSchema,
});
