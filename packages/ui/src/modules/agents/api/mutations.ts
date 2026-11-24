import { useMutation } from "@tanstack/react-query";
import type { AgentConnections } from "api-server-api";

import { getErrorMessage } from "@/lib/errors";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { useStore } from "../../../store.js";
import { trpc } from "../../../trpc.js";
import type { AgentView, EgressPreset, EnvVar } from "../../../types.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import {
  type BundleEntry,
  importBundle,
  importRawBundle,
} from "../../files/api/import-bundle.js";
import { trackImport } from "../../files/track-import.js";
import { askToRestartAfterSave } from "../../processes/lib/ask-restart-after-save.js";
import { seedEmptySessionList } from "../../sessions/api/queries.js";
import { AGENT_DELETED_NOTICE } from "../lib/deleted-agent.js";
import { agentsKeys } from "./queries.js";

const invalidatesAgentsList = {
  invalidates: [agentsKeys.listWithChannels(), trpc.attention.pathKey()],
};

const invalidatesAgentsAndBudget = {
  invalidates: [
    ...invalidatesAgentsList.invalidates,
    trpc.budgets.reserved.queryKey(),
  ],
};

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  avatar?: string;
  env?: EnvVar[];
  appConnectionIds?: string[];
  egressPreset?: EgressPreset;
  registryCredential?: { server: string; username: string; password: string };
  requireConnectionAddress?: boolean;
  gitRepo?: { url: string; ref?: string };
  importEntries?: BundleEntry[];
  importRawBundle?: File;
}

export function useCreateAgent() {
  return useMutation({
    mutationFn: async ({
      appConnectionIds,
      egressPreset,
      importEntries,
      importRawBundle: rawBundle,
      ...input
    }: CreateAgentInput) => {
      const agent = await api.agents.create.mutate({
        ...input,
        egressPreset,
        connectionIds: appConnectionIds,
      });
      queryClient.setQueryData<{
        list: readonly AgentView[];
        shared: readonly AgentView[];
      }>(agentsKeys.listWithChannels(), (prev) =>
        prev && !prev.list.some((a) => a.id === agent.id)
          ? { ...prev, list: [...prev.list, agent] }
          : prev,
      );
      for (const queryKey of invalidatesAgentsAndBudget.invalidates)
        void queryClient.invalidateQueries({ queryKey });

      let runImport: (() => Promise<unknown>) | undefined;
      let importLabel = "";
      if (rawBundle != null) {
        importLabel = rawBundle.name;
        runImport = () =>
          importRawBundle({
            agentId: agent.id,
            bundle: rawBundle,
          });
      } else if (importEntries && importEntries.length > 0) {
        const count = importEntries.length;
        importLabel = `${count} file${count === 1 ? "" : "s"}`;
        runImport = () =>
          importBundle({
            agentId: agent.id,
            entries: importEntries,
          });
      } else {
        seedEmptySessionList(agent.id, useStore.getState().sessionFilter);
      }

      if (runImport) {
        try {
          await trackImport(agent.id, runImport);
          emitToast({
            kind: "success",
            message: `Imported ${importLabel} into ${input.name}`,
          });
        } catch (err) {
          emitToast({
            kind: "error",
            message: `Agent created, but import failed: ${getErrorMessage(err)}`,
          });
        }
      }

      return agent;
    },
    // UNIT_BOUNDARY_DESCRIPTION: no `invalidates` meta: the global onSuccess would hold the result until the agent list refetched, so the new agent is seeded into the list and the refetches run without being awaited.
    meta: { errorToast: "Couldn't create agent" },
  });
}

export function useDeleteAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    onMutate: (variables): undefined => {
      useStore.getState().markAgentDeparted(variables.id, AGENT_DELETED_NOTICE);
    },
    onSuccess: (_data, variables) => {
      useStore.getState().clearAgentDrafts(variables.id);
    },
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't delete agent",
    },
  });
}

export function useUpdateAgent({ inlineError = false } = {}) {
  return useMutation({
    ...trpc.agents.update.mutationOptions(),
    onSettled: (_agent, error, vars) => {
      if (error || vars.name === undefined) return;
      askToRestartAfterSave(vars.id);
    },
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't update agent",
      suppressErrorToast: inlineError,
    },
  });
}

export function useSetAgentEnv() {
  return useMutation({
    ...trpc.agents.setEnv.mutationOptions(),
    onSettled: (_agent, error, vars) => {
      if (!error) askToRestartAfterSave(vars.id);
    },
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't save the environment variables",
    },
  });
}

export function useSetWhisper() {
  return useMutation({
    ...trpc.agents.setWhisper.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't change whispers",
    },
  });
}

export function useWakeAgentMutation() {
  return useMutation({
    ...trpc.agents.wake.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't start agent",
    },
  });
}

export function useRetryWorkspace() {
  return useMutation({
    ...trpc.agents.retryWorkspace.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't retry the workspace step",
    },
  });
}

export function useRestartAgentMutation() {
  return useMutation({
    ...trpc.agents.restart.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't restart agent",
    },
  });
}

export function useUpgradeAgentMutation() {
  return useMutation({
    ...trpc.agents.upgrade.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Couldn't update agent",
    },
  });
}

export function useConnectSlack() {
  return useMutation({
    ...trpc.agents.connectSlack.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't connect Slack",
    },
  });
}

export function useSetSlackModes() {
  return useMutation({
    ...trpc.agents.connectSlack.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't change the channel's settings",
    },
  });
}

export function useDisconnectSlack() {
  return useMutation({
    ...trpc.agents.disconnectSlack.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't disconnect Slack",
    },
  });
}

export interface AgentConnectionsChange {
  agentId: string;
  grant: string[];
  revoke: string[];
}

/* UNIT_BOUNDARY_DESCRIPTION: a grant or revoke sends only its change, and the server applies it to the grants it holds, so a write never carries another write's change: one that fails takes nothing with it. The writes still run one at a time, so a grant and a revoke of the same Connection land in the order they were made. A failed write takes back only its own change from the shown list. */
export function useChangeAgentConnections() {
  return useMutation({
    mutationKey: trpc.connections.updateAgentConnections.mutationKey(),
    scope: { id: "change-agent-connections" },
    mutationFn: (change: AgentConnectionsChange) =>
      api.connections.updateAgentConnections.mutate(change),
    onMutate: async (change) => {
      const key = trpc.connections.getAgentConnections.queryKey({
        agentId: change.agentId,
      });
      await queryClient.cancelQueries({ queryKey: key });
      const shown = queryClient.getQueryData<AgentConnections>(key);
      if (!shown) return { key, added: [], removed: [] };
      const revoked = new Set(change.revoke);
      const held = new Set(shown.connections.map((c) => c.connectionId));
      const removed = shown.connections.filter((c) =>
        revoked.has(c.connectionId),
      );
      const added = [...new Set(change.grant)].filter(
        (id) => !held.has(id) && !revoked.has(id),
      );
      queryClient.setQueryData<AgentConnections>(key, {
        ...shown,
        connections: [
          ...shown.connections.filter((c) => !revoked.has(c.connectionId)),
          ...added.map((connectionId) => ({
            connectionId,
            grantedAt: new Date().toISOString(),
            preferred: false,
          })),
        ],
      });
      return { key, added, removed };
    },
    onError: (_err, _change, context) => {
      if (!context) return;
      const shown = queryClient.getQueryData<AgentConnections>(context.key);
      if (shown) {
        const added = new Set(context.added);
        const kept = shown.connections.filter(
          (c) => !added.has(c.connectionId),
        );
        const keptIds = new Set(kept.map((c) => c.connectionId));
        queryClient.setQueryData<AgentConnections>(context.key, {
          ...shown,
          connections: [
            ...kept,
            ...context.removed.filter((c) => !keptIds.has(c.connectionId)),
          ],
        });
      }
    },
    onSettled: (_data, error, change) => {
      if (!error) askToRestartAfterSave(change.agentId);
    },
    meta: {
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        egressRulesKeys.all,
        trpc.attention.pathKey(),
      ],
      errorToast: "Couldn't update app connections",
    },
  });
}

export function useSetAgentEditors() {
  return useMutation({
    ...trpc.agents.setEditors.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't save the editors",
    },
  });
}

export function useLeaveAgent() {
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const left = await api.agents.leave.mutate({ id });
      useStore.getState().markAgentDeparted(id, `You left ${left.name}.`);
      return left;
    },
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Couldn't leave the agent",
    },
  });
}
