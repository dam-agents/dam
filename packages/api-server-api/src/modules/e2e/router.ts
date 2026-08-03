import { TRPCError } from "@trpc/server";
import { t } from "../../trpc.js";
import {
  e2eAgentIdInputSchema,
  e2eGetEnvInputSchema,
  e2ePerformFetchInputSchema,
  e2eSetScriptInputSchema,
  e2eSpawnInvocationInputSchema,
  spawnInvocationResultSchema,
  getEnvResultSchema,
  getReceivedPromptsResultSchema,
  performFetchResultSchema,
  resetResultSchema,
  slackFireCommandInputSchema,
  slackFireCommandResultSchema,
  slackFireMentionInputSchema,
  slackFireMessageInputSchema,
  slackReadOutboundResultSchema,
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

  spawnInvocation: t.procedure
    .input(e2eSpawnInvocationInputSchema)
    .output(spawnInvocationResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      const { agentId, ...rest } = input;
      return ctx.e2e.spawnInvocation(agentId, rest);
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

  slackFireMention: t.procedure
    .input(slackFireMentionInputSchema)
    .output(resetResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.slackFireMention(input);
    }),

  slackFireMessage: t.procedure
    .input(slackFireMessageInputSchema)
    .output(resetResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.slackFireMessage(input);
    }),

  slackFireCommand: t.procedure
    .input(slackFireCommandInputSchema)
    .output(slackFireCommandResultSchema)
    .mutation(({ ctx, input }) => {
      gate(ctx);
      return ctx.e2e.slackFireCommand(input);
    }),

  slackReadOutbound: t.procedure
    .output(slackReadOutboundResultSchema)
    .query(({ ctx }) => {
      gate(ctx);
      return ctx.e2e.slackReadOutbound();
    }),

  slackResetOutbound: t.procedure
    .output(resetResultSchema)
    .mutation(({ ctx }) => {
      gate(ctx);
      return ctx.e2e.slackResetOutbound();
    }),
});
