import { Warning } from "@carbon/icons-react";

interface Props {
  pendingCount: number;
  onClick: () => void;
}

export function ApprovalSummaryRow({ pendingCount, onClick }: Props) {
  if (pendingCount === 0) return null;

  const label = `Needs attention · ${pendingCount} pending`;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="approval-summary"
      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3 text-left transition-colors hover:bg-warning/10"
    >
      <Warning size={16} className="shrink-0 text-warning" />
      <span className="text-sm font-medium text-foreground">{label}</span>
      <span className="ml-auto text-sm text-muted-foreground">&rarr;</span>
    </button>
  );
}
