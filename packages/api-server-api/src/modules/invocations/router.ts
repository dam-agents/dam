import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { invocationsTreeInputSchema } from "./schemas.js";

export const invocationsRouter = t.router({
  tree: readAgentProcedure
    .input(invocationsTreeInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.driverAgentId);
      return ctx.invocationsQuery.tree(input);
    }),
});
