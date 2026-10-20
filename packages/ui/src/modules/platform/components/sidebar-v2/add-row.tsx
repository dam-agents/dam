import type { CarbonIconType } from "@carbon/icons-react";

import { FOCUS_RING } from "@/components/ui/focus-ring";

// UNIT_BOUNDARY_DESCRIPTION: every row of the tree puts its avatar, dot or icon in one 24px column and its text after the same gap, so dots line up under Agent avatars and titles under Agent names.
export const TREE_LEADING = "flex w-6 shrink-0 justify-center";

export function AddRow({
  icon: Icon,
  label,
  ariaLabel,
  testId,
  disabled = false,
  onClick,
}: {
  icon: CarbonIconType;
  label: string;
  ariaLabel?: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 ${FOCUS_RING}`}
    >
      <span className={TREE_LEADING}>
        <Icon size={16} aria-hidden />
      </span>
      <span className="truncate">{label}</span>
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
      className={`flex h-[30px] w-full items-center rounded-lg pr-2 pl-[42px] text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:cursor-default aria-disabled:opacity-60 ${FOCUS_RING}`}
    >
      {retrying ? "Retrying…" : `${label} Retry`}
    </button>
  );
}
