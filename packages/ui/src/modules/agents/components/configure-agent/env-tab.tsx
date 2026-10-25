import {
  Add,
  Locked,
  Password,
  RequestQuote,
  View,
  ViewOff,
  WarningAlt,
} from "@carbon/icons-react";
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
import { AddRow, LIST_ROW, ListSection } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { SectionHeading } from "@/components/ui/section-heading";
import { cn } from "@/lib/utils";

import { sanitizeEnvVars } from "../../../../components/env-vars-editor.js";
import {
  type AgentView,
  type EnvVar,
  isValidEnvName,
} from "../../../../types.js";
import { useAppConnections } from "../../../connections/api/queries.js";
import type { SectionHeaderSlot } from "../../../sandboxes/components/sandbox-home-header.js";
import { useGuardedClose } from "../../../sandboxes/hooks/use-guarded-close.js";
import {
  type InheritedEnv,
  useInheritedEnvs,
} from "../../../sandboxes/hooks/use-inherited-envs.js";
import { useUpdateAgent } from "../../api/mutations.js";
import { useAgentConnections } from "../../api/queries.js";

const ENV_NAME_RULE =
  "Use capital letters, digits and _, and don't start with a digit.";

const MASK = "••••••••";

function shadowWarnings(
  inherited: InheritedEnv[],
): { envName: string; shadowedSource: string }[] {
  return inherited.flatMap((i) =>
    i.shadowed && i.source !== "system"
      ? [
          {
            envName: i.name,
            shadowedSource: `the ${i.source.kind} ${i.source.label}`,
          },
        ]
      : [],
  );
}

export function EnvTab({
  agent,
  header,
  panelHeading,
  panelDescription,
  panel = false,
}: {
  agent: AgentView;
  header: SectionHeaderSlot;
  panelHeading?: string;
  panelDescription?: string;
  panel?: boolean;
}) {
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
  const setEnvVars = (next: EnvVar[], onSaved?: () => void) =>
    updateAgent.mutate(
      { id: agent.id, env: sanitizeEnvVars(next) },
      { onSuccess: onSaved },
    );
  const [editing, setEditing] = useState<number | "new" | null>(null);
  const warnings = shadowWarnings(inherited);
  const shownInherited = inherited.filter((e) => !e.shadowed);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const toggleReveal = (name: string) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      if (!next.delete(name)) next.add(name);
      return next;
    });
  return (
    <>
      {header()}
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
                <span className="font-mono">{w.envName}</span> shadows the value
                from {w.shadowedSource}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {panelHeading && (
        <SectionHeading
          label={panelHeading}
          addLabel="Create variable"
          onAdd={() => setEditing("new")}
          description={panelDescription}
        />
      )}
      {panel && !panelHeading && (
        <div className="mb-2 flex items-start gap-2">
          {panelDescription && (
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              {panelDescription}
            </p>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Create variable"
            tooltip="Create variable"
            data-testid="env-var-new-panel"
            disabled={saving}
            onClick={() => setEditing("new")}
          >
            <Add size={16} />
          </Button>
        </div>
      )}

      <ListSection
        isEmpty={
          panel || panelHeading
            ? envVars.length === 0 && shownInherited.length === 0
            : envVars.length === 0
        }
        empty="No variables yet. Create one for configuration the agent reads from its environment."
        onNew={() => setEditing("new")}
        newLabel="Create variable"
        newTestId="env-var-new"
        newDisabled={saving}
        addRow={
          panel || panelHeading ? undefined : (
            <AddRow
              onClick={() => setEditing("new")}
              disabled={saving}
              testId="env-var-new"
              className="text-xs"
            >
              <Add size={14} className="shrink-0" />
              <span className="font-mono font-semibold text-foreground">
                Create variable
              </span>
              <span className="flex-1 truncate text-muted-foreground">
                Name and value the agent reads from its environment.
              </span>
            </AddRow>
          )
        }
      >
        {envVars.map((v, i) => (
          <div key={`${v.name}:${i}`} className={cn(LIST_ROW, "text-xs")}>
            <span className="font-mono font-semibold text-foreground truncate">
              {v.name}
            </span>
            <span className="text-muted-foreground">=</span>
            <span
              className="font-mono text-muted-foreground truncate flex-1"
              title={revealed.has(v.name) ? v.value : undefined}
            >
              {revealed.has(v.name) ? v.value : MASK}
              {!revealed.has(v.name) && (
                <span className="sr-only">Value hidden</span>
              )}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`${revealed.has(v.name) ? "Hide" : "Show"} value of ${v.name}`}
              aria-pressed={revealed.has(v.name)}
              tooltip={revealed.has(v.name) ? "Hide value" : "Show value"}
              onClick={() => toggleReveal(v.name)}
            >
              {revealed.has(v.name) ? (
                <ViewOff size={14} />
              ) : (
                <View size={14} />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Edit ${v.name}`}
              tooltip="Edit"
              disabled={saving}
              onClick={() => setEditing(i)}
            >
              <RequestQuote size={14} />
            </Button>
            <RemoveButton
              label={`Remove ${v.name}`}
              tooltip="Remove"
              onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
              disabled={saving}
            />
          </div>
        ))}
        {/* UNIT_BOUNDARY_DESCRIPTION: in a panel the inherited entries join the manual ones in one list, since they are the same concept — a variable the Agent reads — and only their source differs. */}
        {(panel || panelHeading) &&
          shownInherited.map((e, i) => (
            <InheritedEnvRow key={`${e.name}:${i}`} entry={e} />
          ))}
      </ListSection>

      {!panel && !panelHeading && shownInherited.length > 0 && (
        <ListSection
          label="Inherited"
          description="Set by the platform and by this agent's providers and connections. Read-only."
          isEmpty={false}
          empty={null}
        >
          {shownInherited.map((e, i) => (
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
          pending={saving}
          onSave={(next) =>
            setEnvVars(
              editing === "new"
                ? [...envVars, next]
                : envVars.map((v, idx) => (idx === editing ? next : v)),
              () => setEditing(null),
            )
          }
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
  pending,
}: {
  initial?: EnvVar;
  takenNames: string[];
  onSave: (next: EnvVar) => void;
  pending: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [value, setValue] = useState(initial?.value ?? "");
  const trimmed = name.trim();
  const error =
    trimmed.length === 0
      ? undefined
      : !isValidEnvName(trimmed)
        ? ENV_NAME_RULE
        : takenNames.includes(trimmed)
          ? "A variable with this name already exists."
          : undefined;
  const canSave = trimmed.length > 0 && !error;
  const close = useGuardedClose(
    name !== (initial?.name ?? "") || value !== (initial?.value ?? ""),
    onClose,
  );
  return (
    <Modal onClose={pending ? undefined : () => void close()}>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave && !pending)
            onSave({ name: trimmed, value: value.trim() });
        }}
      >
        <DialogHeader
          onClose={() => void close()}
          title={initial ? "Edit variable" : "New variable"}
        />
        <DialogBody className="flex flex-col gap-4">
          <FormField label="Name" error={error}>
            <Input
              autoFocus={!initial}
              className="font-mono"
              placeholder="ENV_NAME"
              aria-invalid={error ? true : undefined}
              variant={error ? "invalid" : undefined}
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
          onCancel={() => void close()}
          cancelDisabled={pending}
          pending={pending}
          label={initial ? "Save" : "Create variable"}
          pendingLabel="Saving…"
          disabled={!canSave}
          testId="env-var-save"
        />
      </form>
    </Modal>
  );
}

function InheritedEnvRow({ entry }: { entry: InheritedEnv }) {
  const source = entry.source === "system" ? null : entry.source;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-xs">
      <span className="flex min-w-0 items-center gap-3 max-sm:basis-full">
        <span
          className={cn("shrink-0", !source && "text-muted-foreground")}
          title={
            source
              ? `From the ${source.kind} ${source.label}`
              : "Platform-managed"
          }
        >
          {source ? <Password size={12} /> : <Locked size={12} />}
        </span>
        <span className="font-mono font-semibold text-foreground truncate">
          {entry.name}
        </span>
        <span className="text-muted-foreground">=</span>
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-muted-foreground max-sm:pl-6"
        title={entry.value}
      >
        {entry.value}
      </span>
      {source && (
        <span className="max-w-[200px] truncate text-xs text-muted-foreground max-sm:basis-full max-sm:pl-6">
          {source.label}
        </span>
      )}
    </div>
  );
}
