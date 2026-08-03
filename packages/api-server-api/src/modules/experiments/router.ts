import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { toAgentView } from "../agents/router.js";
import {
  experimentIdInputSchema,
  experimentSandboxCreateInputSchema,
} from "./schemas.js";

export const experimentsRouter = t.router({
  createSandbox: manageAgentsProcedure
    .input(experimentSandboxCreateInputSchema)
    .mutation(async ({ ctx, input }) =>
      toAgentView(await ctx.experiments.createSandbox(input)),
    ),

  list: readAgentProcedure.query(({ ctx }) => ctx.experiments.list()),

  driverSummaries: readAgentProcedure.query(({ ctx }) =>
    ctx.experiments.driverSummaries(),
  ),

  get: readAgentProcedure
    .input(experimentIdInputSchema)
    .query(async ({ ctx, input }) => {
      const experiment = await ctx.experiments.get(input.id);
      if (!experiment) throw new TRPCError({ code: "NOT_FOUND" });
      return experiment;
    }),

  feed: readAgentProcedure
    .input(experimentIdInputSchema)
    .query(async ({ ctx, input }) => {
      const feed = await ctx.experiments.feed(input.id);
      if (!feed) throw new TRPCError({ code: "NOT_FOUND" });
      return feed;
    }),

  startRun: manageAgentsProcedure
    .input(experimentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.startRun(input.id)),

  stop: manageAgentsProcedure
    .input(experimentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.stop(input.id)),

  delete: manageAgentsProcedure
    .input(experimentIdInputSchema)
    .mutation(({ ctx, input }) => ctx.experiments.delete(input.id)),
});
