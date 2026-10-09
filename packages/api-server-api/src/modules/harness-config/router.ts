import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  harnessConfigApplyInputSchema,
  harnessConfigSettledSchema,
  harnessConfigSnapshotResultSchema,
  harnessConfigStatusInputSchema,
  harnessConfigStatusSchema,
} from "./schemas.js";

export const harnessConfigRouter = t.router({
  status: readAgentProcedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigStatusSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.status(input.agentId);
    }),

  settled: readAgentProcedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigSettledSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.settled(input.agentId);
    }),

  snapshot: readAgentProcedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigSnapshotResultSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.snapshot(input.agentId);
    }),

  set: manageAgentsProcedure
    .input(harnessConfigApplyInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...change } = input;
      return ctx.harnessConfig.apply(agentId, change);
    }),
});
