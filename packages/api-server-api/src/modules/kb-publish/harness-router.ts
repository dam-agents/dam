import { harnessT } from "../../harness-trpc.js";
import {
  kbPublishCompleteInputSchema,
  kbPublishRequestInputSchema,
} from "./harness.js";

export const kbPublishHarnessRouter = harnessT.router({
  request: harnessT.procedure
    .input(kbPublishRequestInputSchema)
    .mutation(({ ctx, input }) => ctx.kbPublish.request(ctx.agentId, input)),

  complete: harnessT.procedure
    .input(kbPublishCompleteInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.kbPublish.complete(ctx.agentId, input.ticket, input.report),
    ),
});
