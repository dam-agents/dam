import { t } from "../../trpc.js";
import {
  approvalApproveHostInputSchema,
  approvalApproveOnceInputSchema,
  approvalApprovePermanentInputSchema,
  approvalDenyForeverInputSchema,
  approvalDismissInputSchema,
  approvalListForInstanceInputSchema,
  approvalListForOwnerInputSchema,
} from "./schemas.js";

export const approvalsRouter = t.router({
  listForOwner: t.procedure
    .input(approvalListForOwnerInputSchema)
    .query(({ ctx, input }) => ctx.approvals.listForOwner(input)),

  listForInstance: t.procedure
    .input(approvalListForInstanceInputSchema)
    .query(({ ctx, input }) =>
      ctx.approvals.listForInstance(input.agentId, {
        limit: input.limit,
        status: input.status,
      }),
    ),

  approveOnce: t.procedure
    .input(approvalApproveOnceInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approveOnce(input.id)),

  approvePermanent: t.procedure
    .input(approvalApprovePermanentInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approvePermanent(input.id)),

  approveHost: t.procedure
    .input(approvalApproveHostInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approveHost(input.id)),

  denyForever: t.procedure
    .input(approvalDenyForeverInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.denyForever(input.id)),

  dismiss: t.procedure
    .input(approvalDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.dismiss(input.id)),
});
