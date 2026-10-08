import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import { featureSetFlagInputSchema } from "./schemas.js";

export const featuresRouter = t.router({
  flags: readAgentProcedure.query(({ ctx }) => ctx.features.flags()),

  install: readAgentProcedure.query(({ ctx }) => ({
    virtualization: ctx.virtualizationEnabled,
    features: ctx.featureModes,
  })),

  setFlag: browserOnlyProcedure
    .input(featureSetFlagInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.features.setFlag(input.feature, input.enabled),
    ),
});
