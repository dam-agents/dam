import { t } from "../../trpc.js";
import {
  operateAgentsProcedure,
  requireWildcardBinding,
  signedInProcedure,
} from "../../auth-procedures.js";
import { assistantFirstResultInputSchema } from "./schemas.js";

export const assistantsRouter = t.router({
  state: signedInProcedure.query(({ ctx }) => ctx.assistants.state()),
  /* UNIT_BOUNDARY_DESCRIPTION: the assistant's own report of the person's first result, over the Connection that lets it act as them. It takes the write scope an Agent's own key carries, and an unrestricted key: the record it writes is the person's, not one Agent's, so a key bound to some agents may not reach it. */
  recordFirstResult: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(assistantFirstResultInputSchema)
    .mutation(({ ctx, input }) => ctx.assistants.recordFirstResult(input)),
  resetOnboarding: signedInProcedure.mutation(({ ctx }) =>
    ctx.assistants.resetOnboarding(),
  ),
});
