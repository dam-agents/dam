import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  checkAgentBinding,
  readAgentProcedure,
  requireWildcardBinding,
} from "../../auth-procedures.js";
import {
  kbShareAgentInputSchema,
  kbShareCreateInputSchema,
  kbShareRefreshInputSchema,
  kbShareResolveInputSchema,
  kbShareSetNameInputSchema,
} from "./schemas.js";

export const kbSharesRouter = t.router({
  status: readAgentProcedure
    .input(kbShareAgentInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.kbShares.status(input.agentId);
    }),

  list: readAgentProcedure
    .use(requireWildcardBinding)
    .query(({ ctx }) => ctx.kbShares.list()),

  defaults: readAgentProcedure
    .input(kbShareAgentInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.kbShares.defaults(input.agentId);
    }),

  create: browserOnlyProcedure
    .input(kbShareCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.create(input)),

  reveal: browserOnlyProcedure
    .input(kbShareAgentInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.reveal(input.agentId)),

  rotate: browserOnlyProcedure
    .input(kbShareAgentInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.rotate(input.agentId)),

  revoke: browserOnlyProcedure
    .input(kbShareAgentInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.revoke(input.agentId)),

  refresh: browserOnlyProcedure
    .input(kbShareRefreshInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.refresh(input)),

  setName: browserOnlyProcedure
    .input(kbShareSetNameInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.setName(input)),

  resolveLink: browserOnlyProcedure
    .input(kbShareResolveInputSchema)
    .mutation(({ ctx, input }) => ctx.kbShares.resolveLink(input)),
});
