import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import type { HarnessConfigCurrent } from "agent-runtime-api";
import {
  type AgentConnections,
  aliasForProviderType,
  type ConnectionView,
  CURVE_BENDER_WORK_MODEL,
  formatQualifiedModel,
  type HarnessConfigChange,
  providerTypeForTemplateId,
} from "api-server-api";
import { useRef } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { unavailableModel } from "../../sessions/components/model-settings-snapshot.js";
import { chatDefaultFor } from "../../sessions/lib/chat-default.js";
import { agentTrpc, agentTrpcHttp } from "../agent-trpc.js";
import {
  agentsKeys,
  useAgentLacksLiveUpdates,
  useIsAgentOperable,
} from "./queries.js";

export function useHarnessConfigStatus(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.status.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

export function useChatDefault(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.sessionPair.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

const harnessConfigCurrentKey = (agentId: string) =>
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

function useHarnessConfigSnapshot(agentId: string | null) {
  return useQuery({
    ...trpc.harnessConfig.snapshot.queryOptions(
      agentId ? { agentId } : skipToken,
    ),
    retry: false,
  });
}

type HarnessConfigOrigin = "live" | "snapshot" | "none";

interface ResolvedHarnessConfig {
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
    const backFilled =
      read !== null &&
      read.availableModels === undefined &&
      !!recent?.availableModels;
    const values = backFilled
      ? { ...read, availableModels: recent.availableModels }
      : read;
    return {
      values,
      origin: values ? "live" : "none",
      capturedAt: null,
      hasRun,
      modelsPaired: !backFilled,
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

function rememberChatDefault(
  agentId: string,
  model: string | undefined,
): Promise<void> {
  if (model === undefined) return Promise.resolve();
  const status = queryClient.getQueryData<{ defaultHarness: string | null }>(
    trpc.harnessConfig.status.queryKey({ agentId }),
  );
  const agent = queryClient
    .getQueryData<{ list: { id: string; harness?: string }[] }>(
      agentsKeys.listWithChannels(),
    )
    ?.list.find((a) => a.id === agentId);
  const grants = queryClient.getQueryData<AgentConnections>(
    trpc.connections.getAgentConnections.queryKey({ agentId }),
  );
  const pair = chatDefaultFor({
    harness: status?.defaultHarness ?? agent?.harness,
    model,
    grantedConnectionIds: (grants?.connections ?? []).map(
      (grant) => grant.connectionId,
    ),
    connections:
      queryClient.getQueryData<ConnectionView[]>(
        trpc.connections.list.queryKey(),
      ) ?? [],
  });
  if (!pair) return Promise.resolve();
  return api.harnessConfig.rememberSessionPair
    .mutate({ agentId, kind: "chat", ...pair })
    .then(() => {
      void queryClient.invalidateQueries({
        queryKey: trpc.harnessConfig.sessionPair.pathKey(),
      });
    });
}

export function useApplyHarnessConfig() {
  const rollback = useRef<HarnessConfigRollback | null>(null);

  return useMutation<void, Error, HarnessConfigChange & { agentId: string }>({
    mutationFn: async (change) => {
      await api.harnessConfig.set.mutate(change);
      await rememberChatDefault(change.agentId, change.model);
    },
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Try now on the CurveBender offer. An agent that
 * does not carry Pi is refused before anything changes. An agent holds one
 * `cb` provider, so the shared Connection replaces any own-key CurveBender
 * grant, and every other grant stays. Then the new-chat pair moves to Pi on it
 * with the CurveBender work model. When a step fails and a read shows the
 * pair was not saved, the grants go back as they were, so the old default
 * keeps its provider; a saved pair, or one whose state is unknown, keeps the
 * grants it may run on.
 */
export function useTryCurveBender() {
  return useMutation<void, Error, { agentId: string; sharedId: string }>({
    mutationFn: async ({ agentId, sharedId }) => {
      const status = await api.harnessConfig.status.query({ agentId });
      if (!status.harnesses?.some((h) => h.name === "pi"))
        throw new Error(
          "This agent can't run Pi yet. Start it once, or create a new agent.",
        );
      const grants = await api.connections.getAgentConnections.query({
        agentId,
      });
      const granted = new Set(grants.connections.map((g) => g.connectionId));
      const ownKeys = (
        queryClient.getQueryData<ConnectionView[]>(
          trpc.connections.list.queryKey(),
        ) ?? []
      )
        .filter(
          (c) =>
            c.id !== sharedId &&
            granted.has(c.id) &&
            providerTypeForTemplateId(c.templateId) === "curve-bender",
        )
        .map((c) => c.id);
      const change = granted.has(sharedId)
        ? null
        : { grant: [sharedId], revoke: ownKeys };
      try {
        if (change)
          await api.connections.updateAgentConnections.mutate({
            agentId,
            ...change,
          });
        await api.harnessConfig.rememberSessionPair.mutate({
          agentId,
          kind: "chat",
          harness: "pi",
          provider: sharedId,
          model: formatQualifiedModel(
            aliasForProviderType("curve-bender"),
            CURVE_BENDER_WORK_MODEL,
          ),
        });
      } catch (error) {
        const saved = await api.harnessConfig.sessionPair
          .query({ agentId })
          .then((pair) => pair?.provider === sharedId)
          .catch(() => true);
        if (change && !saved)
          await api.connections.updateAgentConnections.mutate({
            agentId,
            grant: change.revoke,
            revoke: change.grant,
          });
        void queryClient.invalidateQueries({
          queryKey: trpc.harnessConfig.sessionPair.pathKey(),
        });
        void queryClient.invalidateQueries({
          queryKey: trpc.connections.getAgentConnections.queryKey(),
        });
        throw error;
      }
    },
    meta: {
      errorToast: "Couldn't switch to CurveBender",
      invalidates: [
        trpc.harnessConfig.sessionPair.pathKey(),
        trpc.connections.getAgentConnections.queryKey(),
      ],
    },
  });
}
