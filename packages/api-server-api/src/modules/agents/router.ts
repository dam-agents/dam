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
  };
}

const envVarSchema = z.object({
  name: z.string().min(1).max(255).regex(ENV_NAME_RE, "name must match [A-Z_][A-Z0-9_]*"),
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
    .input(z.object({
      name: z.string().min(1),
      templateId: z.string().optional(),
      image: z.string().optional(),
      description: z.string().optional(),
      env: z.array(envVarSchema).max(64).optional(),
      egressPreset: z.enum(["none", "trusted", "all"]).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!input.templateId && !input.image) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Either templateId or image is required" });
      }
      const agent = await ctx.agents.create(input);
      return toView(agent);
    }),

  update: t.procedure
    .input(z.object({
      id: z.string().min(1),
      name: z.string().min(1).max(255).optional(),
      description: z.string().optional(),
      env: z.array(envVarSchema).max(64).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const agent = await ctx.agents.update(input);
      if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
      return toView(agent);
    }),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.agents.delete(input.id)),
});
