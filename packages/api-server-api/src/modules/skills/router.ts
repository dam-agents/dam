import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  localSkillSchema,
  skillCreateSourceInputSchema,
  skillDeleteSourceInputSchema,
  skillInstallInputSchema,
  skillListInputSchema,
  skillListLocalInputSchema,
  skillListSourcesInputSchema,
  skillPublishInputSchema,
  skillPublishResultSchema,
  skillRefSchema,
  skillRefreshSourceInputSchema,
  skillSchema,
  skillSourceSchema,
  skillStateInputSchema,
  skillStateOutputSchema,
  skillUninstallInputSchema,
} from "./schemas.js";

export const skillsRouter = t.router({
  sources: t.router({
    list: readAgentProcedure
      .input(skillListSourcesInputSchema)
      .output(z.array(skillSourceSchema))
      .query(({ ctx, input }) => {
        if (input?.agentId) checkAgentBinding(ctx, input.agentId);
        return ctx.skills.listSources(input?.agentId);
      }),

    create: manageAgentsProcedure
      .input(skillCreateSourceInputSchema)
      .output(skillSourceSchema)
      .mutation(({ ctx, input }) => ctx.skills.createSource(input)),

    delete: manageAgentsProcedure
      .input(skillDeleteSourceInputSchema)
      .mutation(({ ctx, input }) => ctx.skills.deleteSource(input.id)),

    refresh: manageAgentsProcedure
      .input(skillRefreshSourceInputSchema)
      .mutation(({ ctx, input }) => ctx.skills.refreshSource(input.id)),
  }),

  list: readAgentProcedure
    .input(skillListInputSchema)
    .output(z.array(skillSchema))
    .query(async ({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      const src = await ctx.skills.getSource(input.sourceId);
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.skills.list(input.sourceId, input.agentId);
    }),

  install: manageAgentsProcedure
    .input(skillInstallInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.install(input)),

  uninstall: manageAgentsProcedure
    .input(skillUninstallInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.uninstall(input)),

  listLocal: readAgentProcedure
    .input(skillListLocalInputSchema)
    .output(z.array(localSkillSchema))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.listLocal(input.agentId);
    }),

  state: readAgentProcedure
    .input(skillStateInputSchema)
    .output(skillStateOutputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.getState(input.agentId);
    }),

  publish: manageAgentsProcedure
    .input(skillPublishInputSchema)
    .output(skillPublishResultSchema)
    .mutation(({ ctx, input }) => ctx.skills.publish(input)),
});
