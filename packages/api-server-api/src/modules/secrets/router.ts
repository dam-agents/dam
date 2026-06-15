import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  manageCredentialsProcedure,
  readAgentProcedure,
  readCredentialsProcedure,
} from "../../auth-procedures.js";
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
  // Credential lifecycle (CRUD on the credential itself) — credentials:* scopes.
  list: readCredentialsProcedure.query(({ ctx }) => ctx.secrets.list()),

  create: manageCredentialsProcedure
    .input(secretCreateInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.create(input)),

  createGithubPat: manageCredentialsProcedure
    .input(secretCreateGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.createGithubPat(input)),

  updateGithubPat: manageCredentialsProcedure
    .input(secretUpdateGithubPatInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.updateGithubPat(input)),

  update: manageCredentialsProcedure
    .input(secretUpdateInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.update(input)),

  delete: manageCredentialsProcedure
    .input(secretDeleteInputSchema)
    .mutation(({ ctx, input }) => ctx.secrets.delete(input.id)),

  // Validates a caller-supplied key value against Anthropic; reads no stored
  // state.
  testAnthropic: readCredentialsProcedure
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

  // Per-agent grant linkage is agent configuration: reading it needs an agent
  // scope; assigning is agents:manage.
  getAgentAccess: readAgentProcedure
    .input(secretGetAgentAccessInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.secrets.getAgentAccess(input.agentId);
    }),

  setAgentAccess: manageAgentsProcedure
    .input(secretSetAgentAccessInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.secrets.setAgentAccess(input.agentId, {
        secretIds: input.secretIds,
      }),
    ),
});
