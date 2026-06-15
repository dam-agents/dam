import { zodResolver } from "@hookform/resolvers/zod";
import { type EgressPreset, isProtectedAgentEnvName } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import {
  allEnvVarsValid,
  sanitizeEnvVars,
} from "../../../components/env-vars-editor.js";
import { useStore } from "../../../store.js";
import { isProviderPresetType, type SecretView } from "../../../types.js";
import {
  useSetAgentAccess,
  useSetAgentConnections,
  useUpdateAgent,
} from "../../agents/api/mutations.js";
import {
  useAgentAccess,
  useAgentConnections,
  useAgents,
} from "../../agents/api/queries.js";
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
import type {
  PendingAdd,
  StagedNetworkAccessController,
} from "../../egress-rules/components/agent-egress-editor.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

const EMPTY_SECRETS: SecretView[] = [];

const envVarSchema = z.object({ name: z.string(), value: z.string() });

// Inlined from the deleted configure-agent-schema: set fields are sorted
// arrays so React Hook Form's structural dirty check matches on content.
const settingsSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  assigned: z.array(z.string()),
  assignedAppIds: z.array(z.string()),
  envVars: z
    .array(envVarSchema)
    .refine(allEnvVarsValid, "All env vars need a name and a value"),
});
type SettingsValues = z.infer<typeof settingsSchema>;

export type SandboxSettingsStatus =
  | "no-agent"
  | "loading"
  | "not-found"
  | "ready";

/**
 * Owns all the non-visual logic of the sandbox settings page: the staged RHF
 * form, the provider-secret swap, connection-grant toggles, the staged
 * network-access controller, the grant-derived previews the network and
 * environment sections consume, and the ordered Save. The view binds the
 * returned values to JSX. Extracting the shared connection-state pieces across
 * the wizard and this page is deferred to #896.
 */
export function useSandboxSettingsForm() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);

  const agentsQuery = useAgents();
  const agent = useMemo(
    () =>
      agentId
        ? (agentsQuery.data?.list.find((a) => a.id === agentId) ?? null)
        : null,
    [agentsQuery.data, agentId],
  );

  const secretsQuery = useSecrets();
  const secrets = secretsQuery.data ?? EMPTY_SECRETS;
  const { data: apps = [] } = useAppConnections();
  const { data: templates = [] } = useTemplates();
  const accessQuery = useAgentAccess(agentId);
  const connectionsQuery = useAgentConnections(agentId);
  const { data: egressRules = [] } = useEgressRulesForAgent(agentId);
  const { data: currentPreset = null } = useCurrentPreset(agentId);

  const updateAgent = useUpdateAgent();
  const setAgentAccess = useSetAgentAccess();
  const setAgentConnections = useSetAgentConnections();
  const applyPreset = useApplyEgressPreset();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();

  const providerSecretIds = useMemo(
    () =>
      new Set(
        secrets.filter((s) => isProviderPresetType(s.type)).map((s) => s.id),
      ),
    [secrets],
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
        assigned: [],
        assignedAppIds: [],
        envVars: [],
      },
    });
  const { errors, isDirty, dirtyFields, isSubmitting } = formState;
  const saving = isSubmitting;

  // Network-access edits live outside RHF (none map to a schema field). Save
  // commits them alongside the rest; leaving discards.
  const [stagedPreset, setStagedPreset] = useState<EgressPreset | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingAdds, setPendingAdds] = useState<readonly PendingAdd[]>([]);

  const [formReady, setFormReady] = useState(false);
  const baselinedRef = useRef(false);
  useEffect(() => {
    baselinedRef.current = false;
    setFormReady(false);
    setStagedPreset(null);
    setPendingDeletes(new Set());
    setPendingAdds([]);
  }, [agentId]);

  // Adopt the agent's persisted values as the dirty-tracking baseline once the
  // agent + its grants resolve. `reset` makes subsequent toggles read as dirty.
  useEffect(() => {
    if (baselinedRef.current) return;
    if (!agent || !accessQuery.data || !connectionsQuery.data) return;
    baselinedRef.current = true;
    reset({
      name: agent.name,
      assigned: [...accessQuery.data.secretIds].sort(),
      assignedAppIds: connectionsQuery.data.connections
        .map((c) => c.connectionId)
        .sort(),
      envVars: userInitialEnv,
    });
    setFormReady(true);
  }, [agent, accessQuery.data, connectionsQuery.data, userInitialEnv, reset]);

  const assigned = watch("assigned");
  const assignedAppIds = watch("assignedAppIds");
  const envVars = watch("envVars");
  const assignedSet = useMemo(() => new Set(assigned), [assigned]);
  const appIdsSet = useMemo(() => new Set(assignedAppIds), [assignedAppIds]);

  const selectedProviderSecretId = useMemo(
    () => assigned.find((id) => providerSecretIds.has(id)) ?? null,
    [assigned, providerSecretIds],
  );

  // Provider selection swaps the provider-type secret in `assigned`, leaving
  // every other grant intact.
  const selectProvider = (secretId: string) =>
    setValue(
      "assigned",
      [...assigned.filter((id) => !providerSecretIds.has(id)), secretId].sort(),
      { shouldDirty: true, shouldValidate: true },
    );
  const dropProviderGrant = (secretId: string) =>
    setValue("assigned", assigned.filter((id) => id !== secretId).sort(), {
      shouldDirty: true,
    });
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
    for (const s of secrets.filter((s) => assignedSet.has(s.id))) {
      for (const m of s.envMappings ?? [])
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { secretName: s.name },
        });
    }
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
  }, [agent?.env, secrets, assignedSet, apps, appIdsSet, envVars]);

  // Connection-grant preview: staged secret/app toggles haven't hit the server,
  // so diff against both baselines to render preview rows for newly-granted
  // sources (and strike through rules whose grant is being revoked). Mirrors
  // what `setAgentAccess` / `setAgentConnections` will produce on Save.
  const baselineSecretIds = useMemo(
    () => new Set(accessQuery.data?.secretIds ?? []),
    [accessQuery.data?.secretIds],
  );
  const baselineAppIds = useMemo(
    () =>
      new Set(
        connectionsQuery.data?.connections.map((c) => c.connectionId) ?? [],
      ),
    [connectionsQuery.data?.connections],
  );
  const pendingConnectionGrants = useMemo(() => {
    const out: { connectionId: string; host: string; label: string }[] = [];
    for (const id of assigned) {
      if (baselineSecretIds.has(id)) continue;
      const s = secrets.find((x) => x.id === id);
      if (s) out.push({ connectionId: id, host: s.hostPattern, label: s.name });
    }
    for (const id of assignedAppIds) {
      if (baselineAppIds.has(id)) continue;
      const a = apps.find((x) => x.id === id);
      if (!a) continue;
      for (const host of a.hosts)
        out.push({ connectionId: id, host, label: a.name });
    }
    return out;
  }, [
    assigned,
    assignedAppIds,
    baselineSecretIds,
    baselineAppIds,
    secrets,
    apps,
  ]);
  const pendingConnectionRevokes = useMemo(() => {
    const next = new Set<string>();
    for (const id of baselineSecretIds) if (!assignedSet.has(id)) next.add(id);
    for (const id of baselineAppIds) if (!appIdsSet.has(id)) next.add(id);
    return next;
  }, [baselineSecretIds, baselineAppIds, assignedSet, appIdsSet]);
  const connectionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of secrets) m.set(s.id, s.name);
    for (const a of apps) m.set(a.id, a.name);
    return m;
  }, [secrets, apps]);

  const networkAccessDirty =
    stagedPreset !== null || pendingDeletes.size > 0 || pendingAdds.length > 0;
  const dirty = isDirty || networkAccessDirty;
  const isSubmitDisabled = saving || !formReady || !dirty;

  const togglePendingDelete = (id: string) =>
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const appendPendingAdd = (draft: Omit<PendingAdd, "tempId">) =>
    setPendingAdds((prev) => [
      ...prev,
      { ...draft, tempId: crypto.randomUUID() },
    ]);
  const removePendingAdd = (tempId: string) =>
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));

  const egressStaged: StagedNetworkAccessController = {
    preset: stagedPreset,
    setPreset: setStagedPreset,
    pendingDeletes,
    togglePendingDelete,
    pendingAdds,
    appendPendingAdd,
    removePendingAdd,
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
    const restartingHosts = pendingAdds
      .filter((a) => a.method !== "*" || a.pathPattern !== "*")
      .map((a) => a.host);
    if (
      restartingHosts.length > 0 &&
      !window.confirm(
        `Saving will restart the agent (~5–15s) so Envoy can MITM ${restartingHosts.length === 1 ? `"${restartingHosts[0]}"` : `${restartingHosts.length} hosts`} for path-level enforcement. Continue?`,
      )
    ) {
      return;
    }
    try {
      if (dirtyFields.assigned) {
        await setAgentAccess.mutateAsync({
          agentId,
          secretIds: values.assigned,
        });
      }
      if (dirtyFields.envVars || dirtyFields.name) {
        await updateAgent.mutateAsync({
          id: agentId,
          ...(dirtyFields.envVars
            ? { env: sanitizeEnvVars(values.envVars) }
            : {}),
          ...(dirtyFields.name ? { name: values.name.trim() } : {}),
        });
      }
      if (stagedPreset !== null) {
        await applyPreset.mutateAsync({ agentId, preset: stagedPreset });
      }
      if (dirtyFields.assignedAppIds) {
        await setAgentConnections.mutateAsync({
          agentId,
          connectionIds: values.assignedAppIds,
        });
      }
      for (const id of pendingDeletes) await revokeRule.mutateAsync({ id });
      for (const add of pendingAdds) {
        await createRule.mutateAsync({
          agentId,
          host: add.host,
          method: add.method,
          pathPattern: add.pathPattern,
          verdict: add.verdict,
        });
      }
      setStagedPreset(null);
      setPendingDeletes(new Set());
      setPendingAdds([]);
      reset({
        name: values.name.trim(),
        assigned: values.assigned,
        assignedAppIds: values.assignedAppIds,
        envVars: values.envVars,
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
    selectedProviderSecretId,
    selectProvider,
    dropProviderGrant,
    grantedAppIds: appIdsSet,
    toggleAppGrant,
    currentPreset,
    egressStaged,
    inheritedEnvs,
    dirty,
    isSubmitDisabled,
    wildcardHostInScope:
      pendingAdds.some((a) => a.host.trim() === "*") ||
      egressRules.some((r) => r.host === "*" && !pendingDeletes.has(r.id)) ||
      (stagedPreset ?? currentPreset) === "all",
    onSave,
  };
}
