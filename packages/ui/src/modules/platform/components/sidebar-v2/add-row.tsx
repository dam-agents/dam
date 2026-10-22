import type { CarbonIconType } from "@carbon/icons-react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  ACTIVE_ITEM,
  RAIL_AVATAR,
  RAIL_GLYPH,
  RAIL_ROW,
  SIDEBAR_GLYPH,
} from "@/components/ui/rail-tile";
import { cn } from "@/lib/utils";

// UNIT_BOUNDARY_DESCRIPTION: every row of the tree puts its avatar, dot or icon in one 40px column, wide enough for an avatar that spans a two-line row, and its text after the same gap, so dots line up under Agent avatars and titles under Agent names.
export const TREE_LEADING = "flex w-10 shrink-0 justify-center";
// UNIT_BOUNDARY_DESCRIPTION: the expanded row's avatar and the rail's are one size, so collapsing the sidebar does not resize it.
export const TREE_AVATAR = RAIL_AVATAR;

export function AddRow({
  icon: Icon,
  hoverIcon: HoverIcon,
  label,
  ariaLabel,
  testId,
  disabled = false,
  current = false,
  avatar = false,
  onClick,
}: {
  icon: CarbonIconType;
  hoverIcon?: CarbonIconType;
  label: string;
  ariaLabel?: string;
  testId: string;
  disabled?: boolean;
  current?: boolean;
  avatar?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group flex w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground aria-[current=page]:ring-1 aria-[current=page]:ring-border-ui disabled:pointer-events-none disabled:opacity-50",
        avatar ? "pr-2" : "px-2",
        avatar ? RAIL_ROW : "h-[34px]",
        FOCUS_RING,
      )}
    >
      <span className={TREE_LEADING}>
        <Icon
          size={avatar ? RAIL_GLYPH : SIDEBAR_GLYPH}
          aria-hidden
          className={HoverIcon ? "group-hover:hidden" : undefined}
        />
        {HoverIcon && (
          <HoverIcon
            size={avatar ? RAIL_GLYPH : SIDEBAR_GLYPH}
            aria-hidden
            className="hidden group-hover:block"
          />
        )}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: Home, Settings and the row above the tree are one row, an icon in the tree's icon column and a label after it, so all three read as the same kind of thing and their labels start at one x.
export function NavRow({
  icon: Icon,
  label,
  current = false,
  testId,
  ariaLabel,
  ariaExpanded,
  onClick,
}: {
  icon: CarbonIconType;
  label: string;
  current?: boolean;
  testId?: string;
  ariaLabel?: string;
  ariaExpanded?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-current={current ? "page" : undefined}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg pr-2 pl-0 text-sm font-medium transition-colors",
        RAIL_ROW,
        FOCUS_RING,
        current
          ? ACTIVE_ITEM
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      <span className={TREE_LEADING}>
        <Icon size={RAIL_GLYPH} />
      </span>
      {label}
    </button>
  );
}

export function RetryRow({
  label,
  testId,
  retrying,
  onRetry,
}: {
  label: string;
  testId: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-disabled={retrying || undefined}
      aria-busy={retrying || undefined}
      onClick={() => {
        if (!retrying) onRetry();
      }}
      className={`flex h-[30px] w-full items-center rounded-lg pr-2 pl-[58px] text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-60 ${FOCUS_RING}`}
    >
      {retrying ? "Retrying…" : `${label} Retry`}
    </button>
  );
}
