import { t } from "../../trpc.js";
import { browserOnlyProcedure } from "../../auth-procedures.js";
import { apiKeyCreateInputSchema, apiKeyRevokeInputSchema } from "./schemas.js";

export const apiKeysRouter = t.router({
  list: browserOnlyProcedure.query(({ ctx }) => ctx.apiKeys.list()),

  create: browserOnlyProcedure
    .input(apiKeyCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.create(input)),

  revoke: browserOnlyProcedure
    .input(apiKeyRevokeInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.revoke(input.id)),
});
