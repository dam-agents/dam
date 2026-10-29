import { harnessT } from "../../harness-trpc.js";
import { harnessCallCostsInputSchema } from "./harness.js";

const v1Router = harnessT.router({
  callCosts: harnessT.procedure
    .input(harnessCallCostsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.spendCalls.callCosts(ctx.agentId, input.routerCallIds),
    ),
});

export const spendHarnessRouter = harnessT.router({ v1: v1Router });
