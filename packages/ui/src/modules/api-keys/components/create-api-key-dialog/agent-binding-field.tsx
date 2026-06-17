import { SectionLabel } from "@/components/ui/section-label";

import { cn } from "../../../../lib/utils.js";
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
      <p className="text-[12px] text-muted-foreground mb-2">
        {lockedToAll ? (
          <>
            <code>agents:manage</code> keys must cover every agent — per-agent
            binding isn’t available with management access.
          </>
        ) : (
          "Limit this key to specific agents, or let it act on all of them."
        )}
      </p>

      <div className="space-y-2">
        <BindingModeOption
          label="All agents"
          description="Every agent you own, now and in the future."
          checked={effectiveMode === "all"}
          disabled={false}
          onSelect={() => onModeChange("all")}
        />
        <BindingModeOption
          label="Specific agents"
          description="Only the agents you pick below."
          checked={effectiveMode === "specific"}
          disabled={lockedToAll}
          onSelect={() => onModeChange("specific")}
        />
      </div>

      {effectiveMode === "specific" && (
        <div className="mt-2 ml-6 space-y-1.5">
          {agents.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              You have no agents yet — create one first, or choose “All agents”.
            </p>
          ) : (
            agents.map((agent) => (
              <label
                key={agent.id}
                className="flex items-center gap-2 text-[13px] cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedAgentIds.has(agent.id)}
                  onChange={() => onToggleAgent(agent.id)}
                />
                <span className="truncate">{agent.name}</span>
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface BindingModeOptionProps {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onSelect: () => void;
}

function BindingModeOption({
  label,
  description,
  checked,
  disabled,
  onSelect,
}: BindingModeOptionProps) {
  return (
    <label
      className={cn(
        "flex items-start gap-2 p-2 rounded-lg",
        disabled
          ? "opacity-50 cursor-not-allowed"
          : "hover:bg-muted/40 cursor-pointer",
      )}
    >
      <input
        type="radio"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className="mt-1"
      />
      <div className="flex-1">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[12px] text-muted-foreground block">
          {description}
        </span>
      </div>
    </label>
  );
}
