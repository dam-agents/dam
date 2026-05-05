import { Globe } from "lucide-react";

export interface McpOption {
  id: string;          // K8s credential Secret id
  hostname: string;    // display label + session key
  assigned: boolean;   // agent has this secret assigned (selective or via "all" mode)
}

/**
 * Right-panel picker for MCP servers. The list comes from the intersection of
 * "user's MCP connections" and "what the agent can access (credential mode)".
 * Toggling affects NEW sessions only — existing sessions keep their bake-in.
 */
export function McpsPanel({
  options,
  enabled,
  onToggle,
  onSelectAll,
  onClearAll,
  hasActiveSession,
  accessMode,
}: {
  options: McpOption[];
  enabled: Set<string>;
  onToggle: (hostname: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  hasActiveSession: boolean;
  accessMode: "all" | "selective" | null;
}) {
  if (options.length === 0) {
    return (
      <div className="px-4 py-4 text-[12px] text-text-muted">
        {accessMode === "selective"
          ? "No MCP connections assigned to this agent."
          : "No MCP connections configured."}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="px-4 py-3 border-b-2 border-border-light shrink-0 flex items-center text-[11px] text-text-muted">
        <span>
          <strong className="text-text">{enabled.size}</strong> of {options.length} enabled
        </span>
        <span className="ml-auto flex gap-3">
          <button className="hover:text-accent font-semibold" onClick={onSelectAll}>All</button>
          <span>·</span>
          <button className="hover:text-accent font-semibold" onClick={onClearAll}>None</button>
        </span>
      </div>

      {hasActiveSession && (
        <div className="px-4 py-2 border-b-2 border-border-light text-[11px] text-text-muted bg-warning-light">
          Changes apply to new sessions — the current session keeps its original selection.
        </div>
      )}

      {options.map((o) => (
        <label
          key={o.hostname}
          className={`flex items-center gap-3 border-b border-border-light px-4 py-3 cursor-pointer transition-colors ${enabled.has(o.hostname) ? "bg-accent-light" : "hover:bg-surface-raised"}`}
        >
          <input
            type="checkbox"
            className="accent-[var(--color-accent)] w-4 h-4"
            checked={enabled.has(o.hostname)}
            onChange={() => onToggle(o.hostname)}
          />
          <Globe size={14} className="text-info shrink-0" />
          <span className="text-[13px] font-medium text-text truncate">{o.hostname}</span>
        </label>
      ))}
    </div>
  );
}
