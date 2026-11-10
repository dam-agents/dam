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
      // UNIT_BOUNDARY_DESCRIPTION: switching the assistant on gives this person Dambledore here if they have none under that name, since a flag change makes no new request context; switching it off removes nothing and hides only the greeting, the landing and the reset.
      if (input.enabled && input.feature === "dambledore")
        await ctx.optInAssistant();
      return flags;
    }),
});
