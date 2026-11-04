import { t } from "../../trpc.js";
import { signedInProcedure } from "../../auth-procedures.js";

export const assistantsRouter = t.router({
  state: signedInProcedure.query(({ ctx }) => ctx.assistants.state()),
  dismissNotice: signedInProcedure.mutation(({ ctx }) =>
    ctx.assistants.dismissNotice(),
  ),
});
