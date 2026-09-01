import { ChevronDown } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import {
  FEED_SOURCE_LABELS,
  FEED_SOURCES,
  FEED_STATUS_LABELS,
  FEED_STATUSES,
  type FeedSource,
  type FeedStatus,
} from "../lib/feed-filter.js";

interface Props {
  status: FeedStatus;
  onStatusChange: (status: FeedStatus) => void;
  included: ReadonlySet<FeedSource>;
  onToggleSource: (source: FeedSource) => void;
}

export function FeedFilterBar({
  status,
  onStatusChange,
  included,
  onToggleSource,
}: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="feed-filter"
          className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {FEED_STATUS_LABELS[status]}
          <ChevronDown size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {FEED_STATUSES.map((option) => (
          <DropdownMenuItem
            key={option}
            onSelect={() => onStatusChange(option)}
            className={cn(option === status && "font-medium text-foreground")}
          >
            {FEED_STATUS_LABELS[option]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Include
        </p>
        {FEED_SOURCES.map((source) => (
          <DropdownMenuCheckboxItem
            key={source}
            checked={included.has(source)}
            onCheckedChange={() => onToggleSource(source)}
            onSelect={(event) => event.preventDefault()}
          >
            {FEED_SOURCE_LABELS[source]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
