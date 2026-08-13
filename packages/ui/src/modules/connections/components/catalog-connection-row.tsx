import type { ConnectionView } from "api-server-api";

import { ConnectionRowActions } from "./connection-row-actions.js";
import { ConnectionStatusBadge } from "./connection-status-badge.js";

export interface RowGrantControls {
  granted: boolean;
  onToggle: (on: boolean) => void;
  /** Hide the Add/In-this-sandbox affordance; the ⋮ menu keeps Remove. */
  actionHidden?: boolean;
}

/** Which callbacks are set is the caller's decision, from the auth kind, so the
 *  row stays unaware of it. */
export interface RowMaintenanceActions {
  onReauthenticate?: () => void;
  onUpdateCredential?: () => void;
  /** Change what the connection is allowed to do, where that is a property of
   *  the connection rather than of the credential (GitHub App scope). */
  onEditScope?: () => void;
  /** A consent popup for this row is already open. */
  busy?: boolean;
}

interface Props {
  connection: ConnectionView;
  subtitle: string;
  /** Sandbox staging controls; omit outside a sandbox context. */
  grant?: RowGrantControls;
  /** ⋮ → "Manage connections" (sandbox/wizard lists, opens the catalogue). */
  onManage?: () => void;
  /** ⋮ → "Delete this connection" (settings and the catalogue only). */
  onDelete?: () => void;
  deleting?: boolean;
  /** ⋮ → credential maintenance, plus the inline fix on an expired row. */
  maintenance?: RowMaintenanceActions;
}

export function CatalogConnectionRow({
  connection,
  subtitle,
  grant,
  onManage,
  onDelete,
  deleting = false,
  maintenance,
}: Props) {
  return (
    <div
      data-testid={`catalog-connection-${connection.id}`}
      className="px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <div className="min-w-[160px] flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[15px] text-foreground">
              {connection.name}
            </p>
            {connection.status !== "active" && (
              <ConnectionStatusBadge status={connection.status} />
            )}
          </div>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <ConnectionRowActions
          connection={connection}
          grant={grant}
          maintenance={maintenance}
          onManage={onManage}
          onDelete={onDelete}
          deleting={deleting}
        />
      </div>
    </div>
  );
}
