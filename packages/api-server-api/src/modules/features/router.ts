import { TRPCError } from "@trpc/server";
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
      // UNIT_BOUNDARY_DESCRIPTION: switching the assistant off deletes it and stores the switch in one owner-locked critical section, so a person can never be left opted out with an assistant they may neither use nor delete, and no request can provision a replacement in between. Switching it on is the other way round — the flag, then the create — because nothing is at risk there. Only this switch deletes anything; an install's mode changing never does.
      if (input.feature === "dambledore" && !input.enabled) {
        if (!(await ctx.turnOffAssistant()))
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message:
              "Your assistant could not be deleted, so the switch stays on. Try again.",
          });
        return ctx.features.flags();
      }
      const flags = await ctx.features.setFlag(input.feature, input.enabled);
      if (input.feature === "dambledore") await ctx.provisionAssistant();
      return flags;
    }),
});
