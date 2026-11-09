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
      // UNIT_BOUNDARY_DESCRIPTION: switching the assistant on gives this person one here, since a flag change makes no new request context; switching it off deletes nothing and hides only the greeting and the experiment's own UI.
      if (input.enabled && input.feature === "dambledore")
        await ctx.provisionAssistant();
      return flags;
    }),
});
