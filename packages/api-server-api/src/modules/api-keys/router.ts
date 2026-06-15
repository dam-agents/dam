import { t } from "../../trpc.js";
import { browserOnlyProcedure } from "../../auth-procedures.js";
import { apiKeyCreateInputSchema, apiKeyRevokeInputSchema } from "./schemas.js";

// All three procedures gate at the router via `browserOnlyProcedure`, so the
// service layer never has to enforce "keys can't manage keys" — this is the
// single privilege-escalation barrier for the management surface.
export const apiKeysRouter = t.router({
  list: browserOnlyProcedure.query(({ ctx }) => ctx.apiKeys.list()),

  create: browserOnlyProcedure
    .input(apiKeyCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.create(input)),

  revoke: browserOnlyProcedure
    .input(apiKeyRevokeInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.revoke(input.id)),
});
