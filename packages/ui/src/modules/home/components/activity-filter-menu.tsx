import { Filter } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  type ActivityFilters,
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  isFiltered,
  STATE_FILTER_LABELS,
  type StateFilter,
} from "../lib/activity-filter.js";

const SESSION_STATES: readonly StateFilter[] = ["any", "in-progress", "unread"];

export function ActivityFilterMenu({
  filters,
  onChange,
}: {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
}) {
  const filtered = isFiltered(filters);
  const label = filtered ? "Filter activity (filtered)" : "Filter activity";

  const toggleChannel = (type: (typeof CHANNEL_TYPES)[number]) => {
    const next = new Set(filters.channelTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...filters, channelTypes: next });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          data-testid="sidebar-activity-filter"
          className={cn(
            "relative flex size-6 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted hover:text-foreground",
            filtered ? "text-primary" : "text-muted-foreground",
          )}
        >
          <Filter size={14} />
          {filtered && (
            <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        {SESSION_STATES.map((state) => (
          <DropdownMenuCheckboxItem
            key={state}
            checked={filters.state === state}
            onCheckedChange={() => onChange({ ...filters, state })}
            onSelect={(event) => event.preventDefault()}
          >
            {STATE_FILTER_LABELS[state]}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Types</DropdownMenuLabel>
        {CHANNEL_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={filters.channelTypes.has(type)}
            onCheckedChange={() => toggleChannel(type)}
            onSelect={(event) => event.preventDefault()}
          >
            {CHANNEL_TYPE_LABELS[type]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
