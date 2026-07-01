import { useMutation } from "@tanstack/react-query";

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

export interface CreateAgentInput {
  name: string;
  templateId?: string;
  image?: string;
  description?: string;
  env?: EnvVar[];
  appConnectionIds?: string[];
  egressPreset?: EgressPreset;
  registryCredential?: { server: string; username: string; password: string };
  /** Optional: clone this public repo (optionally a branch/tag) into the working
   *  dir once, shortly after first start (a one-shot `workspace-seed` event).
   *  Flows to `agents.create`. */
  gitRepo?: { url: string; ref?: string };
  /** Optional local-context import. Files are bundled and uploaded as a
   *  tar to the new agent's `<agenthome>/work` after the agent is
   *  created. Failures here surface as a toast but do not roll back the
   *  agent — the user can retry from the files panel. */
  importEntries?: BundleEntry[];
  /** Pre-built tar / tar.gz / tgz to upload verbatim. Mutually exclusive
   *  with `importEntries`; if both are present, the raw bundle wins. */
  importRawBundle?: File;
}

/**
 * Create-agent orchestrates: create agent, optional file import, set agent
 * access, set app connections. The agent is now a single CM
 * (no separate instance create) — `agents.create` returns the full Agent
 * including runtime state.
 */
export function useCreateAgent() {
  return useMutation({
    mutationFn: async ({
      appConnectionIds,
      egressPreset,
      importEntries,
      importRawBundle: rawBundle,
      ...input
    }: CreateAgentInput) => {
      // Single-shot create: grants ride the create call (no post-create swap).
      // Import follows; raw bundle wins over entries when both are present.
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

      // Raw bundle is sent verbatim; entries are tarred + gzipped inside importBundle.
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
            message: `Agent created, but import failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      return agent;
    },
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to create agent",
    },
  });
}

export function useDeleteAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to delete agent",
    },
  });
}

export function useUpdateAgent() {
  return useMutation({
    ...trpc.agents.update.mutationOptions(),
    meta: {
      invalidates: [trpc.agents.list.queryKey(), agentsKeys.listWithChannels()],
      errorToast: "Failed to update agent",
    },
  });
}

/**
 * Raw wake mutation. The optimistic "Starting" lifecycle is managed by
 * useWakeAgent in hooks/use-wake-agent.ts — consumers should call that so the
 * overlay/pill flips the instant the user clicks Start, not on the next poll.
 */
export function useWakeAgentMutation() {
  return useMutation({
    ...trpc.agents.wake.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to start agent",
    },
  });
}

/**
 * Raw restart mutation. The UI-side "Restarting" pill lifecycle is managed
 * by useRestartAgent in hooks/use-restart-agent.ts — consumers should
 * call that hook, not this mutation directly, so the pill lights up the
 * moment the user clicks.
 */
export function useRestartAgentMutation() {
  return useMutation({
    ...trpc.agents.restart.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to restart agent",
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

export function useConnectTelegram() {
  return useMutation({
    ...trpc.agents.connectTelegram.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to connect Telegram",
    },
  });
}

export function useDisconnectTelegram() {
  return useMutation({
    ...trpc.agents.disconnectTelegram.mutationOptions(),
    meta: {
      ...invalidatesAgentsList,
      errorToast: "Failed to disconnect Telegram",
    },
  });
}

export function useSetAgentConnections() {
  return useMutation({
    ...trpc.connections.setAgentConnections.mutationOptions(),
    meta: {
      // Server-side `setAgentConnections` syncs `connection:<id>` egress
      // rules per granted provider's API hosts.
      // Refetch the editor's view alongside the grants query.
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Failed to update app connections",
    },
  });
}
