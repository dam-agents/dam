import type { OAuthAppDescriptor } from "../api/fetchers.js";
import { OAuthAppIcon } from "./oauth-app-icon.js";

interface Props {
  app: OAuthAppDescriptor;
  onConnect: (app: OAuthAppDescriptor) => void;
}

/**
 * "Connect <X>" affordance shown beneath the existing-connection list.
 * One per descriptor; the parent suppresses single-instance apps that
 * already have a connection.
 */
export function OAuthAppConnectButton({ app, onConnect }: Props) {
  return (
    <button
      onClick={() => onConnect(app)}
      className="flex items-center gap-3 rounded-xl border-2 border-border-light bg-bg px-4 py-3 text-left hover:border-accent hover:shadow-[2px_2px_0_var(--color-accent)]"
    >
      <div className="w-7 h-7 shrink-0 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-secondary">
        <OAuthAppIcon appId={app.id} alt={app.displayName} size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-text">Connect {app.displayName}</div>
        <div className="text-[11px] text-text-muted truncate">{app.description}</div>
      </div>
    </button>
  );
}
