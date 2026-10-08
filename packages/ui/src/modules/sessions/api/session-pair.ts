import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
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
  useIsAgentOperable,
} from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
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

export function useProviderModels(
  agentId: string | null,
  harness: string | null,
  provider: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  const query = useQuery({
    queryKey: ["provider-models", agentId, harness, provider],
    queryFn:
      agentId && harness && operable
        ? () =>
            agentTrpc(agentId).harnessConfig.models.query({ harness, provider })
        : skipToken,
    staleTime: 60_000,
    retry: false,
  });
  return { ...query, operable };
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
    meta: {
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        trpc.harnessConfig.sessionPair.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Failed to update model providers",
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
): { pair: SessionPair; chosen: boolean } | null {
  const status = queryClient.getQueryData<HarnessConfigStatus>(
    trpc.harnessConfig.status.queryKey({ agentId }),
  );
  const carried = status?.harnesses?.map((h) => h.name) ?? [];
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
  );
  return pair ? { pair, chosen: chosen !== null } : null;
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
        message: `Couldn't remember this session's harness and model: ${err instanceof Error ? err.message : String(err)}`,
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
