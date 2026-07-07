import { zodResolver } from "@hookform/resolvers/zod";
import {
  isProtectedAgentEnvName,
  providerTypeForTemplateId,
} from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  allEnvVarsValid,
  sanitizeEnvVars,
} from "../../../components/env-vars-editor.js";
import { useUnsavedGuard } from "../../../hooks/use-unsaved-guard.js";
import { useStore } from "../../../store.js";
import {
  useSetAgentConnections,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import { useAgentConnections, useAgents } from "../../agents/api/queries.js";
import type { InheritedEnv } from "../../agents/components/configure-agent/env-tab.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  useApplyEgressPreset,
  useCreateEgressRule,
  useRevokeEgressRule,
} from "../../egress-rules/api/mutations.js";
import {
  useCurrentPreset,
  useEgressRulesForAgent,
} from "../../egress-rules/api/queries.js";
import type { StagedNetworkAccessController } from "../../egress-rules/components/agent-egress-editor.js";
import { splitHostPort } from "../../egress-rules/host-port.js";
import type { ProviderRef } from "../../providers/components/provider-item.js";
import { useTemplates } from "../../templates/api/queries.js";
import { confirmHibernationChange } from "../lib/hibernation.js";
import { useStagedNetworkAccess } from "./use-staged-network-access.js";

const envVarSchema = z.object({ name: z.string(), value: z.string() });

// Inlined from the deleted configure-agent-schema: set fields are sorted
// arrays so React Hook Form's structural dirty check matches on content.
const settingsSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  assignedAppIds: z.array(z.string()),
  envVars: z
    .array(envVarSchema)
    .refine(allEnvVarsValid, "All env vars need a name and a value"),
  hibernationTimeoutMin: z
    .number({ message: "Enter a number of minutes (0 = never)" })
    .int()
    .nonnegative(),
});
type SettingsValues = z.infer<typeof settingsSchema>;

export type SandboxSettingsStatus =
  | "no-agent"
  | "loading"
  | "not-found"
  | "ready";

export function useSandboxSettingsForm() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);
  const showConfirm = useStore((s) => s.showConfirm);

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

  const updateAgent = useUpdateAgent();
  const setAgentConnections = useSetAgentConnections();
  const applyPreset = useApplyEgressPreset();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();

  const providerAppIds = useMemo(
    () =>
      new Set(
        apps
          .filter((a) => providerTypeForTemplateId(a.templateId) !== null)
          .map((a) => a.id),
      ),
    [apps],
  );

  const userInitialEnv = useMemo(
    () => (agent?.env ?? []).filter((e) => !isProtectedAgentEnvName(e.name)),
    [agent?.env],
  );

  const { register, control, handleSubmit, watch, setValue, reset, formState } =
    useForm<SettingsValues>({
      resolver: zodResolver(settingsSchema),
      mode: "onChange",
      defaultValues: {
        name: "",
        assignedAppIds: [],
        envVars: [],
        hibernationTimeoutMin: 60,
      },
    });
  const { errors, isDirty, dirtyFields, isSubmitting } = formState;
  const saving = isSubmitting;

  // Network-access edits live outside RHF (none map to a schema field); this
  // subhook stages them and self-resets on sandbox switch. Save commits them
  // alongside the rest; leaving discards.
  const net = useStagedNetworkAccess(agentId);

  const [formReady, setFormReady] = useState(false);
  const baselinedRef = useRef(false);
  useEffect(() => {
    baselinedRef.current = false;
    setFormReady(false);
  }, [agentId]);

  // Adopt the agent's persisted values as the dirty-tracking baseline once the
  // agent + its grants resolve. `reset` makes subsequent toggles read as dirty.
  useEffect(() => {
    if (baselinedRef.current) return;
    // Grants/access refetch on mount; baselining off a stale cache would adopt
    // a since-deleted connection and render it as an unavailable grant.
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

  const selectedProvider = useMemo<ProviderRef | null>(() => {
    const connId = assignedAppIds.find((id) => providerAppIds.has(id));
    return connId ? { id: connId } : null;
  }, [assignedAppIds, providerAppIds]);

  // Selecting a provider swaps it in, clearing any other provider connection so
  // an agent never carries two providers at once.
  const selectProvider = (ref: ProviderRef) => {
    setValue(
      "assignedAppIds",
      [
        ...new Set([
          ...assignedAppIds.filter((id) => !providerAppIds.has(id)),
          ref.id,
        ]),
      ].sort(),
      { shouldDirty: true },
    );
  };
  const dropProviderGrant = (ref: ProviderRef) => {
    setValue(
      "assignedAppIds",
      assignedAppIds.filter((id) => id !== ref.id).sort(),
      { shouldDirty: true },
    );
  };
  const toggleAppGrant = (id: string, on: boolean) =>
    setValue(
      "assignedAppIds",
      on
        ? [...new Set([...assignedAppIds, id])].sort()
        : assignedAppIds.filter((x) => x !== id),
      { shouldDirty: true },
    );

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = (agent?.env ?? [])
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({
        name: e.name,
        value: e.value,
        source: "system" as const,
      }));
    const userEnvNames = new Set(envVars.map((e) => e.name));
    for (const a of apps.filter((a) => appIdsSet.has(a.id))) {
      const envContribs = a.contributions.filter(
        (c): c is Extract<typeof c, { kind: "env" }> => c.kind === "env",
      );
      for (const c of envContribs) {
        if (userEnvNames.has(c.name)) continue;
        items.push({
          name: c.name,
          value: c.placeholder,
          source: { appLabel: a.name },
        });
      }
    }
    return items;
  }, [agent?.env, apps, appIdsSet, envVars]);

  // Connection-grant preview: staged app toggles haven't hit the server, so
  // diff against the baseline to render preview rows for newly-granted
  // connections (and strike through rules whose grant is being revoked).
  // Mirrors what `setAgentConnections` will produce on Save.
  const baselineAppIds = useMemo(
    () =>
      new Set(
        connectionsQuery.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [connectionsQuery.data?.connections],
  );
  const pendingConnectionGrants = useMemo(() => {
    const out: { connectionId: string; host: string; label: string }[] = [];
    for (const id of assignedAppIds) {
      if (baselineAppIds.has(id)) continue;
      const a = apps.find((x) => x.id === id);
      if (!a) continue;
      for (const host of a.hosts)
        out.push({ connectionId: id, host, label: a.name });
    }
    return out;
  }, [assignedAppIds, baselineAppIds, apps]);
  const pendingConnectionRevokes = useMemo(() => {
    const next = new Set<string>();
    for (const id of baselineAppIds) if (!appIdsSet.has(id)) next.add(id);
    return next;
  }, [baselineAppIds, appIdsSet]);
  const connectionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of apps) m.set(a.id, a.name);
    return m;
  }, [apps]);

  const dirty = isDirty || net.dirty;
  const isSubmitDisabled = saving || !formReady || !dirty;

  // Browser-level guard (tab close, refresh, URL nav); `goBack` covers in-app
  // navigation.
  useUnsavedGuard(dirty);

  const egressStaged: StagedNetworkAccessController = {
    preset: net.stagedPreset,
    setPreset: net.setStagedPreset,
    pendingDeletes: net.pendingDeletes,
    togglePendingDelete: net.togglePendingDelete,
    pendingAdds: net.pendingAdds,
    appendPendingAdd: net.appendPendingAdd,
    removePendingAdd: net.removePendingAdd,
    pendingConnectionGrants,
    pendingConnectionRevokes,
    connectionLabels,
  };

  const onSave = handleSubmit(async (values) => {
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
    try {
      if (
        dirtyFields.envVars ||
        dirtyFields.name ||
        dirtyFields.hibernationTimeoutMin
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
        });
      }
      if (net.stagedPreset !== null) {
        await applyPreset.mutateAsync({ agentId, preset: net.stagedPreset });
      }
      if (dirtyFields.assignedAppIds) {
        await setAgentConnections.mutateAsync({
          agentId,
          connectionIds: values.assignedAppIds,
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
      reset({
        name: values.name.trim(),
        assignedAppIds: values.assignedAppIds,
        envVars: values.envVars,
        hibernationTimeoutMin: values.hibernationTimeoutMin,
      });
    } catch {
      // Mutation meta.errorToast surfaces the failure; stay on the page.
    }
  });

  const goBack = () => {
    if (
      dirty &&
      !window.confirm("Discard unsaved changes and leave this sandbox?")
    )
      return;
    setView("list");
  };

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
    goBack,
    register,
    control,
    errors,
    saving,
    selectedProvider,
    selectProvider,
    dropProviderGrant,
    grantedAppIds: appIdsSet,
    toggleAppGrant,
    currentPreset,
    egressStaged,
    inheritedEnvs,
    hibernationTimeoutMin,
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
