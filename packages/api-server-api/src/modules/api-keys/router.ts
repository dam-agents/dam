import { t } from "../../trpc.js";
import { apiKeyCreateInputSchema, apiKeyRevokeInputSchema } from "./schemas.js";

export const apiKeysRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.apiKeys.list()),

  create: t.procedure
    .input(apiKeyCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.create(input)),

  revoke: t.procedure
    .input(apiKeyRevokeInputSchema)
    .mutation(({ ctx, input }) => ctx.apiKeys.revoke(input.id)),
});
