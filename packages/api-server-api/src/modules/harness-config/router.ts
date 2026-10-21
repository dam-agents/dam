import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import {
  harnessConfigApplyInputSchema,
  harnessConfigDefaultForInputSchema,
  harnessConfigSettledSchema,
  harnessConfigSnapshotInputSchema,
  harnessConfigSnapshotResultSchema,
  rememberSessionPairInputSchema,
  clearSessionDefaultInputSchema,
  sessionDefaultsSchema,
  sessionPairInputSchema,
  sessionPairSchema,
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
    .input(harnessConfigSnapshotInputSchema)
    .output(harnessConfigSnapshotResultSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.snapshot(input.agentId, input.harness);
    }),

  sessionPair: readAgentProcedure
    .input(sessionPairInputSchema)
    .output(sessionPairSchema.nullable())
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.sessionPair(input.agentId, input.kind);
    }),

  sessionDefaults: readAgentProcedure
    .input(harnessConfigStatusInputSchema)
    .output(sessionDefaultsSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.sessionDefaults(input.agentId);
    }),

  defaultFor: readAgentProcedure
    .input(harnessConfigDefaultForInputSchema)
    .output(sessionPairSchema.nullable())
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.harnessConfig.defaultFor(
        input.agentId,
        input.kind,
        input.harness,
      );
    }),

  rememberSessionPair: manageAgentsProcedure
    .input(rememberSessionPairInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, kind, ...pair } = input;
      return ctx.harnessConfig.rememberSessionPair(agentId, kind, pair);
    }),

  clearSessionDefault: manageAgentsProcedure
    .input(clearSessionDefaultInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.harnessConfig.clearSessionDefault(input.agentId, input.kind),
    ),

  set: manageAgentsProcedure
    .input(harnessConfigApplyInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...change } = input;
      return ctx.harnessConfig.apply(agentId, change);
    }),
});
