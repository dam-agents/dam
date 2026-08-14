import { Warning } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function StaleModelNotice({
  model,
  comingUp,
  onStartAndFix,
}: {
  model: string;
  comingUp: boolean;
  onStartAndFix: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-2.5 rounded-lg border border-warning bg-warning-light px-4 py-3 text-sm"
    >
      <Warning size={16} className="mt-px shrink-0 text-warning-fg" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-warning-fg">
          The saved model isn&rsquo;t offered by the current provider.
        </span>{" "}
        <span className="text-muted-foreground">
          This sandbox is set to <span className="font-mono">{model}</span>,
          which isn&rsquo;t in the provider&rsquo;s model list. Chatting will
          fail until it&rsquo;s changed.
        </span>
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={comingUp}
        onClick={onStartAndFix}
        className="shrink-0"
      >
        {comingUp && <Spinner size={13} />}
        {comingUp ? "Starting…" : "Start & fix"}
      </Button>
    </div>
  );
}
