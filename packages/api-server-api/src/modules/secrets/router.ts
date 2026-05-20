import { z } from "zod";
import { t } from "../../trpc.js";
import {
  createGithubPatInputSchema,
  createSecretInputSchema,
  updateGithubPatInputSchema,
  updateSecretInputSchema,
} from "./schemas.js";

// Re-export so existing barrel consumers (`api-server-api`'s index.ts +
// the api-server's tests) keep working. UI code that imports
// `updateSecretInputSchema` should prefer the schemas.ts path so the
// UI bundle doesn't pull in @trpc/server through this file.
export { updateSecretInputSchema };

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
    .input(createSecretInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.create(input)),

  createGithubPat: t.procedure
    .input(createGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.createGithubPat(input)),

  updateGithubPat: t.procedure
    .input(updateGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.updateGithubPat(input)),

  update: t.procedure
    .input(updateSecretInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.update(input)),

  delete: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.secrets.delete(input.id)),

  getAgentAccess: t.procedure
    .input(z.object({ agentId: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.secrets.getAgentAccess(input.agentId)),

  testAnthropic: t.procedure
    .input(
      z.object({
        value: z.string().min(1),
        envName: z.enum(["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]),
      }),
    )
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
    .input(
      z.object({
        agentId: z.string().min(1),
        secretIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.secrets.setAgentAccess(input.agentId, {
        secretIds: input.secretIds,
      }),
    ),

  listGrantedAgents: t.procedure
    .input(z.object({ id: z.string().min(1) }))
    .query(({ ctx, input }) => ctx.secrets.listGrantedAgents(input.id)),
});
