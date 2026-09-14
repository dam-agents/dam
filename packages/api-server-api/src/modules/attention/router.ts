import {
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import { t } from "../../trpc.js";

export const attentionRouter = t.router({
  listForOwner: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.attention.listForOwner()),
});
