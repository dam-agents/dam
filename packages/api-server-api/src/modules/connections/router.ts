import { t } from "../../trpc.js";
import {
  connectionCreateInputSchema,
  connectionDiscoverMcpInputSchema,
  connectionGetAgentConnectionsInputSchema,
  connectionIdInputSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionStartOAuthInputSchema,
} from "./schemas.js";

export const connectionsRouter = t.router({
  listTemplates: t.procedure.query(({ ctx }) =>
    ctx.connections.listTemplates(),
  ),

  list: t.procedure.query(({ ctx }) => ctx.connections.listConnections()),

  get: t.procedure
    .input(connectionIdInputSchema)
    .query(({ ctx, input }) => ctx.connections.getConnection(input.id)),

  /**
   * Create a Connection (ADR-051). Input is auth-kind-discriminated and
   * fully typed; the server projects it through the named template's
   * defaults + contribution set. The UI never assembles `auth` or
   * `contributions` itself — those are template-derived.
   */
  create: t.procedure
    .input(connectionCreateInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.createFromTemplate(input).then((id) => ({ id })),
    ),

  /**
   * Start the OAuth authorization-code flow for an existing Connection.
   * Returns the provider's authorize URL; the UI redirects the user and
   * the provider eventually lands back at `/api/oauth/callback`.
   */
  startOAuth: t.procedure
    .input(connectionStartOAuthInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.startOAuth(input.connectionId),
    ),

  /**
   * Discover whether an MCP server publishes OAuth metadata + a DCR
   * endpoint. UI uses this on the "Custom MCP server" form's URL mode
   * to pick which template to submit against.
   */
  discoverMcp: t.procedure
    .input(connectionDiscoverMcpInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.discoverMcp(input)),

  delete: t.procedure
    .input(connectionIdInputSchema)
    .mutation(({ ctx, input }) => ctx.connections.deleteConnection(input.id)),

  getAgentConnections: t.procedure
    .input(connectionGetAgentConnectionsInputSchema)
    .query(({ ctx, input }) =>
      ctx.connections.getAgentConnections(input.agentId),
    ),

  setAgentConnections: t.procedure
    .input(connectionSetAgentConnectionsInputSchema)
    .mutation(({ ctx, input }) =>
      ctx.connections.setAgentConnections(input.agentId, input.connectionIds),
    ),
});
