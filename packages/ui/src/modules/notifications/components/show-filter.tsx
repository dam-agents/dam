import { ChevronDown, Reset } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import type { NotificationFilters } from "../lib/filters.js";
import {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPES,
  type NotificationType,
} from "../lib/notification-types.js";

interface Props {
  filters: NotificationFilters;
  onToggleType: (type: NotificationType) => void;
  onToggleAgent: (agentId: string) => void;
  onReset: () => void;
  typeCounts: Map<NotificationType, number>;
  agentCounts: Map<string, number>;
  agents: readonly AgentView[];
  isFiltered: boolean;
  hiddenCount: number;
}

export function ShowFilter({
  filters,
  onToggleType,
  onToggleAgent,
  onReset,
  typeCounts,
  agentCounts,
  agents,
  isFiltered,
  hiddenCount,
}: Props) {
  const [open, setOpen] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors",
            open
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          )}
        >
          Show
          <ChevronDown size={16} />
        </button>
        {isFiltered && (
          <>
            <span className="text-sm text-muted-foreground">
              {hiddenCount} hidden by filters.
            </span>
            <button
              type="button"
              onClick={onReset}
              className="flex items-center gap-1 text-sm text-accent transition-colors hover:text-accent/80"
              data-testid="filter-reset"
            >
              <Reset size={16} />
              Reset
            </button>
          </>
        )}
      </div>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-xl border border-border bg-card p-2 shadow-lg">
          <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Type
          </div>
          {NOTIFICATION_TYPES.map((type) => {
            const count = typeCounts.get(type) ?? 0;
            if (count === 0) return null;
            return (
              <FilterCheckbox
                key={type}
                checked={filters.types.has(type)}
                onChange={() => onToggleType(type)}
                label={NOTIFICATION_TYPE_LABELS[type]}
                count={count}
              />
            );
          })}

          {agents.length > 0 && (
            <>
              <div className="mt-2 border-t border-border pt-2 px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Agent
              </div>
              {agents.map((agent) => {
                const count = agentCounts.get(agent.id) ?? 0;
                if (count === 0) return null;
                return (
                  <FilterCheckbox
                    key={agent.id}
                    checked={filters.agents.has(agent.id)}
                    onChange={() => onToggleAgent(agent.id)}
                    label={agent.name}
                    count={count}
                  />
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilterCheckbox({
  checked,
  onChange,
  label,
  count,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  count: number;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-muted/60">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-3.5 rounded border-border accent-accent"
      />
      <span className="flex-1 truncate text-foreground">{label}</span>
      <span className="text-muted-foreground">{count}</span>
    </label>
  );
}
