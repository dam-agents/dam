import { z } from "zod";
import { t } from "../../trpc.js";

export const harnessConfigRouter = t.router({
  current: t.procedure
    .input(z.object({ harness: z.string().min(1).optional() }).optional())
    .query(({ ctx, input }) => ctx.harnessConfig.readCurrent(input)),
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
});
