import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import { type HarnessCatalogView, routesSessionPairs } from "agent-runtime-api";
import type {
  ConnectionView,
  DefaultKind,
  HarnessConfigStatus,
  HarnessView,
  OwnerModelCatalogView,
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
import { useAgentPageConnections } from "../../connections/api/queries.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import { askToRestartAfterSave } from "../../processes/lib/ask-restart-after-save.js";
import { catalogSettled, sameModel } from "../lib/catalog-groups.js";
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

const sessionPairInput = (agentId: string, kind: DefaultKind) =>
  kind === "chat" ? { agentId } : { agentId, kind };

export function useRememberedPair(
  agentId: string | null,
  kind: DefaultKind = "chat",
) {
  return useQuery({
    ...trpc.harnessConfig.sessionPair.queryOptions(
      agentId ? sessionPairInput(agentId, kind) : skipToken,
    ),
    retry: false,
  });
}

export function useSessionDefaults(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.sessionDefaults.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

function invalidateDefaults(): Promise<void> {
  return Promise.all(
    [
      trpc.harnessConfig.sessionPair.pathKey(),
      trpc.harnessConfig.sessionDefaults.pathKey(),
      trpc.harnessConfig.defaultFor.pathKey(),
      trpc.attention.pathKey(),
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  ).then(() => undefined);
}

export function clearSessionDefault(
  agentId: string,
  kind: Exclude<DefaultKind, "chat">,
): void {
  void api.harnessConfig.clearSessionDefault
    .mutate({ agentId, kind })
    .catch((err: unknown) => {
      emitToast({
        kind: "error",
        message: `Couldn't set the ${kind} default back to the chat default: ${err instanceof Error ? err.message : String(err)}`,
      });
    })
    .finally(() => invalidateDefaults());
}

export function providerModelsKey(
  agentId: string | null,
  harness: string | null,
  provider: string | null,
) {
  return ["provider-models", agentId, harness, provider] as const;
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
    queryKey: providerModelsKey(agentId, harness, provider),
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

export function harnessCatalogModelsKey(
  agentId: string | null,
  harness: string | null,
  grantedIds: readonly string[],
) {
  return ["harness-catalog-models", agentId, harness, grantedIds] as const;
}

const CATALOG_POLL_MS = 5_000;
const CATALOG_POLL_LIMIT = 12;

/**
 * UNIT_BOUNDARY_DESCRIPTION: keyed by the agent's granted providers, so a
 * grant or revoke asks again at once, and polled until the catalog has caught
 * up with them, since a grant reaches the pod a few seconds after it is
 * saved and its first listings wait for the restarted egress gateway. A
 * provider still unavailable after a minute, or a failing read, stops the
 * poll; `waiting` says the poll is still running.
 */
export function useHarnessCatalogModels(
  agentId: string | null,
  harness: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  const { granted } = useProviderConnections(agentId);
  const grantedIds = granted.map((p) => p.id).sort();
  const polling = (state: {
    status: string;
    dataUpdateCount: number;
    data: HarnessCatalogView | undefined;
  }) =>
    state.status !== "error" &&
    state.dataUpdateCount < CATALOG_POLL_LIMIT &&
    !catalogSettled(state.data, grantedIds);
  const queryKey = harnessCatalogModelsKey(agentId, harness, grantedIds);
  const query = useQuery({
    queryKey,
    queryFn:
      agentId && harness && operable
        ? () => agentTrpc(agentId).harnessConfig.catalog.query({ harness })
        : skipToken,
    staleTime: 60_000,
    refetchInterval: (q) => (polling(q.state) ? CATALOG_POLL_MS : false),
    retry: 5,
    retryDelay: 2_000,
  });
  return {
    ...query,
    operable,
    granted,
    waiting:
      operable &&
      polling({
        status: query.status,
        dataUpdateCount:
          queryClient.getQueryState(queryKey)?.dataUpdateCount ?? 0,
        data: query.data,
      }),
  };
}

export function ownerHarnessCatalogKey(harness: string | null) {
  return ["owner-harness-catalog", harness] as const;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a harness's model list from the owner-level
 * catalog, so a picker outside an agent (Settings › Profiles) lists models
 * without borrowing one. The catalog names models as the plain
 * `<alias>/<id>` a session stores; the runtime renders the harness's own
 * spelling when it starts.
 */
export function useOwnerHarnessStatus() {
  const query = useQuery({
    ...trpc.connections.catalog.queryOptions(),
    staleTime: 60_000,
    retry: 2,
  });
  return {
    ...query,
    data: query.data && {
      defaultHarness: query.data.defaultHarness,
      modelRouter: query.data.modelRouter,
      harnesses: query.data.harnesses,
    },
  };
}

export function useOwnerHarnessCatalog(harness: string | null) {
  const query = useQuery({
    ...trpc.connections.catalog.queryOptions(),
    enabled: harness !== null,
    staleTime: 60_000,
    retry: 2,
  });
  return {
    ...query,
    data:
      query.data && harness ? ownerHarnessView(query.data, harness) : undefined,
    granted: [] as ProviderConnectionRef[],
    waiting: false,
  };
}

function ownerHarnessView(
  catalog: OwnerModelCatalogView,
  harness: string,
): HarnessCatalogView {
  return {
    harness,
    routed: true,
    providers: catalog.providers.map((provider) => ({
      connectionId: provider.connectionId,
      alias: provider.alias,
      template: provider.template,
      displayName: provider.displayName,
      status: provider.harnesses.includes(harness)
        ? provider.status
        : "unsupported",
      listedAt: provider.listedAt,
      native:
        catalog.harnesses
          .find((h) => h.name === harness)
          ?.nativeTemplates?.includes(provider.template) ?? false,
      models: provider.models
        .filter((model) => model.harnesses.includes(harness))
        .map(({ harnesses: _harnesses, ...model }) => model),
    })),
  };
}

export function harnessConfigCurrentKey(agentId: string, harness: string) {
  return ["harness-config-current", agentId, harness] as const;
}

export function useHarnessConfigured(
  agentId: string | null,
  harness: string | null,
) {
  const operable = useIsAgentOperable(agentId);
  return useQuery({
    queryKey: harnessConfigCurrentKey(agentId ?? "", harness ?? ""),
    queryFn:
      agentId && operable && harness
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
  failed: boolean;
} {
  const { data: grants, isError: grantsFailed } = useAgentConnections(agentId);
  const { data: connections, isError: connectionsFailed } =
    useAgentPageConnections(agentId);
  return {
    ...grantedProviderRefs(
      (grants?.connections ?? []).map((g) => g.connectionId),
      connections ?? [],
    ),
    loaded: grants !== undefined && connections !== undefined,
    failed: grantsFailed || connectionsFailed,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: attaches a provider without the restart question,
 * for a caller that runs on it at once: the grant reaches a pod the session
 * start boots, so nothing running is left on the old env.
 */
export async function attachProviderQuietly(
  agentId: string,
  connectionId: string,
): Promise<boolean> {
  try {
    await api.connections.updateAgentConnections.mutate({
      agentId,
      grant: [connectionId],
      revoke: [],
    });
  } catch (err: unknown) {
    emitToast({
      kind: "error",
      message: `Couldn't attach the model provider: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
  await Promise.all(
    [
      trpc.connections.getAgentConnections.pathKey(),
      trpc.harnessConfig.sessionPair.pathKey(),
      egressRulesKeys.all,
    ].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
  return true;
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
        trpc.attention.pathKey(),
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
    attachAll: async (connectionIds: readonly string[]) => {
      if (!(await settle({ grant: [...connectionIds] }))) return false;
      await queryClient.invalidateQueries({
        queryKey: trpc.connections.getAgentConnections.queryKey(),
      });
      return true;
    },
    grant: (connectionId: string) => settle({ grant: [connectionId] }),
    revoke: (connectionId: string) => settle({ revoke: [connectionId] }),
    pending: update.isPending,
  };
}

export function readNextSessionPair(
  agentId: string,
): { pair: SessionPair; picked: boolean } | null {
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
  return pair
    ? {
        pair,
        picked: chosen !== null && !(remembered && samePair(pair, remembered)),
      }
    : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a pick left in the picker from an earlier
 * session, or one that lands on the chat default, starts the session on the
 * default; only a pair that differs from it is the session's own choice.
 */
export function samePair(a: SessionPair, b: SessionPair): boolean {
  const settings = (p: SessionPair) => Object.entries(p.settings ?? {}).sort();
  return (
    a.harness === b.harness &&
    (a.model === b.model || sameModel(a.model, b.model)) &&
    JSON.stringify(settings(a)) === JSON.stringify(settings(b))
  );
}

export async function settledNextSessionPair(
  agentId: string,
): Promise<{ pair: SessionPair; picked: boolean } | null> {
  const status = trpc.harnessConfig.status.queryKey({ agentId });
  if (!queryClient.getQueryData<HarnessConfigStatus>(status)?.harnesses)
    await Promise.all(
      [status, trpc.harnessConfig.sessionPair.queryKey({ agentId })].map(
        (queryKey) => queryClient.refetchQueries({ queryKey }),
      ),
    );
  return readNextSessionPair(agentId);
}

export function rememberSessionPair(
  agentId: string,
  pair: SessionPair,
  kind: DefaultKind = "chat",
  onSaved?: () => void,
  references?: {
    profileId?: string | null;
    platformSubagentProfileId?: string | null;
  },
): void {
  const key = trpc.harnessConfig.sessionPair.queryKey(
    sessionPairInput(agentId, kind),
  );
  const previous = queryClient.getQueryData<SessionPair | null>(key);
  const resolved = pair.provider !== null;
  if (resolved) queryClient.setQueryData<SessionPair | null>(key, pair);
  void api.harnessConfig.rememberSessionPair
    .mutate({
      agentId,
      kind,
      ...pair,
      ...(references?.profileId !== undefined && {
        profileId: references.profileId,
      }),
      ...(references?.platformSubagentProfileId !== undefined && {
        platformSubagentProfileId: references.platformSubagentProfileId,
      }),
    })
    .then(() => onSaved?.())
    .catch((err: unknown) => {
      if (resolved)
        queryClient.setQueryData<SessionPair | null>(key, previous ?? null);
      emitToast({
        kind: "error",
        message: `Couldn't save the ${kind} default: ${err instanceof Error ? err.message : String(err)}`,
      });
    })
    .finally(() => invalidateDefaults());
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
