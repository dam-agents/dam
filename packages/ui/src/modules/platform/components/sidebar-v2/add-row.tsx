import type { CarbonIconType } from "@carbon/icons-react";
import { type ComponentPropsWithoutRef, forwardRef } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  ACTIVE_ITEM,
  HOVER_ITEM,
  RAIL_AVATAR,
  RAIL_GLYPH,
  RAIL_ROW,
  SIDEBAR_GLYPH,
  SQUIRCLE,
} from "@/components/ui/rail-tile";
import { cn } from "@/lib/utils";

// UNIT_BOUNDARY_DESCRIPTION: a name ends in an ellipsis at the pane rather than being cut by it, since the pane narrows over a tree that keeps its width while it moves; it clamps to what the row holds with the pane that narrow, so its ellipsis does not move out and then back. The pane is the query container, so 100cqw is the width the browser is animating this very frame.
export const TREE_LABEL_MAX = "max-w-[calc(100cqw-66px)]";
// UNIT_BOUNDARY_DESCRIPTION: an Agent's row keeps a corner clear for its own buttons, so its name gives up that much more of the pane than Home's label does.
export const TREE_AGENT_NAME_MAX = "max-w-[calc(100cqw-130px)]";

// UNIT_BOUNDARY_DESCRIPTION: every row of the tree puts its avatar, dot or icon in one 40px column, wide enough for an avatar that spans a two-line row, and its text after the same gap, so dots line up under Agent avatars and titles under Agent names.
export const TREE_LEADING = "flex w-10 shrink-0 justify-center";
// UNIT_BOUNDARY_DESCRIPTION: the expanded row's avatar and the rail's are one size, so collapsing the sidebar does not resize it.
export const TREE_AVATAR = RAIL_AVATAR;

// UNIT_BOUNDARY_DESCRIPTION: the row passes on the props a menu puts on its trigger, so the same row can open a menu rather than act on a click of its own.
export const AddRow = forwardRef<
  HTMLButtonElement,
  {
    icon: CarbonIconType;
    hoverIcon?: CarbonIconType;
    label: string;
    ariaLabel?: string;
    testId: string;
    disabled?: boolean;
    current?: boolean;
    avatar?: boolean;
  } & ComponentPropsWithoutRef<"button">
>(function AddRow(
  {
    icon: Icon,
    hoverIcon: HoverIcon,
    label,
    ariaLabel,
    testId,
    disabled = false,
    current = false,
    avatar = false,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
      disabled={disabled}
      {...rest}
      className={cn(
        SQUIRCLE,
        "group flex w-full min-w-0 items-center gap-2.5 rounded-lg text-left text-sm text-muted-foreground transition-colors disabled:pointer-events-none disabled:opacity-50",
        current ? ACTIVE_ITEM : HOVER_ITEM,
        "aria-[current=page]:bg-muted aria-[current=page]:text-foreground aria-[current=page]:ring-1 aria-[current=page]:ring-border-ui",
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
      <span className={cn("truncate", TREE_LABEL_MAX)}>{label}</span>
    </button>
  );
});

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
        SQUIRCLE,
        "flex w-full items-center gap-2.5 rounded-lg pr-2 pl-0 text-sm font-medium transition-colors",
        RAIL_ROW,
        FOCUS_RING,
        current ? ACTIVE_ITEM : cn("text-muted-foreground", HOVER_ITEM),
      )}
    >
      <span className={TREE_LEADING}>
        <Icon size={RAIL_GLYPH} />
      </span>
      <span className={cn("truncate", TREE_LABEL_MAX)}>{label}</span>
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
