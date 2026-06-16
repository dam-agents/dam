import { t } from "../../trpc.js";
import {
  agentSettingsGetInputSchema,
  agentSettingsSchema,
  agentSettingsSetInputSchema,
  agentSettingsViewSchema,
} from "./schemas.js";

export const agentSettingsRouter = t.router({
  get: t.procedure
    .input(agentSettingsGetInputSchema)
    .output(agentSettingsViewSchema)
    .query(({ ctx, input }) => ctx.agentSettings.get(input.agentId)),

  set: t.procedure
    .input(agentSettingsSetInputSchema)
    .output(agentSettingsSchema)
    .mutation(({ ctx, input }) =>
      ctx.agentSettings.set(input.agentId, {
        model: input.model,
        mode: input.mode,
        configOptions: input.configOptions,
      }),
    ),
});
