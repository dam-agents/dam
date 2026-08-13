import { t } from "../../trpc.js";
import {
  harnessConfigApplyInputSchema,
  harnessConfigSettledSchema,
  harnessConfigSnapshotResultSchema,
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
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigSnapshotResultSchema)
    .query(({ ctx, input }) => ctx.harnessConfig.snapshot(input.agentId)),

  set: t.procedure
    .input(harnessConfigApplyInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...change } = input;
      return ctx.harnessConfig.apply(agentId, change);
    }),
});
