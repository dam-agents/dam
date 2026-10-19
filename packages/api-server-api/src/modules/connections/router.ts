import { TRPCError } from "@trpc/server";
import type { ApiContext } from "../../context.js";
import { t } from "../../trpc.js";
import {
  checkAgentBinding,
  manageAgentsProcedure,
  manageCredentialsProcedure,
  readAgentProcedure,
  readCredentialsProcedure,
} from "../../auth-procedures.js";
import {
  connectionCreateInputSchema,
  connectionDiscoverMcpInputSchema,
  connectionProbeClusterCaInputSchema,
  connectionProbeGitHubAppInputSchema,
  connectionProbeGitHubAppForConnectionInputSchema,
  connectionUpdateGitHubAppScopeInputSchema,
  connectionProbeGitHubUserTokenInputSchema,
  connectionUpdateGitHubUserTokenScopeInputSchema,
  connectionGetAgentConnectionsInputSchema,
  connectionIdInputSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionUpdateAgentConnectionsInputSchema,
  connectionSetPreferredConnectionInputSchema,
  connectionStartOAuthInputSchema,
  connectionUpdateInputSchema,
} from "./schemas.js";

// UNIT_BOUNDARY_DESCRIPTION: only the owner, signed in to the app, grants or removes a connection on an Environment: never an API key, which an agent or a script may hold, so the Owning Agent cannot pass its own connections to the software it runs.
async function ownerInAppForEnvironment(
  ctx: { user: { keyId?: string }; agents: ApiContext["agents"] },
  agentId: string,
): Promise<void> {
  if (ctx.user.keyId === undefined) return;
  const agent = await ctx.agents.get(agentId);
  if (agent?.spec.environmentOf)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Connections on an Environment are granted by its owner in the app, not with an API key",
    });
}

export const connectionsRouter = t.router({
  listTemplates: readCredentialsProcedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: readCredentialsProcedure.query(({ ctx }) =>
    ctx.connections.listAndReconcileConnections(),
  ),

  get: readCredentialsProcedure
    .input(connectionIdInputSchema)
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  getProviderBalance: readCredentialsProcedure
    .input(connectionIdInputSchema)
    .query(({ ctx, input }) => ctx.connections.getProviderBalance(input.id)),

  recheckProviderKeys: manageCredentialsProcedure.mutation(({ ctx }) =>
    ctx.connections.recheckProviderKeys(),
  ),

  create: manageCredentialsProcedure
    .input(connectionCreateInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.createFromTemplate(input).then((id) => ({ id })),
    ),

  startOAuth: manageCredentialsProcedure
    .input(connectionStartOAuthInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.startOAuth(input.connectionId, {
        returnTo: input.returnTo,
        popup: input.popup,
      }),
    ),

  discoverMcp: manageCredentialsProcedure
    .input(connectionDiscoverMcpInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.discoverMcp(input)),

  probeClusterCa: manageCredentialsProcedure
    .input(connectionProbeClusterCaInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.probeClusterCa(input)),

  probeGitHubAppInstallation: manageCredentialsProcedure
    .input(connectionProbeGitHubAppInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.probeGitHubAppInstallation(input),
    ),

  probeGitHubAppInstallationForConnection: manageCredentialsProcedure
    .input(connectionProbeGitHubAppForConnectionInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.probeGitHubAppInstallationForConnection(input),
    ),

  updateGitHubAppScope: manageCredentialsProcedure
    .input(connectionUpdateGitHubAppScopeInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.updateGitHubAppScope(input)),

  probeGitHubUserTokenForConnection: manageCredentialsProcedure
    .input(connectionProbeGitHubUserTokenInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.probeGitHubUserTokenForConnection(input),
    ),

  updateGitHubUserTokenScope: manageCredentialsProcedure
    .input(connectionUpdateGitHubUserTokenScopeInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.updateGitHubUserTokenScope(input),
    ),

  update: manageCredentialsProcedure
    .input(connectionUpdateInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.update(input.id, input)),

  delete: manageCredentialsProcedure
    .input(connectionIdInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  getAgentConnections: readAgentProcedure
    .input(connectionGetAgentConnectionsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.connections.getAgentConnections(input.agentId);
    }),

  setAgentConnections: manageAgentsProcedure
    .input(connectionSetAgentConnectionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ownerInAppForEnvironment(ctx, input.agentId);
      return ctx.connections.setAgentConnections(
        input.agentId,
        input.connectionIds,
      );
    }),

  updateAgentConnections: manageAgentsProcedure
    .input(connectionUpdateAgentConnectionsInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ownerInAppForEnvironment(ctx, input.agentId);
      return ctx.connections.updateAgentConnections(input.agentId, {
        grant: input.grant,
        revoke: input.revoke,
      });
    }),

  setPreferredConnection: manageAgentsProcedure
    .input(connectionSetPreferredConnectionInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setPreferredConnection(input.agentId, input.connectionId),
    ),
});
