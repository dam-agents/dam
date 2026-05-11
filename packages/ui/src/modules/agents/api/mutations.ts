import { useMutation } from "@tanstack/react-query";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast-sink.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import type { EgressPreset, EnvVar } from "../../../types.js";
import { egressRulesKeys } from "../../egress-rules/api/queries.js";
import { type BundleEntry, importBundle, importRawBundle } from "../../files/api/import-bundle.js";
import { instancesKeys } from "../../instances/api/queries.js";

const invalidatesAgentsAndInstances = {
  invalidates: [
    trpc.agents.list.queryKey(),
    instancesKeys.listWithChannels(),
  ],
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
   *  tar.gz to the new instance's /home/agent in mode=replace after the
   *  instance is created. Failures here surface as a toast but do not
   *  roll back the agent — the user can retry from the files panel. */
  importEntries?: BundleEntry[];
  /** Pre-built tar / tar.gz / tgz to upload verbatim. Mutually exclusive
   *  with `importEntries`; if both are present, the raw bundle wins. */
  importRawBundle?: File;
}

/**
 * Create-agent orchestrates four calls in sequence: create agent, create
 * instance, set agent access, set app connections. Optionally also fires
 * a one-shot file import into the new instance.
 */
export function useCreateAgent() {
  return useMutation({
    mutationFn: async ({ secretIds, appConnectionIds, egressPreset, importEntries, importRawBundle: rawBundle, ...input }: CreateAgentInput) => {
      const agent = await api.agents.create.mutate({ ...input, egressPreset });
      const instance = await api.instances.create.mutate({
        name: input.name,
        agentId: agent.id,
      });

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

      // Import is best-effort: the agent and instance are already
      // created and persisted. A failure here (pod not ready in time,
      // bundle invalid) shouldn't surface as "Failed to create agent" —
      // toast it separately so the user can retry from the files panel.
      // Raw bundle wins when both are provided (the dialog clears one
      // when the other is set, so this should not happen in practice).
      const hasRaw = rawBundle != null;
      const hasEntries = importEntries && importEntries.length > 0;
      if (hasRaw || hasEntries) {
        try {
          if (hasRaw) {
            await importRawBundle({ instanceId: instance.id, bundle: rawBundle, mode: "replace" });
            emitToast({ kind: "success", message: `Imported ${rawBundle.name} into ${input.name}` });
          } else if (hasEntries) {
            const count = importEntries.length;
            await importBundle({ instanceId: instance.id, entries: importEntries, mode: "replace" });
            emitToast({ kind: "success", message: `Imported ${count} file${count === 1 ? "" : "s"} into ${input.name}` });
          }
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
      ...invalidatesAgentsAndInstances,
      errorToast: "Failed to create agent",
    },
  });
}

export function useDeleteAgent() {
  return useMutation({
    ...trpc.agents.delete.mutationOptions(),
    meta: {
      ...invalidatesAgentsAndInstances,
      errorToast: "Failed to delete agent",
    },
  });
}

export function useUpdateAgent() {
  return useMutation({
    ...trpc.agents.update.mutationOptions(),
    meta: {
      invalidates: [trpc.agents.list.queryKey()],
      errorToast: "Failed to update agent",
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
      invalidates: [trpc.secrets.getAgentAccess.queryKey(), egressRulesKeys.all],
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
      invalidates: [trpc.connections.getAgentConnections.queryKey(), egressRulesKeys.all],
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

async function withRetry(fn: () => Promise<void>, maxAttempts = 5, delayMs = 2000) {
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
