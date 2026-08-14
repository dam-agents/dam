import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

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

export function useTestAnthropic() {
  return useMutation({
    ...trpc.connections.testAnthropic.mutationOptions(),
  });
}
