import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import type { ApiContext } from "../../context.js";
import {
  agentPermission,
  agentTarget,
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
  skillSetListInputSchema,
  skillSetSchema,
  skillSetSourceHiddenInputSchema,
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
      .use(agentPermission("view", (input) => agentTarget(input?.agentId)))
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

    setHidden: manageAgentsProcedure
      .input(skillSetSourceHiddenInputSchema)
      .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
      .mutation(({ ctx, input }) => {
        checkAgentBinding(ctx, input.agentId);
        return ctx.skills.setSourceHidden(input);
      }),
  }),

  list: readAgentProcedure
    .input(skillListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(z.array(skillSchema))
    .query(async ({ ctx, input }) => (await listSkills(ctx, input)).skills),

  listWithScan: readAgentProcedure
    .input(skillListInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(skillListResultSchema)
    .query(({ ctx, input }) => listSkills(ctx, input)),

  getSkillContent: readAgentProcedure
    .input(skillGetContentInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
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
    .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.install(input)),

  uninstall: manageAgentsProcedure
    .input(skillUninstallInputSchema)
    .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.uninstall(input)),

  applyBatch: manageAgentsProcedure
    .input(skillApplyBatchInputSchema)
    .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.applyBatch(input)),

  sets: t.router({
    list: readAgentProcedure
      .input(skillSetListInputSchema)
      .use(agentPermission("view", (input) => agentTarget(input?.agentId)))
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
      .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
      .output(skillSetApplyResultSchema)
      .mutation(({ ctx, input }) => ctx.skills.applySets(input)),
  }),

  createLocal: manageAgentsProcedure
    .input(skillCreateLocalInputSchema)
    .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
    .output(z.array(localSkillSchema))
    .mutation(({ ctx, input }) => ctx.skills.createLocal(input)),

  deleteLocal: manageAgentsProcedure
    .input(skillDeleteLocalInputSchema)
    .use(agentPermission("skills", (input) => agentTarget(input.agentId)))
    .output(z.array(localSkillSchema))
    .mutation(({ ctx, input }) => ctx.skills.deleteLocal(input)),

  listLocal: readAgentProcedure
    .input(skillListLocalInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(z.array(localSkillSchema))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.listLocal(input.agentId);
    }),

  readLocal: readAgentProcedure
    .input(skillReadLocalInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(skillLocalFilesSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.readLocal(input);
    }),

  state: readAgentProcedure
    .input(skillStateInputSchema)
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .output(skillStateOutputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.skills.getState(input.agentId);
    }),

  publish: manageAgentsProcedure
    .input(skillPublishInputSchema)
    .use(agentPermission("skillPublish", (input) => agentTarget(input.agentId)))
    .output(skillPublishResultSchema)
    .mutation(({ ctx, input }) => ctx.skills.publish(input)),
});
