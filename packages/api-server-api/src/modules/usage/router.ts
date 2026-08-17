import { t } from "../../trpc.js";
import { entryPointChosenInputSchema } from "./schemas.js";

export const usageRouter = t.router({
  entryPointChosen: t.procedure
    .input(entryPointChosenInputSchema)
    .mutation(({ ctx, input }) => {
      ctx.usage.entryPointChosen(input.choice);
    }),
});
