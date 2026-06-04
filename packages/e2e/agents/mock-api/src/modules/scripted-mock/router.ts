import { t } from "../../trpc.js";
import {
  getEnvInputSchema,
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchInputSchema,
  performFetchResultSchema,
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

  getEnv: t.procedure
    .input(getEnvInputSchema)
    .output(getEnvResultSchema)
    .query(({ ctx, input }) => ctx.scriptedMock.getEnv(input)),

  performFetch: t.procedure
    .input(performFetchInputSchema)
    .output(performFetchResultSchema)
    .mutation(({ ctx, input }) => ctx.scriptedMock.performFetch(input)),
});
