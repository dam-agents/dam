import type { ReactNode } from "react";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One entry of the composer's + menu: its label and,
 * when there is one, a muted count of what the Agent has on.
 */
export function PlusMenuRow({
  label,
  badge,
  onClick,
}: {
  label: ReactNode;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-hidden"
    >
      <span className="flex-1">{label}</span>
      {badge && (
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">
          {badge}
        </span>
      )}
    </button>
  );
}
