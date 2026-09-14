import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  timelineLogsInputSchema,
  timelineTraceInputSchema,
  timelineTracesInputSchema,
} from "./schemas.js";

export const timelineRouter = t.router({
  traces: readAgentProcedure
    .input(timelineTracesInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.traces(input);
    }),
  trace: readAgentProcedure
    .input(timelineTraceInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.trace(input);
    }),
  logs: readAgentProcedure
    .input(timelineLogsInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.logs(input);
    }),
});
