import { Spinner } from "@/components/ui/spinner";

export function AgentReconnectingNotice({ name }: { name: string }) {
  return (
    <div
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
      data-testid="agent-reconnecting-notice"
    >
      <Spinner size={12} label="Reconnecting" />
      <span>Reconnecting to {name}…</span>
    </div>
  );
}
