import { t } from "../../trpc.js";
import { manageAgentsProcedure } from "../../auth-procedures.js";
import { toAgentView } from "../agents/router.js";
import { knowledgeBaseCreateInputSchema } from "./schemas.js";

export const knowledgeBasesRouter = t.router({
  create: manageAgentsProcedure
    .input(knowledgeBaseCreateInputSchema)
    .mutation(async ({ ctx, input }) =>
      toAgentView(await ctx.knowledgeBases.create(input)),
    ),
});
