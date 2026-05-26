import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/**
 * Connection-related react-query mutations (ADR-051). All connection
 * lifecycle flows through tRPC; legacy /api/oauth/apps and
 * /api/mcp/connections fetchers were retired with the K8sConnectionsPort.
 */

/**
 * Template-driven Connection create. The server validates `inputs`
 * against the template's Zod schema and writes credentials to SecretStore
 * + the Connection row atomically.
 */
export function useCreateConnection() {
  return useMutation({
    ...trpc.connections.create.mutationOptions(),
    meta: {
      invalidates: [trpc.connections.list.queryKey()],
      errorToast: "Couldn't create connection",
    },
  });
}

/** Delete a Connection. Sweeps grants + backing secret server-side. */
export function useDeleteConnection() {
  return useMutation({
    ...trpc.connections.delete.mutationOptions(),
    meta: {
      invalidates: [
        trpc.connections.list.queryKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
      errorToast: "Couldn't delete connection",
    },
  });
}

/**
 * Start the OAuth authorization-code flow for an existing Connection.
 * Returns { authUrl } — caller redirects.
 */
export function useStartOAuth() {
  return useMutation({
    ...trpc.connections.startOAuth.mutationOptions(),
    meta: { errorToast: "Couldn't start OAuth" },
  });
}

/**
 * Pre-create MCP discovery. Lets the Custom MCP modal pick which
 * template to submit against (oauth-DCR vs no-auth) based on what the
 * server publishes.
 */
export function useDiscoverMcp() {
  return useMutation({
    ...trpc.connections.discoverMcp.mutationOptions(),
    meta: { errorToast: "Couldn't reach MCP server" },
  });
}
