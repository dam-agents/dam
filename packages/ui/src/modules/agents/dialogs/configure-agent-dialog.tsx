import { zodResolver } from "@hookform/resolvers/zod";
import { type EgressPreset, isProtectedAgentEnvName } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import { sanitizeEnvVars } from "../../../components/env-vars-editor.js";
import { FormField } from "../../../components/form-field.js";
import type { AgentView } from "../../../types.js";
import { APP_OAUTH_SECRET_PREFIX } from "../../../types.js";
import {
  useAppConnections,
  useOAuthAppConnections,
} from "../../connections/api/queries.js";
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
import { EnvTab, type InheritedEnv } from "../components/configure-agent/env-tab.js";
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
  const { data: oauthAppConnections = [] } = useOAuthAppConnections();
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
  const [pendingDeletes, setPendingDeletes] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingAdds, setPendingAdds] = useState<readonly PendingAdd[]>([]);

  const { register, control, handleSubmit, watch, getValues, setValue, reset, formState } =
    useForm<ConfigureAgentValues>({
      resolver: zodResolver(configureAgentSchema),
      mode: "onChange",
      defaultValues: {
        name: agent.name,
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
      assigned: [...accessQuery.data.secretIds].sort(),
      assignedAppIds: [...connectionsQuery.data.connectionIds].sort(),
      envVars: userInitialEnv,
    });
  }, [accessQuery.data, connectionsQuery.data, userInitialEnv, agent.name, reset]);
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

  // Join the api-server-driven OAuth app connections with their K8s
  // credential Secrets so the picker can render them in the "Apps"
  // subsection while grants flow through the secret-access mechanism.
  const oauthAppEntries = useMemo<OAuthAppEntry[]>(() => {
    const secretByName = new Map(secrets.map((s) => [s.name, s]));
    return oauthAppConnections.flatMap((conn) => {
      const mirror = secretByName.get(`${APP_OAUTH_SECRET_PREFIX}${conn.connectionId}`);
      if (!mirror) return [];
      return [{
        secretId: mirror.id,
        appId: conn.appId,
        displayName: conn.displayName,
        hostPattern: conn.hostPattern,
        expired: conn.expired,
      }];
    });
  }, [oauthAppConnections, secrets]);

  const inheritedEnvs = useMemo<InheritedEnv[]>(() => {
    const items: InheritedEnv[] = (agent.env ?? [])
      .filter((e) => isProtectedAgentEnvName(e.name))
      .map((e) => ({ name: e.name, value: e.value, source: "system" as const }));

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
      for (const m of a.envMappings ?? []) {
        if (userEnvNames.has(m.envName)) continue;
        items.push({
          name: m.envName,
          value: m.placeholder,
          source: { appLabel: a.label },
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
    () => new Set(connectionsQuery.data?.connectionIds ?? []),
    [connectionsQuery.data?.connectionIds],
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
      for (const host of a.egressHosts ?? []) {
        out.push({ connectionId: id, host, label: a.label });
      }
    }
    return out;
  }, [assigned, assignedAppIds, baselineSecretIds, baselineAppIds, secrets, apps]);
  const pendingConnectionRevokes = useMemo(() => {
    const next = new Set<string>();
    for (const id of baselineSecretIds) if (!assignedSet.has(id)) next.add(id);
    for (const id of baselineAppIds) if (!appIdsSet.has(id)) next.add(id);
    return next;
  }, [baselineSecretIds, baselineAppIds, assignedSet, appIdsSet]);
  const connectionLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of secrets) m.set(s.id, s.name);
    for (const a of apps) m.set(a.id, a.label);
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const appendPendingAdd = (draft: Omit<PendingAdd, "tempId">) => {
    setPendingAdds((prev) => [...prev, { ...draft, tempId: crypto.randomUUID() }]);
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
      const wantsAgentUpdate = Boolean(dirtyFields.envVars) || Boolean(dirtyFields.name);
      if (wantsAgentUpdate) {
        await updateAgent.mutateAsync({
          id: agentId,
          ...(dirtyFields.envVars ? { env: sanitizeEnvVars(values.envVars) } : {}),
          ...(dirtyFields.name ? { name: values.name.trim() } : {}),
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
        restartingHosts.length > 0
        && !window.confirm(
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
  const wildcardHostInScope = stagedHasWildcardAdd || savedWildcardActive || effectivePresetIsAll;

  const egressTabCount = egressRules.length - pendingDeletes.size + pendingAdds.length;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="w-[640px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-hidden sm:max-w-[640px] flex flex-col gap-0 p-0">
        <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="px-7 pt-7 pb-4 border-b border-border flex flex-col gap-3">
            <DialogHeader>
              <DialogTitle>Configure Agent</DialogTitle>
              <p className="text-[12px] text-muted-foreground mt-1">
                {agent.templateId ? (
                  <>
                    Template:{" "}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-semibold text-foreground/80 border-b border-dotted border-muted-foreground cursor-help">
                          {agent.templateId}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <span className="font-mono">{agent.image}</span>
                      </TooltipContent>
                    </Tooltip>
                  </>
                ) : (
                  <>
                    Image:{" "}
                    <span className="font-mono text-foreground/80 break-all">
                      {agent.image}
                    </span>
                  </>
                )}
              </p>
            </DialogHeader>
            <FormField label="Name" error={errors.name?.message}>
              <Input disabled={saving} {...register("name")} />
            </FormField>
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as Tab)}
            className="flex-1 flex flex-col min-h-0"
          >
            <div className="px-7 pt-4 border-b border-border">
              <TabsList className="h-auto bg-transparent p-0 gap-1 rounded-none">
                <TabsTrigger
                  value="connections"
                  className="h-10 px-4 gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none -mb-[1px]"
                >
                  Connections
                  {connectionsCount > 0 && (
                    <Badge
                      variant={tab === "connections" ? "default" : "secondary"}
                      className="px-1.5 py-0.5 text-[10px] min-w-[18px] justify-center"
                    >
                      {connectionsCount}
                    </Badge>
                  )}
                </TabsTrigger>
                <TabsTrigger
                  value="env"
                  className="h-10 px-4 gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none -mb-[1px]"
                >
                  Environment
                  {envCount > 0 && (
                    <Badge
                      variant={tab === "env" ? "default" : "secondary"}
                      className="px-1.5 py-0.5 text-[10px] min-w-[18px] justify-center"
                    >
                      {envCount}
                    </Badge>
                  )}
                </TabsTrigger>
                {networkTabVisible && (
                  <TabsTrigger
                    value="egress"
                    className="h-10 px-4 gap-2 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none -mb-[1px]"
                  >
                    Network access
                    {egressTabCount > 0 && (
                      <Badge
                        variant={tab === "egress" ? "default" : "secondary"}
                        className="px-1.5 py-0.5 text-[10px] min-w-[18px] justify-center"
                      >
                        {egressTabCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto">
              <TabsContent value="connections" className="px-7 py-5 flex flex-col gap-4 mt-0">
                <ConnectionsPicker
                  loading={!ready}
                  secrets={secrets}
                  apps={apps}
                  oauthApps={oauthAppEntries}
                  selSecrets={assignedSet}
                  selApps={appIdsSet}
                  onToggleSecret={toggleSecret}
                  onToggleApp={toggleApp}
                />
              </TabsContent>
              <TabsContent value="env" className="px-7 py-5 flex flex-col gap-4 mt-0">
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
              </TabsContent>
              {networkTabVisible && (
                <TabsContent value="egress" className="px-7 py-5 flex flex-col gap-4 mt-0">
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
                </TabsContent>
              )}
            </div>
          </Tabs>

          <div className="px-7 py-4 border-t border-border flex items-center justify-end gap-3">
            {wildcardHostInScope && (
              <span
                role="alert"
                className="mr-auto inline-flex items-center gap-1.5 text-[12px] text-warning"
                title="A wildcard host '*' rule is in scope. Any unmatched egress is allowed."
              >
                <span aria-hidden="true">⚠</span>
                Allow everything is on — narrow with deny rules or remove the wildcard.
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
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
