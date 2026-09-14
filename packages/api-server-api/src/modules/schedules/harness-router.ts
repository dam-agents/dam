import { harnessT } from "../../harness-trpc.js";
import { scheduleFireReportInputSchema } from "./schemas.js";

const v1Router = harnessT.router({
  reportFire: harnessT.procedure
    .input(scheduleFireReportInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.scheduleFireReporting.reportFire(ctx.agentId, input),
    ),
});

export const harnessSchedulesRouter = harnessT.router({ v1: v1Router });
