import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { routesSessionPairs } from "agent-runtime-api";
import type {
  ConnectionView,
  HarnessConfigStatus,
  HarnessView,
  SessionPair,
  SessionView,
} from "api-server-api";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import {
  useAgentConnections,
  useIsAgentAnswerableSoon,
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import { askToRestartAfterSave } from "../../processes/lib/ask-restart-after-save.js";
import { catalogSettled } from "../lib/catalog-groups.js";
import {
  fittingProviders,
  grantedProviderRefs,
  nextPair,
  type ProviderConnectionRef,
} from "../lib/session-pair-options.js";
import { acpSessionsKeys } from "./keys.js";

export function useHarnessCatalog() {
  return useQuery({
    ...trpc.templates.harnesses.queryOptions(),
    staleTime: 5 * 60_000,
  });
}

export function useRememberedPair(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.sessionPair.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Old runtime path: remove when agents.runtimeFleet.outdated is empty on prod.
 * The models one provider lists for a harness, asked per provider.
 */
export function useProviderModels(
  agentId: string | null,
  harness: string | null,
  provider: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  const answerable = useIsAgentAnswerableSoon(agentId);
  const query = useQuery({
    queryKey: ["provider-models", agentId, harness, provider],
    queryFn:
      agentId && harness && operable
        ? async () => {
            const result = await agentTrpc(agentId).harnessConfig.models.query({
              harness,
              provider,
            });
            if (result.availableModels === undefined)
              throw new Error("Model discovery failed");
            return result;
          }
        : skipToken,
    staleTime: 60_000,
    refetchInterval: (q) =>
      q.state.data?.availableModels?.length ? false : 5_000,
    retry: 5,
    retryDelay: 2_000,
  });
  return { ...query, operable, answerable };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: keyed by the agent's granted providers, so a
 * grant or revoke asks again at once, and polled until the catalog has caught
 * up with them, since a grant reaches the pod a few seconds after it is
 * saved. A provider still unavailable after a minute, or a failing read,
 * stops the poll.
 */
const CATALOG_POLL_MS = 5_000;
const CATALOG_POLL_LIMIT = 12;
export function useHarnessCatalogModels(
  agentId: string | null,
  harness: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  const grantedIds = useProviderConnections(agentId)
    .granted.map((p) => p.id)
    .sort();
  const query = useQuery({
    queryKey: ["harness-catalog-models", agentId, harness, grantedIds],
    queryFn:
      agentId && harness && operable
        ? () => agentTrpc(agentId).harnessConfig.catalog.query({ harness })
        : skipToken,
    staleTime: 60_000,
    refetchInterval: (q) =>
      q.state.status === "error" ||
      q.state.dataUpdateCount >= CATALOG_POLL_LIMIT ||
      catalogSettled(q.state.data, grantedIds)
        ? false
        : CATALOG_POLL_MS,
    retry: 5,
    retryDelay: 2_000,
  });
  return { ...query, operable };
}

export function useHarnessConfigured(agentId: string, harness: string) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: ["harness-config-current", agentId, harness],
    queryFn: operable
      ? () => agentTrpc(agentId).harnessConfig.current.query({ harness })
      : skipToken,
    staleTime: 60_000,
    retry: false,
  }).data;
}

export function useProviderConnections(agentId: string | null): {
  granted: ProviderConnectionRef[];
  owned: ProviderConnectionRef[];
  loaded: boolean;
} {
  const { data: grants } = useAgentConnections(agentId);
  const { data: connections } = useAppConnections();
  return {
    ...grantedProviderRefs(
      (grants?.connections ?? []).map((g) => g.connectionId),
      connections ?? [],
    ),
    loaded: grants !== undefined && connections !== undefined,
  };
}

export function useGrantProvider(agentId: string | null) {
  const update = useMutation({
    mutationFn: (change: { grant?: string[]; revoke?: string[] }) =>
      api.connections.updateAgentConnections.mutate({
        agentId: agentId!,
        grant: change.grant ?? [],
        revoke: change.revoke ?? [],
      }),
    onSettled: (_data, error) => {
      if (!error && agentId) askToRestartAfterSave(agentId);
    },
    meta: {
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        trpc.harnessConfig.sessionPair.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Couldn't update model providers",
    },
  });
  const settle = (change: { grant?: string[]; revoke?: string[] }) =>
    update.mutateAsync(change).then(
      () => true,
      () => false,
    );
  return {
    grant: (connectionId: string) => settle({ grant: [connectionId] }),
    revoke: (connectionId: string) => settle({ revoke: [connectionId] }),
    pending: update.isPending,
  };
}

export function readNextSessionPair(
  agentId: string,
): { pair: SessionPair } | null {
  const status = queryClient.getQueryData<HarnessConfigStatus>(
    trpc.harnessConfig.status.queryKey({ agentId }),
  );
  const carried = routesSessionPairs(status?.harnesses ?? [])
    ? (status?.harnesses?.map((h) => h.name) ?? [])
    : [];
  const chosen = useStore.getState().nextSessionPair[agentId] ?? null;
  const remembered =
    queryClient.getQueryData<SessionPair | null>(
      trpc.harnessConfig.sessionPair.queryKey({ agentId }),
    ) ?? null;
  const grants = queryClient.getQueryData<{
    connections: { connectionId: string }[];
  }>(trpc.connections.getAgentConnections.queryKey({ agentId }));
  const connections =
    queryClient.getQueryData<ConnectionView[]>(
      trpc.connections.list.queryKey(),
    ) ?? [];
  const catalog =
    queryClient.getQueryData<{ harnesses: HarnessView[] }>(
      trpc.templates.harnesses.queryKey(),
    )?.harnesses ?? [];
  const { granted } = grantedProviderRefs(
    (grants?.connections ?? []).map((g) => g.connectionId),
    connections,
  );
  const pair = nextPair(
    chosen,
    remembered,
    carried,
    fittingProviders(catalog, granted),
    status?.defaultHarness,
  );
  return pair ? { pair } : null;
}

export async function settledNextSessionPair(
  agentId: string,
): Promise<{ pair: SessionPair } | null> {
  const status = trpc.harnessConfig.status.queryKey({ agentId });
  if (!queryClient.getQueryData<HarnessConfigStatus>(status)?.harnesses)
    await Promise.all(
      [status, trpc.harnessConfig.sessionPair.queryKey({ agentId })].map(
        (queryKey) => queryClient.refetchQueries({ queryKey }),
      ),
    );
  return readNextSessionPair(agentId);
}

export function rememberSessionPair(agentId: string, pair: SessionPair): void {
  void api.harnessConfig.rememberSessionPair
    .mutate({ agentId, ...pair })
    .then(() =>
      queryClient.invalidateQueries({
        queryKey: trpc.harnessConfig.sessionPair.queryKey({ agentId }),
      }),
    )
    .catch((err: unknown) =>
      emitToast({
        kind: "error",
        message: `Couldn't save the default harness and model: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
}

export function harnessOfSession(
  agentId: string,
  sessionId: string,
  fresh: boolean,
): string | undefined {
  const view = queryClient.getQueryData<SessionView | null>(
    acpSessionsKeys.session(agentId, sessionId),
  );
  return (
    view?.harness ??
    (fresh ? readNextSessionPair(agentId)?.pair.harness : undefined)
  );
}
