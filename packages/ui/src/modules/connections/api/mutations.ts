import { useMutation } from "@tanstack/react-query";
import type { AgentConnections, ConnectionView } from "api-server-api";
import { preferenceGroupOf } from "api-server-api";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";

function samePreferenceGroup(connectionId: string): Set<string> {
  const connections =
    queryClient.getQueryData<ConnectionView[]>(
      trpc.connections.list.queryKey(),
    ) ?? [];
  const target = connections.find((c) => c.id === connectionId);
  const group = target ? preferenceGroupOf(target.contributions) : undefined;
  if (group === undefined) return new Set();
  return new Set(
    connections
      .filter((c) => c.id !== connectionId)
      .filter((c) => preferenceGroupOf(c.contributions) === group)
      .map((c) => c.id),
  );
}

export function useSetPreferredConnection() {
  return useMutation({
    mutationFn: (vars: { agentId: string; connectionId: string }) =>
      api.connections.setPreferredConnection.mutate(vars),
    onMutate: async (vars) => {
      const key = trpc.connections.getAgentConnections.queryKey({
        agentId: vars.agentId,
      });
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AgentConnections>(key);
      if (previous) {
        const siblings = samePreferenceGroup(vars.connectionId);
        queryClient.setQueryData<AgentConnections>(key, {
          ...previous,
          connections: previous.connections.map((c) => ({
            ...c,
            preferred:
              c.connectionId === vars.connectionId
                ? true
                : siblings.has(c.connectionId)
                  ? false
                  : c.preferred,
          })),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(context.key, context.previous);
    },
    meta: {
      invalidates: [trpc.connections.getAgentConnections.queryKey()],
      errorToast: "Couldn't change the default account",
    },
  });
}

export function useCreateConnection() {
  return useMutation({
    ...trpc.connections.create.mutationOptions(),
    meta: {
      invalidates: [trpc.connections.list.queryKey()],
      errorToast: "Couldn't create connection",
    },
  });
}

export function useUpdateConnection(opts?: { silent?: boolean }) {
  return useMutation({
    ...trpc.connections.update.mutationOptions(),
    meta: {
      invalidates: [
        trpc.connections.list.queryKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
      ...(opts?.silent
        ? { suppressErrorToast: true }
        : { errorToast: "Couldn't update connection" }),
    },
  });
}

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

export function useDiscoverMcp(opts?: { silent?: boolean }) {
  return useMutation({
    ...trpc.connections.discoverMcp.mutationOptions(),
    meta: opts?.silent
      ? { suppressErrorToast: true }
      : { errorToast: "Couldn't reach MCP server" },
  });
}

export function useProbeClusterCa() {
  return useMutation({
    ...trpc.connections.probeClusterCa.mutationOptions(),
    meta: { errorToast: "Couldn't reach the cluster API" },
  });
}

export function useProbeGitHubAppInstallation() {
  return useMutation({
    ...trpc.connections.probeGitHubAppInstallation.mutationOptions(),
    meta: { suppressErrorToast: true },
  });
}

export function useProbeGitHubAppInstallationForConnection() {
  return useMutation({
    ...trpc.connections.probeGitHubAppInstallationForConnection.mutationOptions(),
    meta: { suppressErrorToast: true },
  });
}

export function useUpdateGitHubAppScope() {
  return useMutation({
    ...trpc.connections.updateGitHubAppScope.mutationOptions(),
    meta: {
      invalidates: [
        trpc.connections.list.queryKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
      suppressErrorToast: true,
    },
  });
}

export function useProbeGitHubUserToken() {
  return useMutation({
    ...trpc.connections.probeGitHubUserTokenForConnection.mutationOptions(),
    meta: { suppressErrorToast: true },
  });
}

export function useUpdateGitHubUserTokenScope() {
  return useMutation({
    ...trpc.connections.updateGitHubUserTokenScope.mutationOptions(),
    meta: {
      invalidates: [
        trpc.connections.list.queryKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
      suppressErrorToast: true,
    },
  });
}

export function useTestAnthropic() {
  return useMutation({
    ...trpc.connections.testAnthropic.mutationOptions(),
  });
}
