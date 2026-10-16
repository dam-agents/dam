import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  chatFormPreferencesGetInputSchema,
  chatFormPreferencesSetInputSchema,
} from "./preferences.js";

export const chatFormsRouter = t.router({
  preferences: readAgentProcedure
    .input(chatFormPreferencesGetInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.chatFormPreferences.get(input.agentId);
    }),

  setPreferences: manageAgentsProcedure
    .input(chatFormPreferencesSetInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.chatFormPreferences.set(input.agentId, input.preferences),
    ),
});
