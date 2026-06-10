import { zodResolver } from "@hookform/resolvers/zod";
import {
  type AppConnectionView,
  type EgressPreset,
  isProtectedAgentEnvName,
} from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import { sanitizeEnvVars } from "../../../components/env-vars-editor.js";
import { FormField } from "../../../components/form-field.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import type { AgentView } from "../../../types.js";
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
import {
  AgentEgressEditor,
  type PendingAdd,
} from "../../egress-rules/components/agent-egress-editor.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  useSetAgentAccess,
  useSetAgentConnections,
  useUpdateAgent,
} from "../api/mutations.js";
import { useAgentAccess, useAgentConnections } from "../api/queries.js";
import {
  EnvTab,
  type InheritedEnv,
} from "../components/configure-agent/env-tab.js";
import { TabButton } from "../components/configure-agent/tab-button.js";
import {
  configureAgentSchema,
  type ConfigureAgentValues,
} from "../forms/configure-agent-schema.js";

type Tab = "connections" | "env" | "egress";

export function ConfigureAgentDialog({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const agentId = agent.id;
  const userInitialEnv = useMemo(
    () => (agent.env ?? []).filter((e) => !isProtectedAgentEnvName(e.name)),
    [agent.env],
  );

  const { data: secrets = [] } = useSecrets();
  const { data: apps = [] } = useAppConnections();
  const accessQuery = useAgentAccess(agentId);
  const connectionsQuery = useAgentConnections(agentId);
  const { data: egressRules = [] } = useEgressRulesForAgent(agentId);
  const { data: currentPreset = null } = useCurrentPreset(agentId);

  const networkTabVisible = true;

  const updateAgent = useUpdateAgent();
  const setAccess = useSetAgentAccess();
  const setConnections = useSetAgentConnections();
  const createRule = useCreateEgressRule();
  const revokeRule = useRevokeEgressRule();
  const applyPreset = useApplyEgressPreset();

  const [tab, setTab] = useState<Tab>("connections");
  // Network access edits, all staged. Save commits the bundle alongside
  // the rest of the form; closing discards. Tracked outside RHF since
  // none of these correspond to schema fields.
  const [stagedPreset, setStagedPreset] = useState<EgressPreset | null>(null);
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [pendingAdds, setPendingAdds] = useState<readonly PendingAdd[]>([]);

  const {
    register,
    control,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    formState,
  } = useForm<ConfigureAgentValues>({
    resolver: zodResolver(configureAgentSchema),
    mode: "onChange",
    defaultValues: {
      name: agent.name,
      description: agent.description ?? "",
      assigned: [],
      assignedAppIds: [],
      envVars: userInitialEnv,
    },
  });
  const { errors, isDirty, dirtyFields, isSubmitting } = formState;
  const saving = isSubmitting;

  // Baseline once the initial fetches resolve. `reset` adopts the new values
  // as the dirty-tracking baseline, so subsequent toggles show up as dirty.
  const baselinedRef = useRef(false);
  useEffect(() => {
    if (baselinedRef.current) return;
    if (!accessQuery.data || !connectionsQuery.data) return;
    baselinedRef.current = true;
    reset({
      name: agent.name,
      description: agent.description ?? "",
      assigned: [...accessQuery.data.secretIds].sort(),
      assignedAppIds: connectionsQuery.data.connections
        .map((c) => c.connectionId)
        .sort(),
      envVars: userInitialEnv,
    });
  }, [
    accessQuery.data,
    connectionsQuery.data,
    userInitialEnv,
    agent.name,
    agent.description,
    reset,
  ]);
  const ready = baselinedRef.current;

  // ADR-040: grant toggles no longer mutate `envVars`. The controller merges
  // contributed envs from granted secrets/apps at pod-render time using the
  // K8s Secret's `env-mappings` annotation as the source of truth. The user
  // env list stays clean — only entries the user typed live there.
  const toggleSecret = (id: string) => {
    const current = getValues("assigned");
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id].sort();
    setValue("assigned", next, { shouldDirty: true, shouldValidate: true });
  };
  const toggleApp = (id: string) => {
    const current = getValues("assignedAppIds");
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id].sort();
    setValue("assignedAppIds", next, { shouldDirty: true });
  };

  const assigned = watch("assigned");
  const assignedAppIds = watch("assignedAppIds");
  const envVars = watch("envVars");
  const assignedSet = useMemo(() => new Set(assigned), [assigned]);
  const appIdsSet = useMemo(() => new Set(assignedAppIds), [assignedAppIds]);

  const oauthAppEntries: OAuthAppEntry[] = [];

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = (agent.env ?? [])
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({
        name: e.name,
        value: e.value,
        source: "system" as const,
      }));

    for (const s of secrets.filter((s) => assignedSet.has(s.id))) {
      for (const m of s.envMappings ?? []) {
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { secretName: s.name },
        });
      }
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
  }, [agent.env, secrets, assignedSet, apps, appIdsSet, envVars]);

  // Connection-grant preview: secret + app-connection toggles in this
  // dialog haven't hit the server yet. Compute the diff against both
  // baselines so the editor can render preview rows for newly-granted
  // sources (secrets emit one row, app connections emit one row per host
  // in their declared `egressHosts` registry) and strike through rules
  // whose grant has been revoked. Mirrors what `setAgentAccess` and
  // `setAgentConnections` will produce on Save.
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
    type Grant = { connectionId: string; host: string; label: string };
    const out: Grant[] = [];
    // Secrets: one rule per secret (single host).
    for (const id of assigned) {
      if (baselineSecretIds.has(id)) continue;
      const s = secrets.find((x) => x.id === id);
      if (!s) continue;
      out.push({ connectionId: id, host: s.hostPattern, label: s.name });
    }
    // App connections: one rule per declared egress host. Apps without
    // declared hosts produce no preview rows (and no server rules).
    for (const id of assignedAppIds) {
      if (baselineAppIds.has(id)) continue;
      const a = apps.find((x) => x.id === id);
      if (!a) continue;
      for (const host of a.hosts) {
        out.push({ connectionId: id, host, label: a.name });
      }
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

  // RHF's isDirty doesn't see our staged network-access edits, so combine
  // here. Any staged preset, pending delete, or pending add lights Save.
  const networkAccessDirty =
    stagedPreset !== null || pendingDeletes.size > 0 || pendingAdds.length > 0;
  const dirty = isDirty || networkAccessDirty;

  const togglePendingDelete = (id: string) => {
    setPendingDeletes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const appendPendingAdd = (draft: Omit<PendingAdd, "tempId">) => {
    setPendingAdds((prev) => [
      ...prev,
      { ...draft, tempId: crypto.randomUUID() },
    ]);
  };
  const removePendingAdd = (tempId: string) => {
    setPendingAdds((prev) => prev.filter((a) => a.tempId !== tempId));
  };

  const onSubmit = handleSubmit(async (values) => {
    if (!dirty) {
      onClose();
      return;
    }
    try {
      if (dirtyFields.assigned) {
        await setAccess.mutateAsync({
          agentId: agentId,
          secretIds: values.assigned,
        });
      }
      const wantsAgentUpdate =
        Boolean(dirtyFields.envVars) ||
        Boolean(dirtyFields.name) ||
        Boolean(dirtyFields.description);
      if (wantsAgentUpdate) {
        await updateAgent.mutateAsync({
          id: agentId,
          ...(dirtyFields.envVars
            ? { env: sanitizeEnvVars(values.envVars) }
            : {}),
          ...(dirtyFields.name ? { name: values.name.trim() } : {}),
          ...(dirtyFields.description
            ? { description: values.description.trim() }
            : {}),
        });
      }
      // Preset switch is its own mutation. The server sweeps preset:* rows
      // and inserts the new preset's rows; manual / connection-derived rows
      // are untouched.
      if (stagedPreset !== null) {
        await applyPreset.mutateAsync({ agentId, preset: stagedPreset });
      }
      if (dirtyFields.assignedAppIds) {
        await setConnections.mutateAsync({
          agentId: agentId,
          connectionIds: values.assignedAppIds,
        });
      }
      // Network access bundle: preset apply first (sweeps preset:* server-
      // side), then deletes, then adds. Any path-specific add forces a
      // pod roll; warn once for the whole bundle. The wildcard-host
      // ("allow everything") case is signaled inline next to Save instead
      // of as a confirm popup — the warning is always visible while the
      // rule is in scope, so a second click-through is just friction.
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
      // Preset already committed via applyPreset above. Now apply
      // user-driven deletes / adds — these survive a preset reseed because
      // the seeder only touches preset:* rows.
      for (const id of pendingDeletes) {
        await revokeRule.mutateAsync({ id });
      }
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
      onClose();
    } catch {
      // Mutation meta.errorToast surfaces the failure; dialog stays open.
    }
  });

  const connectionsCount = assigned.length + assignedAppIds.length;
  const envCount = sanitizeEnvVars(envVars).length + inheritedEnvs.length;
  const isSubmitDisabled = saving || !ready || !dirty;

  // Inline warning replacing the old "Allow everything" confirm popup.
  // Triggers when the effective rule set after Save would contain a
  // host = '*' rule: a saved wildcard not staged for delete, a pending
  // add with host '*', or the "all" preset selected (saved or staged).
  const stagedHasWildcardAdd = pendingAdds.some((a) => a.host.trim() === "*");
  const savedWildcardActive = egressRules.some(
    (r) => r.host === "*" && !pendingDeletes.has(r.id),
  );
  const effectivePreset = stagedPreset ?? currentPreset;
  const effectivePresetIsAll = effectivePreset === "all";
  const wildcardHostInScope =
    stagedHasWildcardAdd || savedWildcardActive || effectivePresetIsAll;

  return (
    <Modal widthClass="w-[640px]">
      <form onSubmit={onSubmit} className="contents">
        <DialogHeader className="flex flex-col gap-3">
          <div>
            <h2 className="text-[20px] font-bold text-text">Configure Agent</h2>
            <p className="text-[12px] text-text-muted mt-1">
              {agent.templateId ? (
                <>
                  Template:{" "}
                  <Tooltip
                    side="right"
                    content={<span className="font-mono">{agent.image}</span>}
                  >
                    <span className="font-semibold text-text-secondary border-b border-dotted border-text-muted cursor-help">
                      {agent.templateId}
                    </span>
                  </Tooltip>
                </>
              ) : (
                <>
                  Image:{" "}
                  <span className="font-mono text-text-secondary break-all">
                    {agent.image}
                  </span>
                </>
              )}
            </p>
          </div>
          <FormField label="Name" error={errors.name?.message}>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
              disabled={saving}
              {...register("name")}
            />
          </FormField>
          <FormField label="Description" error={errors.description?.message}>
            <input
              className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
              placeholder="Optional"
              disabled={saving}
              {...register("description")}
            />
          </FormField>
        </DialogHeader>

        <div className="px-5 md:px-7 pt-4 flex items-center gap-1 border-b-2 border-border-light">
          <TabButton
            active={tab === "connections"}
            label="Connections"
            count={connectionsCount}
            onClick={() => setTab("connections")}
          />
          <TabButton
            active={tab === "env"}
            label="Environment"
            count={envCount}
            onClick={() => setTab("env")}
          />
          {networkTabVisible && (
            <TabButton
              active={tab === "egress"}
              label="Network access"
              count={
                egressRules.length - pendingDeletes.size + pendingAdds.length
              }
              onClick={() => setTab("egress")}
            />
          )}
        </div>

        <DialogBody className="flex flex-col gap-4">
          {tab === "connections" && (
            <ConnectionsPicker
              loading={!ready}
              secrets={secrets}
              apps={apps as unknown as AppConnectionView[]}
              oauthApps={oauthAppEntries}
              selSecrets={assignedSet}
              selApps={appIdsSet}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
            />
          )}
          {tab === "env" && (
            <Controller
              control={control}
              name="envVars"
              render={({ field }) => (
                <EnvTab
                  inherited={inheritedEnvs}
                  envVars={field.value}
                  setEnvVars={field.onChange}
                  saving={saving}
                />
              )}
            />
          )}
          {tab === "egress" && networkTabVisible && (
            <AgentEgressEditor
              agentId={agentId}
              currentPreset={currentPreset}
              staged={{
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
              }}
            />
          )}
        </DialogBody>

        <DialogFooter>
          {wildcardHostInScope && (
            <span
              role="alert"
              className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-warning"
              title="A wildcard host '*' rule is in scope. Any unmatched egress is allowed."
            >
              <span aria-hidden="true">⚠</span>
              Allow everything is on — narrow with deny rules or remove the
              wildcard.
            </span>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitDisabled}
            title={!isDirty ? "Nothing to save" : undefined}
          >
            {saving ? "..." : "Save"}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
