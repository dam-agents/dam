import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionLabel } from "@/components/ui/section-label";

import { useAgentsList } from "../../../agents/api/queries.js";

export type BindingMode = "all" | "specific";

interface Props {
  mode: BindingMode;
  selectedAgentIds: Set<string>;
  onModeChange: (mode: BindingMode) => void;
  onToggleAgent: (agentId: string) => void;
  /** `agents:manage` keys must be wildcard-bound, so the picker locks to "all"
   *  and the "specific" option is disabled. */
  lockedToAll: boolean;
}

export function AgentBindingField({
  mode,
  selectedAgentIds,
  onModeChange,
  onToggleAgent,
  lockedToAll,
}: Props) {
  const agents = useAgentsList();
  const effectiveMode: BindingMode = lockedToAll ? "all" : mode;

  return (
    <div className="mb-4">
      <SectionLabel className="mb-1 block">Agent access</SectionLabel>
      <p className="text-xs text-muted-foreground mb-2">
        {lockedToAll ? (
          <>
            <code>agents:manage</code> keys must cover every agent — per-agent
            binding isn’t available with management access.
          </>
        ) : (
          "Limit this key to specific agents, or let it act on all of them."
        )}
      </p>

      <RadioGroup
        aria-label="Agent access"
        value={effectiveMode}
        onValueChange={(value) =>
          onModeChange(value === "specific" ? "specific" : "all")
        }
      >
        <RadioGroupItem
          value="all"
          label="All agents"
          description="Every agent you own, now and in the future."
          className="rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40"
        />
        <RadioGroupItem
          value="specific"
          label="Specific agents"
          description="Only the agents you pick below."
          disabled={lockedToAll}
          className="rounded-lg p-2 enabled:cursor-pointer enabled:hover:bg-muted/40"
        />
      </RadioGroup>

      {effectiveMode === "specific" && (
        <div className="mt-2 ml-6 space-y-1.5">
          {agents.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              You have no agents yet — create one first, or choose “All agents”.
            </p>
          ) : (
            agents.map((agent) => (
              <label
                key={agent.id}
                htmlFor={`api-key-agent-${agent.id}`}
                className="flex cursor-pointer items-center gap-2"
              >
                <Checkbox
                  id={`api-key-agent-${agent.id}`}
                  checked={selectedAgentIds.has(agent.id)}
                  onCheckedChange={() => onToggleAgent(agent.id)}
                />
                <span className="truncate text-sm">{agent.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
