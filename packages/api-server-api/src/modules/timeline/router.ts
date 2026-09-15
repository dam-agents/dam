import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  timelineLogsInputSchema,
  timelineTurnInputSchema,
  timelineTurnsInputSchema,
} from "./schemas.js";

export const timelineRouter = t.router({
  turns: readAgentProcedure
    .input(timelineTurnsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.turns(input);
    }),
  turn: readAgentProcedure
    .input(timelineTurnInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.turn(input);
    }),
  logs: readAgentProcedure
    .input(timelineLogsInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.timeline.logs(input);
    }),
});
