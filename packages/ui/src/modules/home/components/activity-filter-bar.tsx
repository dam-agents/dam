import { ChevronDown, Filter, Reset } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  type ActivityFilters,
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  type ChannelType,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
  type StateFilter,
} from "../lib/activity-filter.js";

export function ActivityFilterBar({
  filters,
  onToggleChannelType,
  onChangeState,
  onReset,
  filtered,
}: {
  filters: ActivityFilters;
  onToggleChannelType: (type: ChannelType) => void;
  onChangeState: (state: StateFilter) => void;
  onReset: () => void;
  filtered: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <TypeDropdown
        selected={filters.channelTypes}
        onToggle={onToggleChannelType}
      />
      <StatusDropdown selected={filters.state} onChange={onChangeState} />
      {filtered && (
        <button
          type="button"
          onClick={onReset}
          data-testid="activity-filter-reset"
          className="ml-auto flex items-center gap-1 text-sm text-accent transition-colors hover:text-accent/80"
        >
          <Reset size={16} />
          Reset to default
        </button>
      )}
    </div>
  );
}

function TypeDropdown({
  selected,
  onToggle,
}: {
  selected: ReadonlySet<ChannelType>;
  onToggle: (type: ChannelType) => void;
}) {
  const label =
    selected.size === CHANNEL_TYPES.length
      ? "All types"
      : selected.size === 0
        ? "No types"
        : `Types (${String(selected.size)})`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          data-testid="activity-type-filter"
          className="text-sm font-normal text-muted-foreground"
        >
          <Filter size={16} />
          {label}
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {CHANNEL_TYPES.map((type) => (
          <DropdownMenuCheckboxItem
            key={type}
            checked={selected.has(type)}
            onCheckedChange={() => onToggle(type)}
            onSelect={(event) => event.preventDefault()}
          >
            {CHANNEL_TYPE_LABELS[type]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusDropdown({
  selected,
  onChange,
}: {
  selected: StateFilter;
  onChange: (state: StateFilter) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          data-testid="activity-status-filter"
          className="text-sm font-normal text-muted-foreground"
        >
          <Filter size={16} />
          {STATE_FILTER_LABELS[selected]}
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATE_FILTERS.map((state) => (
          <DropdownMenuItem
            key={state}
            onSelect={() => onChange(state)}
            className={selected === state ? "font-medium" : undefined}
          >
            {STATE_FILTER_LABELS[state]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
