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
  connectionRequestSecretInputSchema,
  secretRequestIdInputSchema,
  secretRequestSubmitInputSchema,
} from "./schemas.js";

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

  requestSecret: manageCredentialsProcedure
    .input(connectionRequestSecretInputSchema)
    .mutation(({ ctx, input }) => ctx.secretRequests.request(input)),

  secretRequestStatus: manageCredentialsProcedure
    .input(secretRequestIdInputSchema)
    .query(({ ctx, input }) => ctx.secretRequests.status(input.requestId)),

  getSecretRequest: manageCredentialsProcedure
    .input(secretRequestIdInputSchema)
    .query(({ ctx, input }) => ctx.secretRequests.get(input.requestId)),

  submitSecretRequest: manageCredentialsProcedure
    .input(secretRequestSubmitInputSchema)
    .mutation(({ ctx, input }) => ctx.secretRequests.submit(input)),

  cancelSecretRequest: manageCredentialsProcedure
    .input(secretRequestIdInputSchema)
    .mutation(({ ctx, input }) => ctx.secretRequests.cancel(input.requestId)),

  getAgentConnections: readAgentProcedure
    .input(connectionGetAgentConnectionsInputSchema)
    .query(({ ctx, input }) => {
      checkAgentBinding(ctx, input.agentId);
      return ctx.connections.getAgentConnections(input.agentId);
    }),

  setAgentConnections: manageAgentsProcedure
    .input(connectionSetAgentConnectionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),

  updateAgentConnections: manageAgentsProcedure
    .input(connectionUpdateAgentConnectionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.updateAgentConnections(input.agentId, {
        grant: input.grant,
        revoke: input.revoke,
      }),
    ),

  setPreferredConnection: manageAgentsProcedure
    .input(connectionSetPreferredConnectionInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setPreferredConnection(input.agentId, input.connectionId),
    ),
});
