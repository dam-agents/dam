import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { ApiContext } from "../../context.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  localSkillSchema,
  skillApplyBatchInputSchema,
  skillContentSchema,
  skillCreateLocalInputSchema,
  skillCreateSourceInputSchema,
  skillDeleteLocalInputSchema,
  skillDeleteSourceInputSchema,
  skillGetContentInputSchema,
  skillInstallInputSchema,
  skillListInputSchema,
  skillListLocalInputSchema,
  skillListResultSchema,
  skillListSourcesInputSchema,
  skillLocalFilesSchema,
  skillPublishInputSchema,
  skillPublishResultSchema,
  skillReadLocalInputSchema,
  skillRefSchema,
  skillRefreshSourceInputSchema,
  skillSchema,
  skillSetApplyInputSchema,
  skillSetApplyResultSchema,
  skillSetCreateInputSchema,
  skillSetDeleteInputSchema,
  skillSetSchema,
  skillSourceSchema,
  skillStateInputSchema,
  skillStateOutputSchema,
  skillUninstallInputSchema,
} from "./schemas.js";
import type { SkillListResult } from "./types.js";

async function listSkills(
  ctx: ApiContext,
  input: { sourceId: string; agentId?: string },
): Promise<SkillListResult> {
  if (input.agentId) checkAgentBinding(ctx, input.agentId);
  const src = await ctx.skills.getSource(input.sourceId);
  if (!src) throw new TRPCError({ code: "NOT_FOUND" });
  return ctx.skills.list(input.sourceId, input.agentId);
}

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
    .query(async ({ ctx, input }) => (await listSkills(ctx, input)).skills),

  listWithScan: readAgentProcedure
    .input(skillListInputSchema)
    .output(skillListResultSchema)
    .query(({ ctx, input }) => listSkills(ctx, input)),

  getSkillContent: readAgentProcedure
    .input(skillGetContentInputSchema)
    .output(skillContentSchema)
    .query(async ({ ctx, input }) => {
      if (input.agentId) checkAgentBinding(ctx, input.agentId);
      return ctx.skills.getSkillContent(
        input.sourceId,
        input.name,
        input.agentId,
      );
    }),

  install: manageAgentsProcedure
    .input(skillInstallInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.install(input)),

  uninstall: manageAgentsProcedure
    .input(skillUninstallInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.uninstall(input)),

  applyBatch: manageAgentsProcedure
    .input(skillApplyBatchInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.applyBatch(input)),

  sets: t.router({
    list: readAgentProcedure
      .output(z.array(skillSetSchema))
      .query(({ ctx }) => ctx.skills.listSets()),

    create: manageAgentsProcedure
      .input(skillSetCreateInputSchema)
      .output(skillSetSchema)
      .mutation(({ ctx, input }) => ctx.skills.createSet(input)),

    delete: manageAgentsProcedure
      .input(skillSetDeleteInputSchema)
      .mutation(({ ctx, input }) => ctx.skills.deleteSet(input)),

    applyToAgent: manageAgentsProcedure
      .input(skillSetApplyInputSchema)
      .output(skillSetApplyResultSchema)
      .mutation(({ ctx, input }) => ctx.skills.applySets(input)),
  }),

  createLocal: manageAgentsProcedure
    .input(skillCreateLocalInputSchema)
    .output(z.array(localSkillSchema))
    .mutation(({ ctx, input }) => ctx.skills.createLocal(input)),

  deleteLocal: manageAgentsProcedure
    .input(skillDeleteLocalInputSchema)
    .output(z.array(localSkillSchema))
    .mutation(({ ctx, input }) => ctx.skills.deleteLocal(input)),

  listLocal: readAgentProcedure
    .input(skillListLocalInputSchema)
    .output(z.array(localSkillSchema))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.listLocal(input.agentId);
    }),

  readLocal: readAgentProcedure
    .input(skillReadLocalInputSchema)
    .output(skillLocalFilesSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.readLocal(input);
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
