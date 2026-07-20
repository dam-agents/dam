import type {
  FormState,
  UseFormHandleSubmit,
  UseFormReset,
} from "react-hook-form";

import { sanitizeEnvVars } from "../../../components/env-vars-editor.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  useSetAgentConnections,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../../egress-rules/api/mutations.js";
import { splitHostPort } from "../../egress-rules/host-port.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import type { SettingsValues } from "./sandbox-settings-schema.js";
import type { useStagedNetworkAccess } from "./use-staged-network-access.js";

interface Args {
  agentId: string | null;
  agent: AgentView | null;
  dirty: boolean;
  net: ReturnType<typeof useStagedNetworkAccess>;
  providerAppIds: ReadonlySet<string>;
  /** Server-truth grant ids at render time (grants apply immediately
   *  elsewhere, so the form's copy may be stale while a provider stages). */
  savedConnectionIds: string[];
  handleSubmit: UseFormHandleSubmit<SettingsValues>;
  reset: UseFormReset<SettingsValues>;
  dirtyFields: FormState<SettingsValues>["dirtyFields"];
}

/** The Save orchestration: restart confirmations first (so declining aborts
 *  before anything commits), then the agent patch, egress preset, provider
 *  grant swap, and rule edits, ending with a form re-baseline. */
export function useSandboxSettingsSave({
  agentId,
  agent,
  dirty,
  net,
  providerAppIds,
  savedConnectionIds,
  handleSubmit,
  reset,
  dirtyFields,
}: Args) {
  const showConfirm = useStore((s) => s.showConfirm);
  const updateAgent = useUpdateAgent();
  const setAgentConnections = useSetAgentConnections();
  const applyPreset = useApplyEgressPreset();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();

  return handleSubmit(async (values) => {
    if (!agentId || !dirty) return;
    // Path-specific adds force a pod roll; confirm up front so declining
    // aborts before anything commits. This view stays mounted (unlike the
    // old modal), so a mid-save abort would otherwise leave already-committed
    // fields shown as unsaved.
    const restartingHosts = net.pendingAdds
      .filter((a) => a.method !== "*" || a.pathPattern !== "*")
      .map((a) => a.host);
    if (
      restartingHosts.length > 0 &&
      !(await showConfirm(
        `Saving will restart the agent (~5–15s) so Envoy can MITM ${restartingHosts.length === 1 ? `"${restartingHosts[0]}"` : `${restartingHosts.length} hosts`} for path-level enforcement.`,
        "Restart agent?",
        { confirmLabel: "Save & restart" },
      ))
    ) {
      return;
    }
    if (
      dirtyFields.hibernationTimeoutMin &&
      agent &&
      !(await confirmHibernationChange(
        agent.hibernationTimeoutMin,
        values.hibernationTimeoutMin,
        showConfirm,
      ))
    ) {
      return;
    }
    const sizeDirty = dirtyFields.sizeCpuMilli || dirtyFields.sizeMemoryMi;
    if (
      sizeDirty &&
      agent &&
      !(agent.state === "hibernated" || agent.overBudget) &&
      !(await showConfirm(
        "Saving will restart the sandbox to apply its new size — in-flight work is interrupted.",
        "Restart sandbox?",
        { confirmLabel: "Save & restart" },
      ))
    ) {
      return;
    }
    try {
      if (
        dirtyFields.envVars ||
        dirtyFields.name ||
        dirtyFields.hibernationTimeoutMin ||
        sizeDirty
      ) {
        await updateAgent.mutateAsync({
          id: agentId,
          ...(dirtyFields.envVars
            ? { env: sanitizeEnvVars(values.envVars) }
            : {}),
          ...(dirtyFields.name ? { name: values.name.trim() } : {}),
          ...(dirtyFields.hibernationTimeoutMin
            ? { hibernationTimeoutMin: values.hibernationTimeoutMin }
            : {}),
          // Only the touched dimension ships (the server merge-patches per
          // dimension): re-sending an untouched one would rewrite a spec
          // value this form couldn't parse (and so baselined to a fallback).
          ...(sizeDirty
            ? {
                size: {
                  ...(dirtyFields.sizeCpuMilli
                    ? { cpu: `${values.sizeCpuMilli}m` }
                    : {}),
                  ...(dirtyFields.sizeMemoryMi
                    ? { memory: `${values.sizeMemoryMi}Mi` }
                    : {}),
                },
              }
            : {}),
        });
      }
      if (net.stagedPreset !== null) {
        await applyPreset.mutateAsync({ agentId, preset: net.stagedPreset });
      }
      let savedAppIds = values.assignedAppIds;
      if (dirtyFields.assignedAppIds) {
        // Only the provider choice stages; app grants come from server truth.
        savedAppIds = [
          ...new Set([
            ...savedConnectionIds.filter((id) => !providerAppIds.has(id)),
            ...values.assignedAppIds.filter((id) => providerAppIds.has(id)),
          ]),
        ].sort();
        await setAgentConnections.mutateAsync({
          agentId,
          connectionIds: savedAppIds,
        });
      }
      for (const id of net.pendingDeletes) await revokeRule.mutateAsync({ id });
      for (const add of net.pendingAdds) {
        await createRule.mutateAsync({
          agentId,
          ...splitHostPort(add.host),
          method: add.method,
          pathPattern: add.pathPattern,
          verdict: add.verdict,
        });
      }
      net.reset();
      // RHF `reset(values)` replaces the value set wholesale — every schema
      // field must be present, or the omitted ones become undefined and all
      // later saves fail validation invisibly.
      reset({
        name: values.name.trim(),
        assignedAppIds: savedAppIds,
        envVars: values.envVars,
        hibernationTimeoutMin: values.hibernationTimeoutMin,
        sizeCpuMilli: values.sizeCpuMilli,
        sizeMemoryMi: values.sizeMemoryMi,
      });
    } catch {
      // Mutation meta.errorToast surfaces the failure; stay on the page.
    }
  });
}
