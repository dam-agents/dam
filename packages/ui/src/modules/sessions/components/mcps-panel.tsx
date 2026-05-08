import { Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export interface McpOption {
  id: string;          // K8s credential Secret id
  hostname: string;    // display label + session key
  assigned: boolean;   // agent has this secret assigned
}

/**
 * Right-panel picker for MCP servers. The list comes from the intersection of
 * "user's MCP connections" and "what the agent has been granted." Toggling
 * affects NEW sessions only — existing sessions keep their bake-in.
 */
export function McpsPanel({
  options,
  enabled,
  onToggle,
  onSelectAll,
  onClearAll,
  hasActiveSession,
}: {
  options: McpOption[];
  enabled: Set<string>;
  onToggle: (hostname: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  hasActiveSession: boolean;
}) {
  if (options.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-muted-foreground">
        No MCP connections assigned to this agent.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b-2 border-border shrink-0 flex items-center text-[11px] text-muted-foreground">
        <span>
          <strong className="text-foreground">{enabled.size}</strong> of {options.length} enabled
        </span>
        <span className="ml-auto flex gap-3">
          <Button variant="link" size="sm" className="h-auto p-0 font-semibold text-muted-foreground hover:text-primary" onClick={onSelectAll}>All</Button>
          <span>·</span>
          <Button variant="link" size="sm" className="h-auto p-0 font-semibold text-muted-foreground hover:text-primary" onClick={onClearAll}>None</Button>
        </span>
      </div>

      {hasActiveSession && (
        <div className="px-4 py-2 border-b-2 border-border text-[11px] text-muted-foreground bg-warning-light">
          Changes apply to new sessions — the current session keeps its original selection.
        </div>
      )}

      {options.map((o) => (
        <label
          key={o.hostname}
          className={`flex items-center gap-3 border-b border-border px-4 py-3 cursor-pointer transition-colors ${enabled.has(o.hostname) ? "bg-primary/10" : "hover:bg-muted"}`}
        >
          <Checkbox
            checked={enabled.has(o.hostname)}
            onCheckedChange={() => onToggle(o.hostname)}
          />
          <Globe size={14} className="text-info shrink-0" />
          <span className="text-[13px] font-medium text-foreground truncate">{o.hostname}</span>
        </label>
      ))}
    </div>
  );
}
