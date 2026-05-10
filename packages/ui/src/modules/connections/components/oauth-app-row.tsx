import { Unplug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import type { OAuthAppConnection, OAuthAppDescriptor } from "../api/fetchers.js";
import { useDisconnectApp } from "../api/mutations.js";
import { OAuthAppIcon } from "./oauth-app-icon.js";

interface Props {
  app: OAuthAppDescriptor;
  connection: OAuthAppConnection;
  animationDelayMs: number;
  onReconnect: (app: OAuthAppDescriptor) => void;
}

/**
 * Renders a single existing connection. The descriptor supplies the icon
 * and human context; the connection supplies the host + status. Disconnect
 * keys on `connection.connectionId` so multi-instance apps (Generic) stay
 * unambiguous when more than one connection of the same app exists.
 */
export function OAuthAppRow({ app, connection, animationDelayMs, onReconnect }: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectApp = useDisconnectApp();

  const isDisconnecting =
    disconnectApp.isPending && disconnectApp.variables === connection.connectionId;
  const expired = connection.expired;

  const handleDisconnect = async () => {
    if (!(await showConfirm(`Disconnect ${connection.displayName}?`, "Disconnect"))) return;
    disconnectApp.mutate(connection.connectionId);
  };

  const detail = expired
    ? "Expired — reconnect to refresh access"
    : `Connected ${new Date(connection.connectedAt).toLocaleDateString()} · ${connection.hostPattern}`;

  return (
    <Card
      className="flex items-center gap-4 px-5 py-4 transition-shadow hover:shadow-md anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border border-border bg-background flex items-center justify-center text-foreground/80">
        <OAuthAppIcon appId={app.id} alt={app.displayName} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-foreground truncate">{connection.displayName}</div>
        <div className="text-[12px] font-mono text-muted-foreground truncate">{detail}</div>
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
          onClick={() => onReconnect(app)}
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
    </Card>
  );
}
