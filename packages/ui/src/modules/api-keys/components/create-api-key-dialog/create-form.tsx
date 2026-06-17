import { AGENT_SCOPES, CREDENTIAL_SCOPES, type Scope } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
} from "../../../../components/modal.js";
import { useCreateApiKey } from "../../api/mutations.js";
import { AgentBindingField, type BindingMode } from "./agent-binding-field.js";

const SCOPE_GROUPS: { label: string; scopes: readonly Scope[] }[] = [
  { label: "Agents", scopes: AGENT_SCOPES },
  { label: "Credentials", scopes: CREDENTIAL_SCOPES },
];

const hasAgentScope = (scopes: Set<Scope>): boolean =>
  AGENT_SCOPES.some((s) => scopes.has(s));

interface Props {
  onCreated: (plaintext: string) => void;
  onCancel: () => void;
}

export function CreateApiKeyForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<Set<Scope>>(
    new Set<Scope>(["agents:operate"]),
  );
  const [bindingMode, setBindingMode] = useState<BindingMode>("all");
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(
    new Set<string>(),
  );
  const createApiKey = useCreateApiKey();

  // `agents:manage` is wildcard-bound by design; selecting it forces the key to
  // cover all agents regardless of the picker.
  const manageSelected = selectedScopes.has("agents:manage");
  const showBinding = hasAgentScope(selectedScopes);

  function toggleScope(scope: Scope) {
    const next = new Set(selectedScopes);
    if (next.has(scope)) next.delete(scope);
    else next.add(scope);
    setSelectedScopes(next);
  }

  function toggleAgent(agentId: string) {
    const next = new Set(selectedAgentIds);
    if (next.has(agentId)) next.delete(agentId);
    else next.add(agentId);
    setSelectedAgentIds(next);
  }

  const bindsToSpecificAgents =
    showBinding && !manageSelected && bindingMode === "specific";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || selectedScopes.size === 0) return;
    const result = await createApiKey.mutateAsync({
      name: name.trim(),
      scopes: Array.from(selectedScopes),
      agentIds: bindsToSpecificAgents ? Array.from(selectedAgentIds) : "*",
    });
    onCreated(result.plaintext);
  }

  const submitDisabled =
    !name.trim() ||
    selectedScopes.size === 0 ||
    (bindsToSpecificAgents && selectedAgentIds.size === 0) ||
    createApiKey.isPending;

  return (
    // `contents` keeps the <form> out of the layout box tree so DialogHeader/
    // Body/Footer sit directly in the Modal's flex column — otherwise the form
    // wrapper breaks the column and the scrollable body, overflowing the panel.
    <form onSubmit={handleSubmit} className="contents">
      <DialogHeader>
        <h2 className="text-[18px] font-bold">Create API key</h2>
      </DialogHeader>
      <DialogBody>
        <div className="mb-4">
          <SectionLabel className="mb-1 block">Name</SectionLabel>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. CI release pipeline"
            autoFocus
            maxLength={100}
            aria-label="Name"
          />
        </div>

        <div className="mb-4">
          <SectionLabel className="mb-1 block">Scopes</SectionLabel>
          <p className="text-[12px] text-muted-foreground mb-2">
            Pick the narrowest scope that satisfies your use case. An
            exfiltrated key with only <code>agents:read</code> cannot change
            anything or run an agent.
          </p>
          <div className="space-y-4 rounded-lg border border-border p-4">
            {SCOPE_GROUPS.map((group) => (
              <div key={group.label}>
                <SectionLabel className="mb-1.5 block">
                  {group.label}
                </SectionLabel>
                <div className="space-y-2">
                  {group.scopes.map((scope) => (
                    <ScopeOption
                      key={scope}
                      scope={scope}
                      checked={selectedScopes.has(scope)}
                      onToggle={() => toggleScope(scope)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {showBinding && (
          <AgentBindingField
            mode={bindingMode}
            selectedAgentIds={selectedAgentIds}
            onModeChange={setBindingMode}
            onToggleAgent={toggleAgent}
            lockedToAll={manageSelected}
          />
        )}
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitDisabled}>
          {createApiKey.isPending ? "Creating…" : "Create"}
        </Button>
      </DialogFooter>
    </form>
  );
}

interface ScopeOptionProps {
  scope: Scope;
  checked: boolean;
  onToggle: () => void;
}

function ScopeOption({ scope, checked, onToggle }: ScopeOptionProps) {
  return (
    <label className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/40 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-1"
      />
      <div className="flex-1">
        <code className="text-[13px] font-semibold">{scope}</code>
        <span className="text-[12px] text-muted-foreground block">
          {scopeDescription(scope)}
        </span>
      </div>
    </label>
  );
}

function scopeDescription(scope: Scope): string {
  switch (scope) {
    case "agents:read":
      return "Read-only: list and inspect agents, schedules, skills, and config. No changes, no run.";
    case "agents:operate":
      return "Run agents: respond to approvals and upload workspace files. Running can change agent state.";
    case "agents:manage":
      return "Full agent config and lifecycle: create/delete, schedules, skills, egress, channels, credential assignment. Unrestricted keys only.";
    case "credentials:read":
      return "List connections and secrets.";
    case "credentials:manage":
      return "Create, update, and delete connections and secrets.";
  }
}
