import { harnessT } from "../../harness-trpc.js";
import { fireTriggerInput, helloInput } from "./types.js";

/**
 * `runtime.v1.*` on the harness API. The agent calls these on boot/wake
 * (`hello`) and once per event it must execute (`events.<kind>`).
 *
 * Adding a new event kind = one new sub-route here + one handler in the
 * harness API module + one new side-effect table with a unique constraint
 * joining back to `runtime_events.id`. The worker module does not change.
 */
const eventsRouter = harnessT.router({
  trigger: harnessT.procedure
    .input(fireTriggerInput)
    .mutation(({ ctx, input }) => ctx.triggerHandler.fire(ctx.agentId, input)),
});

const v1Router = harnessT.router({
  hello: harnessT.procedure
    .input(helloInput)
    .mutation(({ ctx, input }) =>
      ctx.runtimeDelivery.hello(ctx.agentId, input),
    ),
  events: eventsRouter,
});

export const harnessRuntimeRouter = harnessT.router({
  v1: v1Router,
});
