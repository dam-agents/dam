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
      // UNIT_BOUNDARY_DESCRIPTION: what a switch makes or takes away for this person, since a flag change makes no new request context. Switching the assistant on gives them Dambledore if they have none under that name; switching it off removes nothing and hides only the greeting, the landing and the reset. Switching the security check on gives their assistant the weekly check, and switching it off takes that Schedule and its last report away. A step that failed puts the switch back, so the person is not shown a switch that promises what nothing made, and its error reaches them.
      const follow =
        input.feature === "dambledore"
          ? input.enabled
            ? () => ctx.optInAssistant()
            : undefined
          : input.feature === "security-check"
            ? input.enabled
              ? () => ctx.securityChecks.enable()
              : () => ctx.securityChecks.disable()
            : undefined;
      if (follow === undefined) return flags;
      try {
        await follow();
        return flags;
      } catch (err) {
        await ctx.features
          .setFlag(input.feature, !input.enabled)
          .catch(() => undefined);
        throw err;
      }
    }),
});
