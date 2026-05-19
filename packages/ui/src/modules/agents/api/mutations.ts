import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast-sink.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset, EnvVar } from "../../../types.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import {
  buildBundle,
  type BundleEntry,
  importRawBundle,
} from "../../files/api/import-bundle.js";
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
  /** undefined ⇒ accept controller's default (auto-assign Anthropic selective).
   *  explicit array (incl. []) ⇒ override. */
  secretIds?: string[];
  appConnectionIds?: string[];
  egressPreset?: EgressPreset;
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
      // Step order is tuned for fastest user-visible feedback:
      //   1. agents.create + invalidate → tile appears with runtime state
      //   2. buildBundle (lazy Blob, microseconds) + upload
      //   3. setAgentAccess / setAgentConnections
      // Import goes BEFORE access/connection mutations: those rewrite the
      // agent ConfigMap's grant annotations, which the controller applies
      // by deleting and recreating the pod — running the import after them
      // races with the pod swap and surfaces as "agent unreachable". The
      // PVC outlives the pod so files land regardless of when the pod
      // comes back. Raw bundle wins when both are provided.
      const agent = await api.agents.create.mutate({ ...input, egressPreset });
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
          await importRawBundle({
            agentId: agent.id,
            bundle: preparedBundle.blob,
          });
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

      if (secretIds !== undefined) {
        await withRetry(() =>
          api.secrets.setAgentAccess.mutate({
            agentId: agent.id,
            secretIds,
          }),
        );
      }
      if (appConnectionIds?.length) {
        await withRetry(() =>
          api.connections.setAgentConnections.mutate({
            agentId: agent.id,
            connectionIds: appConnectionIds,
          }),
        );
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

export function useWakeAgent() {
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

async function withRetry(
  fn: () => Promise<void>,
  maxAttempts = 5,
  delayMs = 2000,
) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
