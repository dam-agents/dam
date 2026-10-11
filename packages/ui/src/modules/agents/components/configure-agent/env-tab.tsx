import { Edit, Locked, Password, WarningAlt } from "@carbon/icons-react";
import { isProtectedAgentEnvName } from "api-server-api";
import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { LIST_ROW, ListSection } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { sanitizeEnvVars } from "../../../../components/env-vars-editor.js";
import {
  type AgentView,
  type EnvVar,
  isValidEnvName,
} from "../../../../types.js";
import { useAppConnections } from "../../../connections/api/queries.js";
import { useInheritedEnvs } from "../../../sandboxes/hooks/use-inherited-envs.js";
import { useUpdateAgent } from "../../api/mutations.js";
import { useAgentConnections } from "../../api/queries.js";

export interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string } | { appLabel: string };
}

function shadowWarnings(
  envVars: EnvVar[],
  inherited: InheritedEnv[],
): { envName: string; shadowedSource: string }[] {
  const sourceLabelByName = new Map<string, string>();
  for (const i of inherited) {
    if (i.source === "system") continue;
    sourceLabelByName.set(
      i.name,
      "secretName" in i.source
        ? `secret "${i.source.secretName}"`
        : `connection "${i.source.appLabel}"`,
    );
  }
  return envVars.flatMap((e) => {
    const shadowedSource = sourceLabelByName.get(e.name);
    return shadowedSource ? [{ envName: e.name, shadowedSource }] : [];
  });
}

export function EnvTab({ agent }: { agent: AgentView }) {
  const updateAgent = useUpdateAgent();
  const { data: apps = [] } = useAppConnections();
  const { data: agentConnections } = useAgentConnections(agent.id);
  const pendingEnv = updateAgent.isPending
    ? updateAgent.variables.env
    : undefined;
  const envVars = useMemo(
    () =>
      (pendingEnv ?? agent.env ?? []).filter(
        (e) => !isProtectedAgentEnvName(e.name),
      ),
    [pendingEnv, agent.env],
  );
  const inherited = useInheritedEnvs({
    agentEnv: agent.env ?? [],
    apps,
    appIdsSet: useMemo(
      () => new Set(agentConnections?.connections.map((c) => c.connectionId)),
      [agentConnections],
    ),
    envVars,
  });
  const saving = updateAgent.isPending;
  const setEnvVars = (next: EnvVar[]) =>
    updateAgent.mutate({ id: agent.id, env: sanitizeEnvVars(next) });
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const warnings = shadowWarnings(envVars, inherited);
  return (
    <>
      {warnings.length > 0 && (
        <Callout
          tone="warning"
          size="sm"
          className="mb-4 flex flex-col gap-1 text-xs"
        >
          <div className="flex items-center gap-2 text-warning">
            <WarningAlt size={12} />
            <span className="font-semibold">Shadowing inherited values</span>
          </div>
          <ul className="list-disc pl-5 text-muted-foreground">
            {warnings.map((w) => (
              <li key={w.envName}>
                <span className="font-mono">{w.envName}</span> shadows{" "}
                {w.shadowedSource}'s contribution
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <ListSection
        onNew={() => setEditing("new")}
        newDisabled={saving}
        newTestId="env-var-new"
        isEmpty={envVars.length === 0}
        empty="No variables yet."
      >
        {envVars.map((v, i) => (
          <div key={`${v.name}:${i}`} className={cn(LIST_ROW, "text-xs")}>
            <span className="font-mono font-semibold text-foreground truncate">
              {v.name}
            </span>
            <span className="text-muted-foreground">=</span>
            <span
              className="font-mono text-muted-foreground truncate flex-1"
              title={v.value}
            >
              {v.value}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${v.name}`}
              tooltip="Edit"
              disabled={saving}
              onClick={() => setEditing(i)}
            >
              <Edit size={14} />
            </Button>
            <RemoveButton
              label={`Remove ${v.name}`}
              onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
              disabled={saving}
            />
          </div>
        ))}
      </ListSection>

      {inherited.length > 0 && (
        <ListSection
          label="Inherited"
          description="Set by the platform and by this agent's connections. Read-only."
          isEmpty={false}
          empty={null}
        >
          {inherited.map((e, i) => (
            <InheritedEnvRow key={`${e.name}:${i}`} entry={e} />
          ))}
        </ListSection>
      )}

      {editing !== null && (
        <EnvVarModal
          initial={editing === "new" ? undefined : envVars[editing]}
          takenNames={envVars
            .filter((_, idx) => idx !== editing)
            .map((v) => v.name)}
          onSave={(next) => {
            setEnvVars(
              editing === "new"
                ? [...envVars, next]
                : envVars.map((v, idx) => (idx === editing ? next : v)),
            );
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function EnvVarModal({
  initial,
  takenNames,
  onSave,
  onClose,
}: {
  initial?: EnvVar;
  takenNames: string[];
  onSave: (next: EnvVar) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const trimmed = name.trim();
  const error =
    trimmed.length === 0
      ? undefined
      : !isValidEnvName(trimmed)
        ? "Must match [A-Z_][A-Z0-9_]*"
        : takenNames.includes(trimmed)
          ? "A variable with this name already exists"
          : undefined;
  const canSave = trimmed.length > 0 && !error;
  return (
    <Modal onClose={onClose}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) onSave({ name: trimmed, value: value.trim() });
        }}
      >
        <DialogHeader
          onClose={onClose}
          title={initial ? "Edit variable" : "New variable"}
        />
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Name" error={error}>
            <Input
              autoFocus={!initial}
              className="font-mono"
              placeholder="ENV_NAME"
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
            />
          </FormField>
          <FormField label="Value">
            <Input
              autoFocus={!!initial}
              className="font-mono"
              placeholder="value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </FormField>
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          label={initial ? "Save" : "Add variable"}
          pendingLabel="Saving…"
          disabled={!canSave}
          testId="env-var-save"
        />
      </form>
    </Modal>
  );
}

function InheritedEnvRow({ entry }: { entry: InheritedEnv }) {
  const isSystem = entry.source === "system";
  const sourceName =
    entry.source === "system"
      ? null
      : "secretName" in entry.source
        ? entry.source.secretName
        : entry.source.appLabel;
  return (
    <div className={cn(LIST_ROW, "text-xs")}>
      <span
        className={cn("shrink-0", isSystem && "text-muted-foreground")}
        title={isSystem ? "Platform-managed" : `From connection: ${sourceName}`}
      >
        {isSystem ? <Locked size={12} /> : <Password size={12} />}
      </span>
      <span className="font-mono font-semibold text-foreground truncate">
        {entry.name}
      </span>
      <span className="text-muted-foreground">=</span>
      <span
        className="font-mono text-muted-foreground truncate flex-1"
        title={entry.value}
      >
        {entry.value}
      </span>
      {!isSystem && (
        <span className="text-xs text-muted-foreground truncate max-w-[160px]">
          {sourceName}
        </span>
      )}
    </div>
  );
}
