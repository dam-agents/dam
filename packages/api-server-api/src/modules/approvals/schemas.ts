import { z } from "zod";

export const approvalStatusSchema = z.enum(["pending", "resolved", "expired"]);

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
