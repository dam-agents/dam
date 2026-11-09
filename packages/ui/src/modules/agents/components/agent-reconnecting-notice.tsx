import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

export function AgentReconnectingNotice({
  name,
  state,
  onRetry,
}: {
  name: string;
  state: "lost" | "connecting";
  onRetry?: () => void;
}) {
  const lost = state === "lost";
  return (
    <div
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
      data-testid="agent-reconnecting-notice"
    >
      <Spinner size={12} label={lost ? "Reconnecting" : "Connecting"} />
      <span className="flex-1">
        {lost ? "Reconnecting" : "Connecting"} to {name}…
      </span>
      {onRetry && (
        <Button variant="link" size="inline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
