import { Globe, Unplug } from "lucide-react";

import { useStore } from "../../../store.js";
import type { McpConnection } from "../../../types.js";
import { useDisconnectMcp } from "../api/mutations.js";

interface Props {
  connection: McpConnection;
  animationDelayMs: number;
  onReconnect: (hostname: string) => void;
}

export function McpConnectionRow({
  connection,
  animationDelayMs,
  onReconnect,
}: Props) {
  const { hostname, connectedAt, expired } = connection;
  const showConfirm = useStore((s) => s.showConfirm);
  const disconnectMcp = useDisconnectMcp();
  const isDisconnecting =
    disconnectMcp.isPending && disconnectMcp.variables === hostname;

  const handleDisconnect = async () => {
    if (!(await showConfirm(`Disconnect "${hostname}"?`, "Disconnect"))) return;
    disconnectMcp.mutate(hostname);
  };

  return (
    <div
      className="flex items-center gap-4 rounded-xl border-2 border-border bg-surface px-5 py-4 transition-shadow hover:shadow-[4px_4px_0_#292524] shadow-brutal anim-in"
      style={{ animationDelay: `${animationDelayMs}ms` }}
    >
      <div className="w-9 h-9 shrink-0 rounded-lg border-2 border-border-light bg-bg flex items-center justify-center text-text-secondary">
        <Globe size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-semibold text-text truncate">
          {hostname}
        </div>
        <div className="text-[12px] font-mono text-text-muted truncate">
          {expired
            ? "Expired"
            : `Connected ${new Date(connectedAt).toLocaleDateString()}`}
        </div>
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
          onClick={() => onReconnect(hostname)}
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
