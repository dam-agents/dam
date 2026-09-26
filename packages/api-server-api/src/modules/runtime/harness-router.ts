import { harnessT } from "../../harness-trpc.js";
import { eventReportInput, helloInput } from "agent-runtime-api";

const v1Router = harnessT.router({
  hello: harnessT.procedure
    .input(helloInput)
    .mutation(({ ctx, input }) =>
      ctx.runtimeDelivery.hello(ctx.agentId, input),
    ),
  reportEvent: harnessT.procedure
    .input(eventReportInput)
    .mutation(({ ctx, input }) =>
      ctx.runtimeDelivery.reportEvent(ctx.agentId, input),
    ),
});

export const harnessRuntimeRouter = harnessT.router({
  v1: v1Router,
});
