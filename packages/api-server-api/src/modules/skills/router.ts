import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";

const skillSourceViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  gitUrl: z.string(),
  system: z.boolean().optional(),
  fromTemplate: z
    .object({ templateId: z.string(), templateName: z.string() })
    .optional(),
  canPublish: z.boolean().optional(),
});

const publishResultSchema = z.object({
  prUrl: z.string().url(),
  branch: z.string(),
});

const skillViewSchema = z.object({
  source: z.string(),
  name: z.string(),
  description: z.string(),
  version: z.string(),
  contentHash: z.string(),
});

const skillRefSchema = z.object({
  source: z.string(),
  name: z.string(),
  version: z.string(),
  contentHash: z.string().optional(),
});

const localSkillSchema = z.object({
  name: z.string(),
  description: z.string(),
  skillPath: z.string(),
});

export const skillsRouter = t.router({
  sources: t.router({
    list: t.procedure
      .input(z.object({ instanceId: z.string().min(1).optional() }).optional())
      .output(z.array(skillSourceViewSchema))
      .query(({ ctx, input }) => ctx.skills.listSources(input?.instanceId)),

    create: t.procedure
      .input(z.object({
        name: z.string().min(1).max(128),
        gitUrl: z.string().url(),
      }))
      .output(skillSourceViewSchema)
      .mutation(({ ctx, input }) => ctx.skills.createSource(input)),

    delete: t.procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.skills.deleteSource(input.id)),

    /** Drop the scan cache for this source so the next listSkills re-queries
     *  upstream. Called after merging a PR, pushing out-of-band, etc. */
    refresh: t.procedure
      .input(z.object({ id: z.string().min(1) }))
      .mutation(({ ctx, input }) => ctx.skills.refreshSource(input.id)),
  }),

  /** `instanceId` is optional — public-archive scans don't need an instance.
   *  Private-source scans (that fall through to the authenticated
   *  agent-runtime path) will throw with a clear hint if it's missing. */
  listSkills: t.procedure
    .input(z.object({
      sourceId: z.string().min(1),
      instanceId: z.string().min(1).optional(),
    }))
    .output(z.array(skillViewSchema))
    .query(async ({ ctx, input }) => {
      const src = await ctx.skills.getSource(input.sourceId);
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });
      return ctx.skills.listSkills(input.sourceId, input.instanceId);
    }),

  install: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      source: z.string().url(),
      name: z.string().min(1),
      version: z.string().min(1),
      contentHash: z.string().optional(),
    }))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.installSkill(input)),

  uninstall: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      source: z.string().url(),
      name: z.string().min(1),
    }))
    .output(z.array(skillRefSchema))
    .mutation(({ ctx, input }) => ctx.skills.uninstallSkill(input)),

  listLocal: t.procedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .output(z.array(localSkillSchema))
    .query(({ ctx, input }) => ctx.skills.listLocal(input.instanceId)),

  /**
   * Reconciled skills view for an instance — drops ghost SkillRefs (entries
   * in spec.skills whose directories were removed out-of-band) before
   * returning. Persists the cleanup so subsequent reads see a consistent
   * declarative state. Use this from the UI in preference to
   * `instances.get().skills` + `skills.listLocal` — same two pieces of data,
   * one trip, self-healing.
   *
   * `instancePublishes` is the explicit log of successful publish events
   * used to drive the "Published" badge on standalone skills.
   */
  state: t.procedure
    .input(z.object({ instanceId: z.string().min(1) }))
    .output(
      z.object({
        installed: z.array(skillRefSchema),
        standalone: z.array(localSkillSchema),
        instancePublishes: z.array(
          z.object({
            skillName: z.string(),
            sourceId: z.string(),
            sourceName: z.string(),
            sourceGitUrl: z.string(),
            prUrl: z.string(),
            publishedAt: z.string(),
          }),
        ),
      }),
    )
    .query(({ ctx, input }) => ctx.skills.getState(input.instanceId)),

  publish: t.procedure
    .input(z.object({
      instanceId: z.string().min(1),
      sourceId: z.string().min(1),
      name: z.string().min(1),
      title: z.string().optional(),
      body: z.string().optional(),
    }))
    .output(publishResultSchema)
    .mutation(({ ctx, input }) => ctx.skills.publishSkill(input)),
});
