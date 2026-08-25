import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { HarnessConfigCurrent } from "agent-runtime-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { unavailableModel } from "../../sessions/components/model-settings-snapshot.js";
import { agentTrpc } from "../agent-trpc.js";
import { useIsAgentOperable } from "./queries.js";

export function useHarnessConfigStatus(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.status.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

export const harnessConfigCurrentKey = (agentId: string) =>
  ["harness-config-current", agentId] as const;

export function useHarnessConfigCurrent(agentId: string | null) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: agentId ? harnessConfigCurrentKey(agentId) : ["hcc-disabled"],
    queryFn:
      agentId && operable
        ? () => agentTrpc(agentId).harnessConfig.current.query()
        : skipToken,
    retry: false,
  });
}

export function useHarnessConfigSnapshot(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.snapshot.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

export type HarnessConfigOrigin = "live" | "snapshot" | "none";

export interface ResolvedHarnessConfig {
  values: HarnessConfigCurrent | null;
  origin: HarnessConfigOrigin;
  capturedAt: string | null;
  hasRun: boolean;
  modelsPaired: boolean;
  pending: boolean;
}

export function useResolvedHarnessConfig(
  agentId: string | null,
): ResolvedHarnessConfig {
  const operable = useIsAgentOperable(agentId);
  const { data: live } = useHarnessConfigCurrent(agentId);
  const { data: recorded, isPending: snapshotPending } =
    useHarnessConfigSnapshot(agentId);
  const hasRun = recorded?.hasRun ?? false;
  const pending = snapshotPending;

  if (operable) {
    const values = live ?? recorded?.snapshot ?? null;
    return {
      values,
      origin: values ? "live" : "none",
      capturedAt: null,
      hasRun,
      modelsPaired: true,
      pending,
    };
  }
  const snapshot = recorded?.snapshot;
  if (snapshot) {
    return {
      values: snapshot,
      origin: "snapshot",
      capturedAt: snapshot.capturedAt,
      hasRun,
      modelsPaired: snapshot.modelAtDiscovery === snapshot.model,
      pending,
    };
  }
  return {
    values: null,
    origin: "none",
    capturedAt: null,
    hasRun,
    modelsPaired: false,
    pending,
  };
}

export function useStaleModel(agentId: string | null): {
  stale: boolean;
  model: string | null;
} {
  const operable = useIsAgentOperable(agentId);
  const { data } = useHarnessConfigSnapshot(agentId);
  const snapshot = data?.snapshot;
  const model = snapshot?.model ?? null;
  if (operable || !snapshot || snapshot.modelAtDiscovery !== model) {
    return { stale: false, model };
  }
  return { stale: unavailableModel(snapshot) !== null, model };
}

export function useApplyHarnessConfig() {
  return useMutation({
    ...trpc.harnessConfig.set.mutationOptions(),
    meta: { errorToast: "Failed to apply model settings" },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({
        queryKey: harnessConfigCurrentKey(variables.agentId),
      });
    },
  });
}
