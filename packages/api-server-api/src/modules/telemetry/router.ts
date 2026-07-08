import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { telemetryOverviewInputSchema } from "./schemas.js";

// Ownership is enforced in the service (it resolves the caller's owned agent
// IDs and filters on them). When a specific agentId is requested we also apply
// the API-key binding check, matching the rest of the agent-read surface.
export const telemetryRouter = t.router({
  overview: readAgentProcedure
    .input(telemetryOverviewInputSchema)
    .query(({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.telemetry.overview(input);
    }),
});
