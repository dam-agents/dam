import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { t } from "../../trpc.js";
import { ENV_NAME_RE } from "../secrets/types.js";
import type { Agent } from "./types.js";

function toView(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    templateId: agent.templateId ?? null,
    image: agent.spec.image,
    description: agent.spec.description,
    env: agent.spec.env,
    state: agent.state,
    error: agent.error,
    channels: agent.channels,
    allowedUserEmails: agent.allowedUserEmails,
  };
}

const envVarSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(ENV_NAME_RE, "name must match [A-Z_][A-Z0-9_]*"),
  value: z.string().max(10000),
});

export const agentsRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    const agents = await ctx.agents.list();
    return agents.map(toView);
  }),

  get: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const agent = await ctx.agents.get(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  create: t.procedure
    .input(
      z.object({
        name: z
          .string()
          .min(1)
          .refine((n) => !n.startsWith("agent-"), {
            message: "agent name cannot start with 'agent-' (reserved for IDs)",
          }),
        templateId: z.string().optional(),
        image: z.string().optional(),
        description: z.string().optional(),
        env: z.array(envVarSchema).max(64).optional(),
        secretRef: z.string().optional(),
        allowedUserEmails: z.array(z.email()).optional(),
        egressPreset: z.enum(["none", "trusted", "all"]).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.templateId && !input.image) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Either templateId or image is required",
        });
      }
      const agent = await ctx.agents.create(input);
      return toView(agent);
    }),

  update: t.procedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        env: z.array(envVarSchema).max(64).optional(),
        secretRef: z.string().optional(),
        allowedUserEmails: z.array(z.email()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),

  restart: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.agents.restart(input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  wake: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.wake(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectSlack: t.procedure
    .input(
      z.object({
        id: z.string().min(1),
        slackChannelId: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.slack)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Slack app token not configured",
        });
      const res = await ctx.agents.connectSlack(input.id, input.slackChannelId);
      if (res.ok) return toView(res.value);
      switch (res.error.type) {
        case "AgentNotFound":
          throw new TRPCError({ code: "NOT_FOUND" });
        case "ChannelAlreadyBound":
          throw new TRPCError({
            code: "CONFLICT",
            message: "Slack channel already bound",
          });
      }
    }),

  disconnectSlack: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectSlack(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  connectTelegram: t.procedure
    .input(
      z.object({
        id: z.string().min(1),
        botToken: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.channels.available.telegram)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Telegram channel not enabled",
        });
      const agent = await ctx.agents.connectTelegram(input.id, input.botToken);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  disconnectTelegram: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.disconnectTelegram(input.id);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),
});
