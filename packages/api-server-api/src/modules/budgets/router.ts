import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

// Owner scoping happens in the service (it reads only the caller's agents
// and ceiling); there is no agent-targeted input to bind an API key to.
export const budgetsRouter = t.router({
  reserved: readAgentProcedure.query(({ ctx }) => ctx.budgets.reserved()),
});
