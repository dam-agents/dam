import { ChevronDown } from "@carbon/icons-react";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  SESSION_CATEGORIES,
  SESSION_CATEGORY_LABELS,
  type SessionCategory,
} from "../../sessions/lib/session-category.js";
import {
  ALL_CATEGORIES,
  ALL_STATES,
  FEED_STATE_LABELS,
  FEED_STATES,
  type FeedState,
} from "../lib/feed-filter.js";

interface Props {
  includedStates: ReadonlySet<FeedState>;
  includedCategories: ReadonlySet<SessionCategory>;
  onToggleState: (state: FeedState) => void;
  onToggleCategory: (cat: SessionCategory) => void;
  onToggleAll: () => void;
}

function triggerLabel(
  states: ReadonlySet<FeedState>,
  categories: ReadonlySet<SessionCategory>,
): string {
  const allStates = states.size === ALL_STATES.size;
  const allCats = categories.size === ALL_CATEGORIES.size;
  if (allStates && allCats) return "All";
  const active = states.size + categories.size;
  const total = ALL_STATES.size + ALL_CATEGORIES.size;
  return `${active} of ${total}`;
}

export function FeedFilterBar({
  includedStates,
  includedCategories,
  onToggleState,
  onToggleCategory,
  onToggleAll,
}: Props) {
  const allChecked =
    includedStates.size === ALL_STATES.size &&
    includedCategories.size === ALL_CATEGORIES.size;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="feed-filter"
          className="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {triggerLabel(includedStates, includedCategories)}
          <ChevronDown size={16} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[220px]">
        <DropdownMenuCheckboxItem
          checked={allChecked}
          onCheckedChange={onToggleAll}
          onSelect={(e) => e.preventDefault()}
          className="font-medium"
        >
          All
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          State
        </p>
        {FEED_STATES.map((state) => (
          <DropdownMenuCheckboxItem
            key={state}
            checked={includedStates.has(state)}
            onCheckedChange={() => onToggleState(state)}
            onSelect={(e) => e.preventDefault()}
          >
            {FEED_STATE_LABELS[state]}
          </DropdownMenuCheckboxItem>
        ))}

        <DropdownMenuSeparator />
        <p className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Where it came from
        </p>
        {SESSION_CATEGORIES.map((cat) => (
          <DropdownMenuCheckboxItem
            key={cat}
            checked={includedCategories.has(cat)}
            onCheckedChange={() => onToggleCategory(cat)}
            onSelect={(e) => e.preventDefault()}
          >
            {SESSION_CATEGORY_LABELS[cat]}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
