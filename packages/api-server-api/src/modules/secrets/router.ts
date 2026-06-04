import { t } from "../../trpc.js";
import {
  secretCreateGithubPatInputSchema,
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetAgentAccessInputSchema,
  secretSetAgentAccessInputSchema,
  secretTestAnthropicInputSchema,
  secretUpdateGithubPatInputSchema,
  secretUpdateInputSchema,
} from "./schemas.js";

function messageForStatus(status: number): string {
  if (status === 401) return "Invalid credential.";
  if (status === 403) return "Credential lacks required permissions.";
  if (status === 429) return "Rate limited by Anthropic.";
  if (status >= 500) return "Anthropic is unavailable right now.";
  return `Unexpected response (${status}).`;
}

export const secretsRouter = t.router({
  list: t.procedure.query(({ ctx }) => ctx.secrets.list()),

  create: t.procedure
    .input(secretCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.create(input)),

  createGithubPat: t.procedure
    .input(secretCreateGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.createGithubPat(input)),

  updateGithubPat: t.procedure
    .input(secretUpdateGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.updateGithubPat(input)),

  update: t.procedure
    .input(secretUpdateInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.update(input)),

  delete: t.procedure
    .input(secretDeleteInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.delete(input.id)),

  getAgentAccess: t.procedure
    .input(secretGetAgentAccessInputSchema)
    .query(({ ctx, input }) => ctx.secrets.getAgentAccess(input.agentId)),

  testAnthropic: t.procedure
    .input(secretTestAnthropicInputSchema)
    .mutation(async ({ input }) => {
      const headers: Record<string, string> = {
        "anthropic-version": "2023-06-01",
      };
      if (input.envName === "ANTHROPIC_API_KEY") {
        headers["x-api-key"] = input.value;
      } else {
        headers["Authorization"] = `Bearer ${input.value}`;
        headers["anthropic-beta"] = "oauth-2025-04-20";
      }
      try {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          method: "GET",
          headers,
        });
        if (res.ok) return { ok: true as const };
        return {
          ok: false as const,
          status: res.status,
          message: messageForStatus(res.status),
        };
      } catch {
        return { ok: false as const, message: "Could not reach Anthropic." };
      }
    }),

  setAgentAccess: t.procedure
    .input(secretSetAgentAccessInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.secrets.setAgentAccess(input.agentId, {
        secretIds: input.secretIds,
      }),
    ),
});
