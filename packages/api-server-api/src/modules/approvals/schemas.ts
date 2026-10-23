import { z } from "zod";
import { EGRESS_HOST } from "../egress-rules/schemas.js";

export const approvalStatusSchema = z.enum(["pending", "resolved", "expired"]);

export const approvalTypeSchema = z.enum([
  "ext_authz",
  "acp_native",
  "spend_limit",
  "egress_proposal",
]);

export const approvalListOptionsSchema = z.object({
  limit: z.number().int().positive().max(500).optional(),
  status: approvalStatusSchema.optional(),
});

const idSchema = z.object({ id: z.string().min(1) });

export const approvalListForOwnerInputSchema =
  approvalListOptionsSchema.optional();

export const approvalListForInstanceInputSchema =
  approvalListOptionsSchema.extend({
    agentId: z.string().min(1),
  });

export const approvalApproveOnceInputSchema = idSchema;
export const approvalApprovePermanentInputSchema = idSchema;
export const approvalApproveHostInputSchema = idSchema;
export const approvalDenyForeverInputSchema = idSchema;
export const approvalDismissInputSchema = idSchema;
export const approvalDismissManyInputSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

const approvalActionRuleSchema = z.object({
  host: z.string(),
  method: z.string(),
  pathPattern: z.string(),
  verdict: z.enum(["allow", "deny"]),
});

export const approvalActionOutcomeSchema = z.object({
  outcome: z.enum(["applied", "rule_written_expired", "not_actionable"]),
  type: approvalTypeSchema.nullable(),
  rule: approvalActionRuleSchema.nullable(),
});

export const EGRESS_PROPOSAL_REASON_MAX = 300;

export const egressProposalInputSchema = z.object({
  host: z
    .string()
    .min(1)
    .max(253)
    .regex(EGRESS_HOST, "host must be a DNS hostname or a *.wildcard")
    .refine((host) => host !== "*", "a rule for every host is not proposed"),
  port: z.number().int().min(1).max(65535).optional(),
  method: z
    .enum(["*", "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    .default("*"),
  path: z
    .string()
    .min(1)
    .max(1024)
    .regex(/^(?:\*|\/\S*)$/, "path must be * or start with /")
    .default("*"),
  reason: z.string().trim().min(1).max(EGRESS_PROPOSAL_REASON_MAX),
});
export type EgressProposalInput = z.infer<typeof egressProposalInputSchema>;
