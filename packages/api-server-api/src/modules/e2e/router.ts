import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  e2eAgentIdInputSchema,
  e2eGetEnvInputSchema,
  e2ePerformFetchInputSchema,
  e2eSetScriptInputSchema,
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchResultSchema,
  resetResultSchema,
} from "./schemas.js";

function gate(ctx: { e2eEnabled: boolean }): void {
  if (!ctx.e2eEnabled) throw new TRPCError({ code: "NOT_FOUND" });
}

export const e2eRouter = t.router({
  setScript: t.procedure
    .input(e2eSetScriptInputSchema)
    .output(resetResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.setScript(input.agentId, input.script);
    }),

  getReceivedPrompts: t.procedure
    .input(e2eAgentIdInputSchema)
    .output(getReceivedPromptsResultSchema)
    .query(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.getReceivedPrompts(input.agentId);
    }),

  reset: t.procedure
    .input(e2eAgentIdInputSchema)
    .output(resetResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.reset(input.agentId);
    }),

  getEnv: t.procedure
    .input(e2eGetEnvInputSchema)
    .output(getEnvResultSchema)
    .query(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.getEnv(input.agentId, input.name);
    }),

  performFetch: t.procedure
    .input(e2ePerformFetchInputSchema)
    .output(performFetchResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.performFetch(input.agentId, {
        url: input.url,
        headers: input.headers,
      });
    }),
});
