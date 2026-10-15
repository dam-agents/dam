import { z } from "zod";
import { t } from "../../trpc.js";

export const harnessConfigRouter = t.router({
  current: t.procedure
    .input(z.object({ harness: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) => ctx.harnessConfig.readCurrent(input)),
  /** UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod. The catalog procedure replaces it. */
  models: t.procedure
    .input(
      z.object({
        harness: z.string().min(1),
        provider: z.string().min(1).nullable(),
      }),
    )
    .query(async ({ ctx, input }) => ({
      availableModels: await ctx.harnessConfig.models(input),
    })),
  watch: t.procedure.subscription(async function* ({ ctx, signal }) {
    for await (const notice of ctx.harnessConfig.watch(signal)) yield notice;
  }),
  catalog: t.procedure
    .input(z.object({ harness: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.harnessConfig.catalog(input)),
});
