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

export function useUpdateConnection() {
  return useMutation({
    ...trpc.connections.update.mutationOptions(),
    meta: {
      invalidates: [
        trpc.connections.list.queryKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
      errorToast: "Couldn't update connection",
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

// `silent` for background detection (the debounced URL probe), where a
// transient failure shouldn't pop a global toast.
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

/**
 * Verifies an Anthropic credential against Anthropic before save. Returns
 * `{ ok: true } | { ok: false; message }` rather than throwing — callers
 * render the result inline, so no errorToast / invalidation here.
 */
export function useTestAnthropic() {
  return useMutation({
    ...trpc.connections.testAnthropic.mutationOptions(),
  });
}
