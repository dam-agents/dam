import { t } from "../../trpc.js";
import {
  getReceivedPromptsResultSchema,
  resetResultSchema,
  setScriptInputSchema,
} from "./schemas.js";

export const scriptedMockRouter = t.router({
  setScript: t.procedure
    .input(setScriptInputSchema)
    .output(resetResultSchema)
    .mutation(({ ctx, input }) => ctx.scriptedMock.setScript(input)),

  getReceivedPrompts: t.procedure
    .output(getReceivedPromptsResultSchema)
    .query(({ ctx }) => ctx.scriptedMock.getReceivedPrompts()),

  reset: t.procedure
    .output(resetResultSchema)
    .mutation(({ ctx }) => ctx.scriptedMock.reset()),
});
