import { Unplug } from "lucide-react";

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
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] shadow-brutal anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        <OAuthAppIcon appId={app.id} alt={app.displayName} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">{connection.displayName}</div>
        <div className="text-[12px] font-mono text-text-muted truncate">{detail}</div>
      </div>
      <span
        className={`text-[11px] font-bold uppercase tracking-[0.03em] border-2 rounded-full px-2.5 py-0.5 shrink-0 ${
          expired
            ? "bg-danger-light text-danger border-danger"
            : "bg-info-light text-info border-info"
        }`}
      >
        {expired ? "Expired" : "Connected"}
      </span>
      {expired && (
        <button
          onClick={() => onReconnect(app)}
          className="btn-brutal h-7 rounded-md border-2 border-accent bg-accent-light px-3 text-[11px] font-bold text-accent hover:bg-accent hover:text-white shadow-[2px_2px_0_var(--color-accent)]"
        >
          Reconnect
        </button>
      )}
      <button
        onClick={handleDisconnect}
        disabled={isDisconnecting}
        className="btn-brutal h-7 w-7 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger disabled:opacity-40 shadow-brutal-sm"
        title="Disconnect"
      >
        <Unplug size={13} />
      </button>
    </div>
  );
}
