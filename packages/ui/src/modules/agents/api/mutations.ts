import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset, EnvVar } from "../../../types.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import {
  buildBundle,
  type BundleEntry,
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
  /** Initial secret grants, settled into the Agent spec at create. Omitted or
   *  empty ⇒ no secrets granted (grants are selective; there is no default). */
  secretIds?: string[];
  appConnectionIds?: string[];
  egressPreset?: EgressPreset;
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
 * access, set app connections. Per ADR-046 the agent is now a single CM
 * (no separate instance create) — `agents.create` returns the full Agent
 * including runtime state.
 */
export function useCreateAgent() {
  return useMutation({
    mutationFn: async ({
      secretIds,
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
        secretIds,
        connectionIds: appConnectionIds,
      });
      void queryClient.invalidateQueries({
        queryKey: trpc.agents.list.queryKey(),
      });
      void queryClient.invalidateQueries({
        queryKey: agentsKeys.listWithChannels(),
      });

      let preparedBundle: { blob: Blob; label: string } | undefined;
      if (rawBundle != null) {
        preparedBundle = { blob: rawBundle, label: rawBundle.name };
      } else if (importEntries && importEntries.length > 0) {
        const count = importEntries.length;
        preparedBundle = {
          blob: await buildBundle(importEntries),
          label: `${count} file${count === 1 ? "" : "s"}`,
        };
      }

      if (preparedBundle) {
        try {
          await trackImport(agent.id, () =>
            importRawBundle({ agentId: agent.id, bundle: preparedBundle.blob }),
          );
          emitToast({
            kind: "success",
            message: `Imported ${preparedBundle.label} into ${input.name}`,
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

export function useSetAgentAccess() {
  return useMutation({
    ...trpc.secrets.setAgentAccess.mutationOptions(),
    meta: {
      // Server-side `setAgentAccess` syncs `egress_rules` with the new
      // grant list (insert/revoke connection:* rows), so refetch the
      // editor's view alongside the access query.
      invalidates: [
        trpc.secrets.getAgentAccess.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Failed to update credential access",
    },
  });
}

export function useSetAgentConnections() {
  return useMutation({
    ...trpc.connections.setAgentConnections.mutationOptions(),
    meta: {
      // Server-side `setAgentConnections` syncs `connection:<id>` egress
      // rules per granted provider's API hosts (ADR-035).
      // Refetch the editor's view alongside the grants query.
      invalidates: [
        trpc.connections.getAgentConnections.queryKey(),
        egressRulesKeys.all,
      ],
      errorToast: "Failed to update app connections",
    },
  });
}

/**
 * Imperative fetch of per-agent access, used by consumers (e.g. MCP picker)
 * that need the data outside a component render.
 */
export async function fetchAgentAccess(agentId: string) {
  return queryClient.fetchQuery({
    ...trpc.secrets.getAgentAccess.queryOptions({ agentId: agentId }),
  });
}
