import { useMutation } from "@tanstack/react-query";
import type { AgentConnections } from "api-server-api";

import { getErrorMessage } from "@/lib/errors";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset, EnvVar } from "../../../types.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import {
  type BundleEntry,
  importBundle,
  importRawBundle,
} from "../../files/api/import-bundle.js";
import { trackImport } from "../../files/track-import.js";
import { agentsKeys } from "./queries.js";

const invalidatesAgentsList = {
  invalidates: [agentsKeys.listWithChannels(), trpc.agents.list.queryKey()],
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
  env?: EnvVar[];
  appConnectionIds?: string[];
  egressPreset?: EgressPreset;
  registryCredential?: { server: string; username: string; password: string };
  gitRepo?: { url: string; ref?: string };
  importEntries?: BundleEntry[];
  importRawBundle?: File;
  size?: { cpu?: string; memory?: string };
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
      void queryClient.invalidateQueries({
        queryKey: trpc.agents.list.queryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: agentsKeys.listWithChannels(),
      });

      let runImport: (() => Promise<unknown>) | undefined;
      let importLabel = "";
      if (rawBundle != null) {
        importLabel = rawBundle.name;
        runImport = () =>
          importRawBundle({ agentId: agent.id, bundle: rawBundle });
      } else if (importEntries && importEntries.length > 0) {
        const count = importEntries.length;
        importLabel = `${count} file${count === 1 ? "" : "s"}`;
        runImport = () =>
          importBundle({ agentId: agent.id, entries: importEntries });
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
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to create agent",
    },
  });
}

export function useDeleteAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to delete agent",
    },
  });
}

export function useUpdateAgent() {
  return useMutation({
    ...trpc.agents.update.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to update agent",
    },
  });
}

export function useWakeAgentMutation() {
  return useMutation({
    ...trpc.agents.wake.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to start agent",
    },
  });
}

export function usePauseAgent() {
  return useMutation({
    ...trpc.agents.pause.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to pause sandbox",
    },
  });
}

export function useStopAgent() {
  return useMutation({
    ...trpc.agents.stop.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to stop sandbox",
    },
  });
}

export function useRestartAgentMutation() {
  return useMutation({
    ...trpc.agents.restart.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      errorToast: "Failed to restart agent",
    },
  });
}

export function useUpgradeAgentMutation(opts?: { silent?: boolean }) {
  return useMutation({
    ...trpc.agents.upgrade.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndBudget,
      ...(opts?.silent
        ? { suppressErrorToast: true }
        : { errorToast: "Failed to update sandbox" }),
    },
  });
}

export function useConnectSlack() {
  return useMutation({
    ...trpc.agents.connectSlack.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to connect Slack",
    },
  });
}

export function useDisconnectSlack() {
  return useMutation({
    ...trpc.agents.disconnectSlack.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to disconnect Slack",
    },
  });
}

export function useSetAgentConnections() {
  return useMutation({
    mutationFn: (vars: { agentId: string; connectionIds: string[] }) =>
      api.connections.setAgentConnections.mutate(vars),
    onMutate: async (vars) => {
      const key = trpc.connections.getAgentConnections.queryKey({
        agentId: vars.agentId,
      });
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<AgentConnections>(key);
      if (previous) {
        const byId = new Map(
          previous.connections.map((c) => [c.connectionId, c]),
        );
        queryClient.setQueryData<AgentConnections>(key, {
          ...previous,
          connections: vars.connectionIds.map(
            (id) =>
              byId.get(id) ?? {
                connectionId: id,
                grantedAt: new Date().toISOString(),
              },
          ),
        });
      }
      return { previous, key };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous)
        queryClient.setQueryData(context.key, context.previous);
    },
    meta: {
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Failed to update app connections",
    },
  });
}
