import { harnessT } from "../../harness-trpc.js";
import { helloInput } from "./types.js";

const v1Router = harnessT.router({
  hello: harnessT.procedure
    .input(helloInput)
    .mutation(({ ctx, input }) =>
      ctx.runtimeDelivery.hello(ctx.agentId, input),
    ),
});

export const harnessRuntimeRouter = harnessT.router({
  v1: v1Router,
});
