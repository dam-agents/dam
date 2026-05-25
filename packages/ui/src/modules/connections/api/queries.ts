import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

/**
 * Connection-related react-query hooks (ADR-051). All connection
 * lifecycle is now tRPC-backed; legacy /api/oauth/apps and
 * /api/mcp/connections were retired with the K8sConnectionsPort.
 */

export function useAppConnections(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load connections" },
  });
}

/** Read-only catalog of code-declared Connection Templates. */
export function useConnectionTemplates(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.listTemplates.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load connection templates" },
  });
}
