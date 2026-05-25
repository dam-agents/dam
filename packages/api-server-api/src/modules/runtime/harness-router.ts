import { harnessT } from "../../harness-trpc.js";
import { helloInput } from "./types.js";

/**
 * `runtime.v1.*` on the harness API. The agent calls `hello` on boot/wake
 * (ADR-052). Per-kind event work is dispatched agent-side — there is no
 * per-event callback to api-server.
 */
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
