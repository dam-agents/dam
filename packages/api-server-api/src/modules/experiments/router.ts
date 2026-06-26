import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  experimentAddArmInputSchema,
  experimentCreateInputSchema,
  experimentIdInputSchema,
} from "./schemas.js";

export const experimentsRouter = t.router({
  list: readAgentProcedure.query(({ ctx }) => ctx.experiments.list()),

  get: readAgentProcedure
    .input(experimentIdInputSchema)
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.experiments.getWithRuns(input.id);
      if (!experiment) throw new TRPCError({ code: "NOT_FOUND" });
      return experiment;
    }),

  create: manageAgentsProcedure
    .input(experimentCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.create(input)),

  addArm: manageAgentsProcedure
    .input(experimentAddArmInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.addArm(input)),

  start: manageAgentsProcedure
    .input(experimentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.start(input.id)),

  stop: manageAgentsProcedure
    .input(experimentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.stop(input.id)),
});
