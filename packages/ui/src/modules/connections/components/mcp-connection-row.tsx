import { Globe, Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import type { McpConnection } from "../../../types.js";
import { useDisconnectMcp } from "../api/mutations.js";

interface Props {
  connection: McpConnection;
  animationDelayMs: number;
  onReconnect: (hostname: string) => void;
}

export function McpConnectionRow({ connection, animationDelayMs, onReconnect }: Props) {
  const { hostname, connectedAt, expired } = connection;
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectMcp = useDisconnectMcp();
  const isDisconnecting = disconnectMcp.isPending && disconnectMcp.variables === hostname;

  const handleDisconnect = async () => {
    if (!(await showConfirm(`Disconnect "${hostname}"?`, "Disconnect"))) return;
    disconnectMcp.mutate(hostname);
  };

  return (
    <div
      className="flex items-center gap-4 rounded-xl border border-border bg-card px-5 py-4 transition-shadow hover:shadow-sm anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center text-foreground/80">
        <Globe size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-foreground truncate">{hostname}</div>
        <div className="text-[12px] font-mono text-muted-foreground truncate">
          {expired ? "Expired" : `Connected ${new Date(connectedAt).toLocaleDateString()}`}
        </div>
      </div>
      <Badge
        variant={expired ? "destructive" : "secondary"}
        className="shrink-0 uppercase tracking-[0.03em]"
      >
        {expired ? "Expired" : "Connected"}
      </Badge>
      {expired && (
        <Button
          size="sm"
          onClick={() => onReconnect(hostname)}
        >
          Reconnect
        </Button>
      )}
      <Button
        variant="outline"
        size="icon"
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:border-destructive disabled:opacity-40"
        title="Disconnect"
      >
        <Unplug size={13} />
      </Button>
    </div>
  );
}
