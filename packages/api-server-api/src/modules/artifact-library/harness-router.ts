import { harnessT } from "../../harness-trpc.js";
import { artifactTouchReportInputSchema } from "./schemas.js";

const v1Router = harnessT.router({
  reportTouch: harnessT.procedure
    .input(artifactTouchReportInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.artifactTouches.recordTouch({ agentId: ctx.agentId, ...input }),
    ),
});

export const artifactLibraryHarnessRouter = harnessT.router({
  v1: v1Router,
});
