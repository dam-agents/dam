import { harnessT } from "../../harness-trpc.js";
import {
  scriptReportInputSchema,
  scriptUploadsInputSchema,
} from "./harness.js";

const v1Router = harnessT.router({
  scriptUploads: harnessT.procedure
    .input(scriptUploadsInputSchema)
    .mutation(({ ctx }) => ctx.invocationScripts.uploads(ctx.agentId)),
  reportScript: harnessT.procedure
    .input(scriptReportInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.invocationScripts.report(ctx.agentId, input),
    ),
});

export const invocationsHarnessRouter = harnessT.router({ v1: v1Router });
