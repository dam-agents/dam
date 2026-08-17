import type { EgressRuleView } from "api-server-api";
import type {
  FormState,
  UseFormHandleSubmit,
  UseFormReset,
} from "react-hook-form";

import { sanitizeEnvVars } from "../../../components/env-vars-editor.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useApplyHarnessConfig } from "../../agents/api/harness-config.js";
import {
  useSetAgentConnections,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../../egress-rules/api/mutations.js";
import { useEgressRulesForAgent } from "../../egress-rules/api/queries.js";
import {
  describeGatewayRestart,
  GATEWAY_RESTART_TITLE,
  stagedGatewayRestart,
  toPromotionRule,
} from "../../egress-rules/gateway-restart.js";
import { splitHostPort } from "../../egress-rules/host-port.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import type { SettingsValues } from "./sandbox-settings-schema.js";
import type { useHarnessConfigDraft } from "./use-harness-config-draft.js";
import type { useStagedNetworkAccess } from "./use-staged-network-access.js";

const EMPTY_RULES: EgressRuleView[] = [];

interface Args {
  agentId: string | null;
  agent: AgentView | null;
  dirty: boolean;
  net: ReturnType<typeof useStagedNetworkAccess>;
  harnessDraft: ReturnType<typeof useHarnessConfigDraft>;
  providerAppIds: ReadonlySet<string>;
  savedConnectionIds: string[];
  handleSubmit: UseFormHandleSubmit<SettingsValues>;
  reset: UseFormReset<SettingsValues>;
  dirtyFields: FormState<SettingsValues>["dirtyFields"];
}

export function useSandboxSettingsSave({
  agentId,
  agent,
  dirty,
  net,
  harnessDraft,
  providerAppIds,
  savedConnectionIds,
  handleSubmit,
  reset,
  dirtyFields,
}: Args) {
  const showConfirm = useStore((s) => s.showConfirm);
  const { data: serverRules = EMPTY_RULES } = useEgressRulesForAgent(agentId);
  const updateAgent = useUpdateAgent();
  const applyHarnessConfig = useApplyHarnessConfig();
  const setAgentConnections = useSetAgentConnections();
  const applyPreset = useApplyEgressPreset();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();

  return handleSubmit(async (values) => {
    if (!agentId || !dirty) return;
    const gatewayRestart = stagedGatewayRestart({
      current: serverRules,
      adds: net.pendingAdds.map(toPromotionRule),
      removeIds: [...net.pendingDeletes],
    });
    if (
      gatewayRestart.willRestart &&
      !(await showConfirm(
        describeGatewayRestart(gatewayRestart),
        GATEWAY_RESTART_TITLE,
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
      if (harnessDraft.dirty) {
        await applyHarnessConfig.mutateAsync(harnessDraft.buildInput(agentId));
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
      harnessDraft.commit();
      reset({
        name: values.name.trim(),
        assignedAppIds: savedAppIds,
        envVars: values.envVars,
        hibernationTimeoutMin: values.hibernationTimeoutMin,
        sizeCpuMilli: values.sizeCpuMilli,
        sizeMemoryMi: values.sizeMemoryMi,
      });
    } catch {}
  });
}
