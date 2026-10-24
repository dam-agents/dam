import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
  checkAgentBinding,
  operateAgentsProcedure,
} from "../../auth-procedures.js";
import type { AgentTarget } from "../agents/permissions.js";
import {
  approvalApproveHostInputSchema,
  approvalApproveOnceInputSchema,
  approvalApprovePermanentInputSchema,
  approvalDenyForeverInputSchema,
  approvalDismissInputSchema,
  approvalDismissManyInputSchema,
  approvalListForInstanceInputSchema,
  approvalListForOwnerInputSchema,
} from "./schemas.js";

function approvalsTarget(approvalIds: readonly string[]): AgentTarget {
  return { kind: "approvals", approvalIds };
}

export const approvalsRouter = t.router({
  listForOwner: operateAgentsProcedure
    .input(approvalListForOwnerInputSchema)
    .query(({ ctx, input }) => ctx.approvals.listForOwner(input)),

  listForInstance: operateAgentsProcedure
    .input(approvalListForInstanceInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.approvals.listForInstance(input.agentId, {
        limit: input.limit,
        status: input.status,
      });
    }),

  approveOnce: operateAgentsProcedure
    .input(approvalApproveOnceInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.approvals.approveOnce(input.id)),

  approvePermanent: operateAgentsProcedure
    .input(approvalApprovePermanentInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.approvals.approvePermanent(input.id)),

  approveHost: operateAgentsProcedure
    .input(approvalApproveHostInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.approvals.approveHost(input.id)),

  denyForever: operateAgentsProcedure
    .input(approvalDenyForeverInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.approvals.denyForever(input.id)),

  dismiss: operateAgentsProcedure
    .input(approvalDismissInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget([input.id])))
    .mutation(({ ctx, input }) => ctx.approvals.dismiss(input.id)),

  dismissMany: operateAgentsProcedure
    .input(approvalDismissManyInputSchema)
    .use(agentPermission("view", (input) => approvalsTarget(input.ids)))
    .mutation(({ ctx, input }) => ctx.approvals.dismissMany(input.ids)),
});
