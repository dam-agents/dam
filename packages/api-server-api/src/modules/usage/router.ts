import { signedInProcedure } from "../../auth-procedures.js";
import { t } from "../../trpc.js";
import { entryPointChosenInputSchema, uiEventsInputSchema } from "./schemas.js";

export const usageRouter = t.router({
  entryPointChosen: t.procedure
    .input(entryPointChosenInputSchema)
    .mutation(({ ctx, input }) => {
      ctx.usage.entryPointChosen(input.choice);
    }),
  uiTelemetry: signedInProcedure.query(({ ctx }) => ctx.usage.uiTelemetry()),
  uiEvents: signedInProcedure
    .input(uiEventsInputSchema)
    .mutation(({ ctx, input }) => ctx.usage.uiEvents(input)),
});
