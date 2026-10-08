import { manageAgentsProcedure } from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import {
  harnessConfigApplyInputSchema,
  harnessConfigSettledSchema,
  harnessConfigSnapshotInputSchema,
  harnessConfigSnapshotResultSchema,
  rememberSessionPairInputSchema,
  sessionPairSchema,
  harnessConfigStatusInputSchema,
  harnessConfigStatusSchema,
} from "./schemas.js";

export const harnessConfigRouter = t.router({
  status: t.procedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigStatusSchema)
    .query(({ ctx, input }) => ctx.harnessConfig.status(input.agentId)),

  settled: t.procedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigSettledSchema)
    .query(({ ctx, input }) => ctx.harnessConfig.settled(input.agentId)),

  snapshot: t.procedure
    .input(harnessConfigSnapshotInputSchema)
    .output(harnessConfigSnapshotResultSchema)
    .query(({ ctx, input }) =>
      ctx.harnessConfig.snapshot(input.agentId, input.harness),
    ),

  sessionPair: t.procedure
    .input(harnessConfigStatusInputSchema)
    .output(sessionPairSchema.nullable())
    .query(({ ctx, input }) => ctx.harnessConfig.sessionPair(input.agentId)),

  rememberSessionPair: manageAgentsProcedure
    .input(rememberSessionPairInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...pair } = input;
      return ctx.harnessConfig.rememberSessionPair(agentId, pair);
    }),

  set: t.procedure
    .input(harnessConfigApplyInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...change } = input;
      return ctx.harnessConfig.apply(agentId, change);
    }),
});
