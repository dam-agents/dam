import { TRPCError } from "@trpc/server";
import { protectedProcedure, t } from "../../trpc.js";
import {
  execKillInputSchema,
  execRunInputSchema,
  execStartInputSchema,
  execTailInputSchema,
} from "./schemas.js";

export const execRouter = t.router({
  run: protectedProcedure
    .input(execRunInputSchema)
    .mutation(async ({ ctx, input }) => ctx.exec.run(input)),

  start: protectedProcedure
    .input(execStartInputSchema)
    .mutation(async ({ ctx, input }) => ctx.exec.start(input)),

  tail: protectedProcedure
    .input(execTailInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await ctx.exec.tail(input.backgroundId, input.offset);
      if (!result) throw new TRPCError({ code: "NOT_FOUND" });
      return result;
    }),

  kill: protectedProcedure
    .input(execKillInputSchema)
    .mutation(async ({ ctx, input }) => ({
      killed: await ctx.exec.kill(input.backgroundId),
    })),
});
