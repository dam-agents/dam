import { Add } from "@carbon/icons-react";

export function AddRow({
  label,
  testId,
  disabled = false,
  onClick,
}: {
  label: string;
  testId: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[34px] w-full min-w-0 items-center gap-2.5 rounded-lg px-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex size-5 shrink-0 items-center justify-center">
        <Add size={16} aria-hidden />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
