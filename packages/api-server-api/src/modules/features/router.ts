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
      if (!input.enabled || input.feature !== "dambledore") return flags;
      // UNIT_BOUNDARY_DESCRIPTION: switching the assistant on gives this person Dambledore here if they have none under that name, since a flag change makes no new request context; switching it off removes nothing and hides only the greeting, the landing and the reset. A create that failed leaves the switch off, so the person is not shown a switch that promises an assistant nothing made, and its error reaches them.
      try {
        await ctx.optInAssistant();
        return flags;
      } catch (err) {
        await ctx.features.setFlag(input.feature, false).catch(() => undefined);
        throw err;
      }
    }),
});
