import { harnessT } from "../../harness-trpc.js";
import {
  toolApprovalEndedInputSchema,
  toolApprovalWaitingInputSchema,
} from "./harness.js";

const v1Router = harnessT.router({
  waiting: harnessT.procedure
    .input(toolApprovalWaitingInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.toolApprovals.waiting(ctx.agentId, input),
    ),
  ended: harnessT.procedure
    .input(toolApprovalEndedInputSchema)
    .mutation(({ ctx, input }) => ctx.toolApprovals.ended(ctx.agentId, input)),
});

export const approvalsHarnessRouter = harnessT.router({ v1: v1Router });
