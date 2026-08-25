import { harnessT } from "../../harness-trpc.js";
import { artifactTouchReportInputSchema } from "../artifact-library/schemas.js";
import { helloInput } from "./types.js";

const v1Router = harnessT.router({
  hello: harnessT.procedure
    .input(helloInput)
    .mutation(({ ctx, input }) =>
      ctx.runtimeDelivery.hello(ctx.agentId, input),
    ),
  reportArtifactTouch: harnessT.procedure
    .input(artifactTouchReportInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.artifactTouches.record({ agentId: ctx.agentId, ...input }),
    ),
});

export const harnessRuntimeRouter = harnessT.router({
  v1: v1Router,
});
