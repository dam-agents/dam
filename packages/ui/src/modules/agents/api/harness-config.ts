import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { HarnessConfigCurrent } from "agent-runtime-api";

import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { createAgentTrpc } from "../agent-trpc.js";
import { useIsAgentOperable } from "./queries.js";

export function useHarnessConfigStatus(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.status.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
    // Poll until the catalog lands (it only arrives once the agent has hello'd).
    refetchInterval: (query) => {
      const d = query.state.data;
      return d?.supported && !d.catalog ? 5000 : false;
    },
  });
}

// Cache one agent-runtime tRPC client per agentId (mirrors the files queries).
const currentClientCache = new Map<
  string,
  ReturnType<typeof createAgentTrpc>
>();
function agentTrpcFor(agentId: string) {
  let client = currentClientCache.get(agentId);
  if (!client) {
    client = createAgentTrpc(agentId);
    currentClientCache.set(agentId, client);
  }
  return client;
}

export const harnessConfigCurrentKey = (agentId: string) =>
  ["harness-config-current", agentId] as const;

export function useHarnessConfigCurrent(agentId: string | null) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: agentId ? harnessConfigCurrentKey(agentId) : ["hcc-disabled"],
    queryFn:
      agentId && operable
        ? () => agentTrpcFor(agentId).harnessConfig.current.query()
        : skipToken,
    retry: false,
  });
}

// The platform's recorded copy. Unlike useHarnessConfigCurrent this is a plain
// api-server query, not gated on the agent being operable — answering while the
// sandbox is stopped is the whole point.
export function useHarnessConfigSnapshot(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.snapshot.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

/** Where the values the panel renders came from. `none` means there is nothing
 *  to show — either the sandbox has never run, or it ran before anything was
 *  recorded. */
export type HarnessConfigOrigin = "live" | "snapshot" | "none";

export interface ResolvedHarnessConfig {
  values: HarnessConfigCurrent | null;
  origin: HarnessConfigOrigin;
  capturedAt: string | null;
  /** The sandbox has sent `hello` at least once, so a snapshot was possible. */
  hasRun: boolean;
  /** The recorded model list was observed against the model now shown, so the
   *  two can be compared. False once they have drifted — a model applied since
   *  the list was read, or a list that outlived a failed re-read. */
  modelsPaired: boolean;
  /** No read has resolved yet, so `values` and `hasRun` are placeholders. */
  pending: boolean;
}

/**
 * The values Model settings should render, and how they were obtained. A live
 * pod read wins whenever the agent is operable, so a running sandbox behaves
 * exactly as before; the recorded snapshot fills in otherwise.
 *
 * Gated on `operable` rather than on the live query having data: react-query
 * keeps the last live read cached after the agent stops, and serving that as
 * "live" would date a stopped sandbox's values wrongly.
 */
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
    // The live read is a pod round-trip, so it lands after the snapshot query.
    // Fill the gap with the recorded values rather than empty pickers — but
    // never as "snapshot", which would claim the sandbox is stopped while it is
    // visibly running.
    const values = live ?? recorded?.snapshot ?? null;
    return {
      values,
      origin: values ? "live" : "none",
      capturedAt: null,
      hasRun,
      // A live read takes both from the pod at once; nothing to reconcile.
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
      // `undefined` on rows predating the pin, which reads as unpaired — the
      // conservative direction, since it only withholds a warning.
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
