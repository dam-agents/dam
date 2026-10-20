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
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  type ActivityFilters,
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  defaultActivityFilters,
  isFiltered,
  onlyChannelType,
  showAllChannelTypes,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
  toggleChannelType,
} from "../lib/activity-filter.js";

const inlineActionClassName =
  "h-6 w-auto shrink-0 px-2 text-xs text-muted-foreground";

export function ActivityFilterMenu({
  filters,
  onChange,
}: {
  filters: ActivityFilters;
  onChange: (filters: ActivityFilters) => void;
}) {
  const filtered = isFiltered(filters);
  const label = filtered ? "Filter sessions (filtered)" : "Filter sessions";
  const allTypes = filters.channelTypes.size === CHANNEL_TYPES.length;

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
        <div
          role="presentation"
          className="flex items-center justify-between gap-2"
        >
          <DropdownMenuLabel>Type</DropdownMenuLabel>
          {!allTypes && (
            <DropdownMenuItem
              aria-label="Show all types"
              className={cn(inlineActionClassName, "mt-1")}
              onSelect={(event) => {
                event.preventDefault();
                onChange(showAllChannelTypes(filters));
              }}
            >
              Show all
            </DropdownMenuItem>
          )}
        </div>
        {CHANNEL_TYPES.map((type) => (
          <div
            key={type}
            role="presentation"
            className="group flex items-center gap-1"
          >
            <DropdownMenuCheckboxItem
              className="flex-1"
              checked={filters.channelTypes.has(type)}
              onCheckedChange={() => onChange(toggleChannelType(filters, type))}
              onSelect={(event) => event.preventDefault()}
            >
              {CHANNEL_TYPE_LABELS[type]}
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem
              aria-label={`Show only ${CHANNEL_TYPE_LABELS[type]}`}
              className={cn(
                inlineActionClassName,
                HOVER_ACTION,
                "group-focus-within:opacity-100",
              )}
              onSelect={(event) => {
                event.preventDefault();
                onChange(onlyChannelType(filters, type));
              }}
            >
              Only
            </DropdownMenuItem>
          </div>
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
