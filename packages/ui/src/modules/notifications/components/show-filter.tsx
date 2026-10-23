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
  CHANNEL_TYPE_LABELS,
  CHANNEL_TYPES,
  type ChannelType,
  type NotificationFilters,
  STATE_FILTER_LABELS,
  STATE_FILTERS,
  type StateFilter,
} from "../lib/filters.js";

interface Props {
  filters: NotificationFilters;
  onToggleChannelType: (type: ChannelType) => void;
  onChangeState: (state: StateFilter) => void;
  onReset: () => void;
  isFiltered: boolean;
}

export function ShowFilter({
  filters,
  onToggleChannelType,
  onChangeState,
  onReset,
  isFiltered,
}: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <TypeDropdown
        selected={filters.channelTypes}
        onToggle={onToggleChannelType}
      />
      <StatusDropdown selected={filters.state} onChange={onChangeState} />

      {isFiltered && (
        <button
          type="button"
          onClick={onReset}
          className="ml-auto flex items-center gap-1 text-sm text-accent transition-colors hover:text-accent/80"
          data-testid="filter-reset"
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
  const allOn = selected.size === CHANNEL_TYPES.length;
  const noneOn = selected.size === 0;
  const label = allOn
    ? "All types"
    : noneOn
      ? "No types"
      : `Types (${selected.size})`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
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
            onSelect={(e) => e.preventDefault()}
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
  const label =
    selected === "any" ? "All statuses" : STATE_FILTER_LABELS[selected];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="xs"
          className="text-sm font-normal text-muted-foreground"
        >
          <Filter size={16} />
          {label}
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
