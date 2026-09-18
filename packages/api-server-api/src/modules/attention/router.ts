import {
  operateAgentsProcedure,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

import { attentionDismissInputSchema } from "./schemas.js";

export const attentionRouter = t.router({
  listForOwner: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.attention.listForOwner()),

  dismiss: operateAgentsProcedure
    .use(requireWildcardBinding)
    .input(attentionDismissInputSchema)
    .mutation(({ ctx, input }) => ctx.attention.dismiss(input)),
});
