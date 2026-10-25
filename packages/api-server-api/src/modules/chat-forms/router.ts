import { t } from "../../trpc.js";
import {
  agentPermission,
  agentTarget,
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
    .use(agentPermission("view", (input) => agentTarget(input.agentId)))
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.chatFormPreferences.get(input.agentId);
    }),

  setPreferences: manageAgentsProcedure
    .input(chatFormPreferencesSetInputSchema)
    .use(agentPermission("chatForms", (input) => agentTarget(input.agentId)))
    .mutation(({ ctx, input }) =>
      ctx.chatFormPreferences.set(input.agentId, input.preferences),
    ),
});
