import { sessionDirectoryReportSchema } from "agent-runtime-api";

import { harnessT } from "../../harness-trpc.js";

const v1Router = harnessT.router({
  report: harnessT.procedure
    .input(sessionDirectoryReportSchema)
    .mutation(({ ctx, input }) =>
      ctx.sessionDirectory.record(ctx.agentId, input.sessions),
    ),
});

export const harnessSessionDirectoryRouter = harnessT.router({ v1: v1Router });
