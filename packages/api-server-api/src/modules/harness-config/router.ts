import { t } from "../../trpc.js";
import {
  harnessConfigApplyInputSchema,
  harnessConfigSettledSchema,
  harnessConfigStatusInputSchema,
  harnessConfigStatusSchema,
} from "./schemas.js";

export const harnessConfigRouter = t.router({
  status: t.procedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigStatusSchema)
    .query(({ ctx, input }) => ctx.harnessConfig.status(input.agentId)),

  // Polled after `set` to know when the change has settled into the harness
  // config file (whole-outbox coarse settle — see harnessConfigSettledSchema).
  settled: t.procedure
    .input(harnessConfigStatusInputSchema)
    .output(harnessConfigSettledSchema)
    .query(({ ctx, input }) => ctx.harnessConfig.settled(input.agentId)),

  // `set` (not `apply`): `apply` is a tRPC-reserved router key.
  set: t.procedure
    .input(harnessConfigApplyInputSchema)
    .mutation(({ ctx, input }) => {
      const { agentId, ...change } = input;
      return ctx.harnessConfig.apply(agentId, change);
    }),
});
