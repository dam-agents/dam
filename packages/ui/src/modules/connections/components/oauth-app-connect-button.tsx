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
      className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left hover:border-primary transition-colors"
    >
      <div className="w-7 h-7 shrink-0 rounded-md border border-border bg-card flex items-center justify-center text-foreground/80">
        <OAuthAppIcon appId={app.id} alt={app.displayName} size={13} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-foreground">Connect {app.displayName}</div>
        <div className="text-[11px] text-muted-foreground truncate">{app.description}</div>
      </div>
    </button>
  );
}
