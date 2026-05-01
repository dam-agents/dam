import { useQuery } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";
import {
  fetchMcpConnections,
  fetchOAuthAppConnections,
  fetchOAuthApps,
} from "./fetchers.js";

export const mcpConnectionKeys = {
  all: ["mcp-connections"] as const,
  list: () => [...mcpConnectionKeys.all, "list"] as const,
};

export const oauthAppKeys = {
  all: ["oauth-apps"] as const,
  available: () => [...oauthAppKeys.all, "available"] as const,
  connections: () => [...oauthAppKeys.all, "connections"] as const,
};

export function useAppConnections(options?: { enabled?: boolean }) {
  return useQuery({
    ...trpc.connections.list.queryOptions(),
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load app connections" },
  });
}

export function useMcpConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: mcpConnectionKeys.list(),
    queryFn: fetchMcpConnections,
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load MCP connections" },
  });
}

export function useOAuthApps(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: oauthAppKeys.available(),
    queryFn: fetchOAuthApps,
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load OAuth apps" },
  });
}

export function useOAuthAppConnections(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: oauthAppKeys.connections(),
    queryFn: fetchOAuthAppConnections,
    enabled: options?.enabled ?? true,
    meta: { errorToast: "Couldn't load app connections" },
  });
}
