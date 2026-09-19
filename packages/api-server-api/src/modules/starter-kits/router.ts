import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { toAgentView } from "../agents/view.js";
import {
  starterKitApplyInputSchema,
  starterKitGetInputSchema,
} from "./schemas.js";

export const starterKitsRouter = t.router({
  list: readAgentProcedure.query(({ ctx }) => ctx.starterKits.list()),

  get: readAgentProcedure
    .input(starterKitGetInputSchema)
    .query(async ({ ctx, input }) => {
      const kit = await ctx.starterKits.get(input.catalog, input.id);
      if (!kit) throw new TRPCError({ code: "NOT_FOUND" });
      return kit;
    }),

  create: manageAgentsProcedure
    .input(starterKitApplyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.starterKits.apply(input);
      return { ...result, agent: toAgentView(result.agent) };
    }),
});
