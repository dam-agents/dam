import type { CarbonIconType } from "@carbon/icons-react";

export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

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
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Icon size={16} aria-hidden />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
