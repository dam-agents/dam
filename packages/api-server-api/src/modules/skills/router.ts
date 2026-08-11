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

/** The one read behind both list shapes below: same binding check, same source
 *  pre-resolve, same cached scan. */
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

  /** A source's skills as a bare array. This shape is published: `dam` CLIs
   *  are installed on users' own machines and outlive any one server, so an
   *  npm-released `dam skill catalog` would break if it grew an envelope.
   *  Callers that also want scan freshness use `listWithScan`. */
  list: readAgentProcedure
    .input(skillListInputSchema)
    .output(z.array(skillSchema))
    .query(async ({ ctx, input }) => (await listSkills(ctx, input)).skills),

  /** `list` plus when that list was read from upstream — the read behind the
   *  UI's "scanned X ago". */
  listWithScan: readAgentProcedure
    .input(skillListInputSchema)
    .output(skillListResultSchema)
    .query(({ ctx, input }) => listSkills(ctx, input)),

  getSkillContent: readAgentProcedure
    .input(skillGetContentInputSchema)
    .output(skillContentSchema)
    .query(async ({ ctx, input }) => {
      // Public content needs no pod; a private source's read is issued from
      // the pod, where the paired gateway injects the owner's token — so that
      // path needs the agentId, not just the auth check. The service resolves
      // the source and throws a descriptive NOT_FOUND, so no pre-resolve here.
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

  // Ownership enforced in the service, same as install/uninstall.
  applyBatch: manageAgentsProcedure
    .input(skillApplyBatchInputSchema)
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.applyBatch(input)),

  // A skill set belongs to the user, not to a sandbox, so list/create/delete
  // take no agentId and need no agent binding check. Only `apply` targets one.
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

    // Not `apply`: tRPC reserves it as a router key (Function.prototype.apply),
    // and the collision only surfaces when the router is constructed at boot —
    // tsc and the unit tests both pass.
    //
    // No `checkAgentBinding`: `manageAgentsProcedure` is wildcard-only, so the
    // check can never fire. Ownership is enforced in the service, same as
    // install/uninstall/applyBatch.
    applyToAgent: manageAgentsProcedure
      .input(skillSetApplyInputSchema)
      .output(skillSetApplyResultSchema)
      .mutation(({ ctx, input }) => ctx.skills.applySets(input)),
  }),

  // Ownership is enforced inside the service via ensureAgentReachable →
  // owner-scoped agentsRepo.get, same as install.
  createLocal: manageAgentsProcedure
    .input(skillCreateLocalInputSchema)
    .output(z.array(localSkillSchema))
    .mutation(({ ctx, input }) => ctx.skills.createLocal(input)),

  // Ownership is enforced inside the service via ensureAgentReachable →
  // owner-scoped agentsRepo.get, same as createLocal.
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

  // A read, so readAgentProcedure rather than manageAgentsProcedure.
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
