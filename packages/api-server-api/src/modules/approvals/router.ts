import { z } from "zod";
import { t } from "../../trpc.js";

const approvalStatus = z.enum(["pending", "resolved", "expired"]);
const listOptionFields = {
  limit: z.number().int().positive().max(500).optional(),
  status: approvalStatus.optional(),
} as const;

export const approvalsRouter = t.router({
  listForOwner: t.procedure
    .input(z.object(listOptionFields).optional())
    .query(({ ctx, input }) => ctx.approvals.listForOwner(input)),

  listForInstance: t.procedure
    .input(z.object({ agentId: z.string().min(1), ...listOptionFields }))
    .query(({ ctx, input }) =>
      ctx.approvals.listForInstance(input.agentId, {
        limit: input.limit,
        status: input.status,
      }),
    ),

  approveOnce: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approveOnce(input.id)),

  approvePermanent: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approvePermanent(input.id)),

  approveHost: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.approveHost(input.id)),

  denyForever: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.denyForever(input.id)),

  dismiss: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.approvals.dismiss(input.id)),
});
