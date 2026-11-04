import { t } from "../../trpc.js";
import { signedInProcedure } from "../../auth-procedures.js";

export const assistantsRouter = t.router({
  notice: signedInProcedure.query(({ ctx }) => ctx.assistants.notice()),
  dismissNotice: signedInProcedure.mutation(({ ctx }) =>
    ctx.assistants.dismissNotice(),
  ),
});
