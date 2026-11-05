import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { featureSetFlagInputSchema } from "./schemas.js";

export const featuresRouter = t.router({
  flags: readAgentProcedure.query(({ ctx }) => ctx.features.flags()),

  install: readAgentProcedure.query(({ ctx }) => ({
    features: ctx.featureModes,
    telemetryBackend: ctx.telemetryBackend,
  })),

  setFlag: browserOnlyProcedure
    .input(featureSetFlagInputSchema)
    .mutation(async ({ ctx, input }) => {
      const flags = await ctx.features.setFlag(input.feature, input.enabled);
      if (input.feature === "dambledore") {
        // UNIT_BOUNDARY_DESCRIPTION: switching the assistant on provisions it now, and switching it off deletes it and its data; the caller's context is not made again, so nothing else would. Only this switch deletes anything — an install's mode changing never does.
        if (input.enabled) await ctx.provisionAssistant();
        else await ctx.removeAssistant();
      }
      return flags;
    }),
});
