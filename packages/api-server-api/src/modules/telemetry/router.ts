import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  telemetryInvocationTurnsInputSchema,
  telemetryLogsInputSchema,
  telemetryTurnInputSchema,
  telemetryTurnsInputSchema,
} from "./schemas.js";

export const telemetryRouter = t.router({
  turns: readAgentProcedure
    .input(telemetryTurnsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.telemetry.turns(input);
    }),
  turn: readAgentProcedure
    .input(telemetryTurnInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.telemetry.turn(input);
    }),
  invocationTurns: readAgentProcedure
    .input(telemetryInvocationTurnsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.telemetry.invocationTurns(input);
    }),
  logs: readAgentProcedure
    .input(telemetryLogsInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.telemetry.logs(input);
    }),
});
