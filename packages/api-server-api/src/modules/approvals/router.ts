import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  operateAgentsProcedure,
} from "../../auth-procedures.js";
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
  listForOwner: operateAgentsProcedure
    .input(approvalListForOwnerInputSchema)
    .query(({ ctx, input }) => ctx.approvals.listForOwner(input)),

  listForInstance: operateAgentsProcedure
    .input(approvalListForInstanceInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.approvals.listForInstance(input.agentId, {
        limit: input.limit,
        status: input.status,
      });
    }),

  approveOnce: operateAgentsProcedure
    .input(approvalApproveOnceInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approveOnce(input.id)),

  approvePermanent: operateAgentsProcedure
    .input(approvalApprovePermanentInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approvePermanent(input.id)),

  approveHost: operateAgentsProcedure
    .input(approvalApproveHostInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.approveHost(input.id)),

  denyForever: operateAgentsProcedure
    .input(approvalDenyForeverInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.denyForever(input.id)),

  dismiss: operateAgentsProcedure
    .input(approvalDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.approvals.dismiss(input.id)),
});
