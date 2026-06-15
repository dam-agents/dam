import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const channelsRouter = t.router({
  // What messenger channels the operator has enabled for this deployment —
  // operator capability flag, ungated beyond "is some agent-scoped principal".
  available: readAgentProcedure.query(({ ctx }) => ctx.channels.available),
});
