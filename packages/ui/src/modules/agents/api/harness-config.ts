import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { HarnessConfigCurrent } from "agent-runtime-api";
import type { HarnessConfigChange } from "api-server-api";
import { useRef } from "react";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { unavailableModel } from "../../sessions/components/model-settings-snapshot.js";
import { agentTrpc, agentTrpcHttp } from "../agent-trpc.js";
import { useAgentLacksLiveUpdates, useIsAgentOperable } from "./queries.js";

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
  const compat = useAgentLacksLiveUpdates(agentId);
  return useQuery({
    queryKey: agentId ? harnessConfigCurrentKey(agentId) : ["hcc-disabled"],
    queryFn:
      agentId && operable
        ? () =>
            (compat
              ? agentTrpcHttp(agentId)
              : agentTrpc(agentId)
            ).harnessConfig.current.query()
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
    const recent = recorded?.snapshot;
    const read = live ?? recent ?? null;
    const values =
      read && read.availableModels === undefined && recent?.availableModels
        ? { ...read, availableModels: recent.availableModels }
        : read;
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

function withDeclared(
  prev: HarnessConfigCurrent,
  change: HarnessConfigChange,
): HarnessConfigCurrent {
  const unset = new Set(change.unset ?? []);
  const configOptions = { ...prev.configOptions };
  for (const [id, value] of Object.entries(change.configOptions ?? {})) {
    configOptions[id] = value;
  }
  for (const id of unset) delete configOptions[id];
  return {
    ...prev,
    model: unset.has("model") ? null : (change.model ?? prev.model),
    mode: unset.has("mode") ? null : (change.mode ?? prev.mode),
    configOptions,
  };
}

interface HarnessConfigRollback {
  key: ReturnType<typeof harnessConfigCurrentKey>;
  previous: HarnessConfigCurrent;
}

export function useApplyHarnessConfig() {
  const rollback = useRef<HarnessConfigRollback | null>(null);

  return useMutation({
    ...trpc.harnessConfig.set.mutationOptions(),
    meta: {
      errorToast: "Failed to apply model settings",
      invalidates: [trpc.harnessConfig.snapshot.queryKey()],
    },
    onMutate: async (change) => {
      const key = harnessConfigCurrentKey(change.agentId);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<HarnessConfigCurrent>(key);
      rollback.current = previous ? { key, previous } : null;
      if (previous) {
        queryClient.setQueryData(key, withDeclared(previous, change));
      }
      return undefined;
    },
    onSettled: (_data, error) => {
      const pending = rollback.current;
      rollback.current = null;
      if (error && pending) {
        queryClient.setQueryData(pending.key, pending.previous);
        return;
      }
      if (pending) {
        void queryClient.invalidateQueries({
          queryKey: pending.key,
          refetchType: "none",
        });
      }
    },
  });
}
