import { zodResolver } from "@hookform/resolvers/zod";
import { isProtectedAgentEnvName } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard.js";
import { useStore } from "../../../store.js";
import { useAgentConnections, useAgents } from "../../agents/api/queries.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  useCurrentPreset,
  useEgressRulesForAgent,
} from "../../egress-rules/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";
import { parseCpuMilli, parseMemoryMi } from "../lib/quantity.js";
import {
  type SandboxSettingsStatus,
  settingsSchema,
  type SettingsValues,
} from "./sandbox-settings-schema.js";
import { useEgressPreview } from "./use-egress-preview.js";
import { useHarnessConfigDraft } from "./use-harness-config-draft.js";
import { useInheritedEnvs } from "./use-inherited-envs.js";
import { useProviderStaging } from "./use-provider-staging.js";
import { useSandboxSettingsSave } from "./use-sandbox-settings-save.js";
import { useStagedNetworkAccess } from "./use-staged-network-access.js";

export type { SandboxSettingsStatus } from "./sandbox-settings-schema.js";

export function useSandboxSettingsForm() {
  const agentId = useStore((s) => s.agentId);

  const agentsQuery = useAgents();
  const agent = useMemo(
    () =>
      agentId
        ? (agentsQuery.data?.list.find((a) => a.id === agentId) ?? null)
        : null,
    [agentsQuery.data, agentId],
  );

  const { data: apps = [] } = useAppConnections();
  const { data: templates = [] } = useTemplates();
  const connectionsQuery = useAgentConnections(agentId);
  const { data: egressRules = [] } = useEgressRulesForAgent(agentId);
  const { data: currentPreset = null } = useCurrentPreset(agentId);

  const userInitialEnv = useMemo(
    () => (agent?.env ?? []).filter((e) => !isProtectedAgentEnvName(e.name)),
    [agent?.env],
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    reset,
    resetField,
    formState,
  } = useForm<SettingsValues>({
    resolver: zodResolver(settingsSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      assignedAppIds: [],
      envVars: [],
      hibernationTimeoutMin: 60,
      sizeCpuMilli: 1000,
      sizeMemoryMi: 1024,
    },
  });
  const { errors, isDirty, isSubmitting } = formState;
  const saving = isSubmitting;

  const net = useStagedNetworkAccess(agentId);

  const harnessDraft = useHarnessConfigDraft(agentId);

  const [formReady, setFormReady] = useState(false);
  const baselinedRef = useRef(false);
  useEffect(() => {
    baselinedRef.current = false;
    setFormReady(false);
  }, [agentId]);

  useEffect(() => {
    if (baselinedRef.current) return;
    if (connectionsQuery.isFetching) return;
    if (!agent || !connectionsQuery.data) return;
    baselinedRef.current = true;
    reset({
      name: agent.name,
      assignedAppIds: connectionsQuery.data.connections
        .map((c) => c.connectionId)
        .sort(),
      envVars: userInitialEnv,
      hibernationTimeoutMin: agent.hibernationTimeoutMin,
      sizeCpuMilli: parseCpuMilli(agent.size.cpu) ?? 1000,
      sizeMemoryMi: parseMemoryMi(agent.size.memory) ?? 1024,
    });
    setFormReady(true);
  }, [
    agent,
    connectionsQuery.data,
    connectionsQuery.isFetching,
    userInitialEnv,
    reset,
  ]);

  const assignedAppIds = watch("assignedAppIds");
  const envVars = watch("envVars");
  const hibernationTimeoutMin = watch("hibernationTimeoutMin");
  const appIdsSet = useMemo(() => new Set(assignedAppIds), [assignedAppIds]);

  useEffect(() => {
    if (!formReady || formState.dirtyFields.assignedAppIds) return;
    const fresh = (connectionsQuery.data?.connections ?? [])
      .map((c) => c.connectionId)
      .sort();
    if (fresh.join("\n") !== [...assignedAppIds].sort().join("\n"))
      resetField("assignedAppIds", { defaultValue: fresh });
  }, [
    formReady,
    formState.dirtyFields.assignedAppIds,
    connectionsQuery.data,
    assignedAppIds,
    resetField,
  ]);

  const { providerAppIds, selectedProvider, selectProvider } =
    useProviderStaging({
      apps,
      assignedAppIds,
      getAssignedAppIds: () => getValues("assignedAppIds"),
      setAssignedAppIds: (ids) =>
        setValue("assignedAppIds", ids, { shouldDirty: true }),
    });

  const inheritedEnvs = useInheritedEnvs({
    agentEnv: agent?.env ?? [],
    apps,
    appIdsSet,
    envVars,
  });

  const egressStaged = useEgressPreview({
    net,
    apps,
    assignedAppIds,
    savedConnections: connectionsQuery.data?.connections,
  });

  const dirty = isDirty || net.dirty || harnessDraft.dirty;
  const isSubmitDisabled =
    saving || !formReady || !dirty || selectedProvider === null;

  useUnsavedGuard(dirty);

  const onSave = useSandboxSettingsSave({
    agentId,
    agent,
    dirty,
    net,
    harnessDraft,
    providerAppIds,
    savedConnectionIds:
      connectionsQuery.data?.connections.map((c) => c.connectionId) ?? [],
    handleSubmit,
    reset,
    dirtyFields: formState.dirtyFields,
  });

  const status: SandboxSettingsStatus = !agentId
    ? "no-agent"
    : agentsQuery.data !== undefined && !agent
      ? "not-found"
      : !agent
        ? "loading"
        : "ready";

  const templateName =
    agent && agent.templateId
      ? (templates.find((t) => t.id === agent.templateId)?.name ??
        agent.templateId)
      : null;

  return {
    status,
    agent,
    templateName,
    register,
    control,
    errors,
    saving,
    formReady,
    selectedProvider,
    selectProvider,
    currentPreset,
    egressStaged,
    inheritedEnvs,
    hibernationTimeoutMin,
    sizeCpuMilli: watch("sizeCpuMilli"),
    sizeMemoryMi: watch("sizeMemoryMi"),
    setSize: (patch: { sizeCpuMilli?: number; sizeMemoryMi?: number }) => {
      if (patch.sizeCpuMilli !== undefined)
        setValue("sizeCpuMilli", patch.sizeCpuMilli, { shouldDirty: true });
      if (patch.sizeMemoryMi !== undefined)
        setValue("sizeMemoryMi", patch.sizeMemoryMi, { shouldDirty: true });
    },
    sizeRestartsAgent:
      agent !== null && !(agent.state === "hibernated" || agent.overBudget),
    harnessDraft,
    dirty,
    isSubmitDisabled,
    wildcardHostInScope:
      net.pendingAdds.some((a) => a.host.trim() === "*") ||
      egressRules.some(
        (r) => r.host === "*" && !net.pendingDeletes.has(r.id),
      ) ||
      (net.stagedPreset ?? currentPreset) === "all",
    onSave,
  };
}
