import { t } from "../../trpc.js";
import { readAgentProcedure } from "../../auth-procedures.js";

export const providerStatusRouter = t.router({
  list: readAgentProcedure.query(({ ctx }) => ctx.providerStatus.view()),
});
