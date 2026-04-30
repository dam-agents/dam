import { zodResolver } from "@hookform/resolvers/zod";
import { isProtectedAgentEnvName } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { ConnectionsPicker } from "../../../components/connections-picker.js";
import { sanitizeEnvVars } from "../../../components/env-vars-editor.js";
import { FormField } from "../../../components/form-field.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import { Modal } from "../../../components/modal.js";
import type { AgentView } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  useSetAgentAccess,
  useSetAgentConnections,
  useUpdateAgent,
} from "../api/mutations.js";
import { useAgentAccess, useAgentConnections } from "../api/queries.js";
import { EnvTab, type InheritedEnv } from "../components/configure-agent/env-tab.js";
import { TabButton } from "../components/configure-agent/tab-button.js";
import {
  configureAgentSchema,
  type ConfigureAgentValues,
} from "../forms/configure-agent-schema.js";
import {
  envsAfterUngrant,
  envsToAddOnGrant,
} from "../utils/connection-env-helpers.js";

type Tab = "connections" | "env";

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

  const updateAgent = useUpdateAgent();
  const setAccess = useSetAgentAccess();
  const setConnections = useSetAgentConnections();

  const [tab, setTab] = useState<Tab>("connections");

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

  // Granting/ungranting an app writes its declared envMappings into the user
  // env list. This couples assignedAppIds → envVars, so we don't delegate to
  // the picker's render-time toggle — we drive both fields here.
  const toggleSecret = (id: string) => {
    const current = getValues("assigned");
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id].sort();
    setValue("assigned", next, { shouldDirty: true, shouldValidate: true });
  };
  const toggleApp = (id: string) => {
    const current = getValues("assignedAppIds");
    const currentEnv = getValues("envVars");
    const app = apps.find((a) => a.id === id);
    if (current.includes(id)) {
      const next = current.filter((x) => x !== id);
      const remaining = apps.filter((a) => next.includes(a.id));
      setValue("assignedAppIds", next, { shouldDirty: true });
      setValue("envVars", envsAfterUngrant(currentEnv, app, remaining), {
        shouldDirty: true,
      });
    } else {
      const next = [...current, id].sort();
      const toAdd = envsToAddOnGrant(currentEnv, app);
      setValue("assignedAppIds", next, { shouldDirty: true });
      if (toAdd.length > 0) {
        setValue("envVars", [...currentEnv, ...toAdd], { shouldDirty: true });
      }
    }
  };

  const assigned = watch("assigned");
  const assignedAppIds = watch("assignedAppIds");
  const envVars = watch("envVars");
  const assignedSet = useMemo(() => new Set(assigned), [assigned]);
  const appIdsSet = useMemo(() => new Set(assignedAppIds), [assignedAppIds]);

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

  const onSubmit = handleSubmit(async (values) => {
    if (!isDirty) {
      onClose();
      return;
    }
    try {
      if (dirtyFields.assigned) {
        await setAccess.mutateAsync({
          agentId: agentId,
          mode: "selective",
          secretIds: values.assigned,
        });
      }
      if (dirtyFields.envVars || dirtyFields.name) {
        await updateAgent.mutateAsync({
          id: agentId,
          ...(dirtyFields.envVars ? { env: sanitizeEnvVars(values.envVars) } : {}),
          ...(dirtyFields.name ? { name: values.name.trim() } : {}),
        });
      }
      if (dirtyFields.assignedAppIds) {
        await setConnections.mutateAsync({
          agentId: agentId,
          connectionIds: values.assignedAppIds,
        });
      }
      onClose();
    } catch {
      // Mutation meta.errorToast surfaces the failure; dialog stays open.
    }
  });

  const connectionsCount = assigned.length + assignedAppIds.length;
  const envCount = sanitizeEnvVars(envVars).length + inheritedEnvs.length;
  const isSubmitDisabled = saving || !ready || !isDirty; 

  return (
    <Modal widthClass="w-[640px]">
      <form onSubmit={onSubmit} className="contents">
        <div className="px-7 pt-7 pb-4 border-b-2 border-border-light flex flex-col gap-3">
          <div>
            <h2 className="text-[20px] font-bold text-text">Configure Agent</h2>
            <p className="text-[12px] text-text-muted mt-1">
              {agent.templateId ? (
                <>
                  Template:{" "}
                  <HoverTooltip
                    placement="right"
                    trigger={
                      <span className="font-semibold text-text-secondary border-b border-dotted border-text-muted cursor-help">
                        {agent.templateId}
                      </span>
                    }
                  >
                    <span className="font-mono">{agent.image}</span>
                  </HoverTooltip>
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
        </div>

        <div className="px-7 pt-4 flex items-center gap-1 border-b-2 border-border-light">
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
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-4">
          {tab === "connections" ? (
            <ConnectionsPicker
              loading={!ready}
              secrets={secrets}
              apps={apps}
              selSecrets={assignedSet}
              selApps={appIdsSet}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
            />
          ) : (
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
        </div>

        <div className="px-7 py-4 border-t-2 border-border-light flex justify-end gap-3">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            disabled={isSubmitDisabled}
            title={!isDirty ? "Nothing to save" : undefined}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
