import { Filter } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  type ActivityFilters,
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  defaultActivityFilters,
  isFiltered,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
} from "../lib/activity-filter.js";

export function ActivityFilterMenu({
  filters,
  onChange,
}: {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
}) {
  const filtered = isFiltered(filters);
  const label = filtered ? "Filter sessions (filtered)" : "Filter sessions";

  const toggleChannel = (type: (typeof CHANNEL_TYPES)[number]) => {
    const next = new Set(filters.channelTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    onChange({ ...filters, channelTypes: next });
  };

  return (
    <DropdownMenu>
      <Tooltip content={label}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={label}
            data-testid="sidebar-session-filter"
            className={cn(
              "relative flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground",
              filtered ? "text-primary" : "text-muted-foreground",
            )}
          >
            <Filter size={14} />
            {filtered && (
              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-primary" />
            )}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={filters.state}
          onValueChange={(value) => {
            const state = STATE_FILTERS.find((s) => s === value);
            if (state) onChange({ ...filters, state });
          }}
        >
          {STATE_FILTERS.map((state) => (
            <DropdownMenuRadioItem
              key={state}
              value={state}
              onSelect={(event) => event.preventDefault()}
            >
              {STATE_FILTER_LABELS[state]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Type</DropdownMenuLabel>
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
        {filtered && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => onChange(defaultActivityFilters())}
            >
              Reset to default
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
