import { t } from "../../trpc.js";
import {
  browserOnlyProcedure,
  readAgentProcedure,
} from "../../auth-procedures.js";
import {
  markAvatarPickedInputSchema,
  markUnlockSeenInputSchema,
  setChecklistDismissedInputSchema,
} from "./schemas.js";

export const gettingStartedRouter = t.router({
  progress: readAgentProcedure.query(({ ctx }) =>
    ctx.gettingStarted.progress(),
  ),

  markUnlockSeen: browserOnlyProcedure
    .input(markUnlockSeenInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.gettingStarted.markUnlockSeen(input.task),
    ),

  markAvatarPicked: browserOnlyProcedure
    .input(markAvatarPickedInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.gettingStarted.markAvatarPicked(input.character),
    ),

  setDismissed: browserOnlyProcedure
    .input(setChecklistDismissedInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.gettingStarted.setDismissed(input.dismissed),
    ),
});
