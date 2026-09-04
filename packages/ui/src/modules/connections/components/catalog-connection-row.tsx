import type { ConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";

import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowActions } from "./connection-row-actions.js";
import { ConnectionStatusBadge } from "./connection-status-badge.js";

export interface RowGrantControls {
  granted: boolean;
  onToggle: (on: boolean) => void;
  actionHidden?: boolean;
}

export interface RowMaintenanceActions {
  onReauthenticate?: () => void;
  onUpdateCredential?: () => void;
  onEditScope?: () => void;
  busy?: boolean;
}

interface Props {
  connection: ConnectionView;
  tag: string;
  iconSlug?: string;
  grant?: RowGrantControls;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  maintenance?: RowMaintenanceActions;
}

export function CatalogConnectionRow({
  connection,
  tag,
  iconSlug,
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
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          {iconSlug && (
            <ConnectionIcon
              iconSlug={iconSlug}
              alt=""
              size={16}
              className="shrink-0 text-foreground/80"
            />
          )}
          <p className="truncate text-[15px] text-foreground">
            {connection.name}
          </p>
          <Badge variant="muted" className="shrink-0 font-normal">
            {tag}
          </Badge>
          {connection.status !== "active" && (
            <ConnectionStatusBadge status={connection.status} />
          )}
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
