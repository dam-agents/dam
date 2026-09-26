import { Close } from "@carbon/icons-react";
import type { ConnectionStatus, ConnectionView } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowActions } from "./connection-row-actions.js";

export interface RowGrantControls {
  granted: boolean;
  onToggle: (on: boolean) => void;
  actionHidden?: boolean;
  blockedReason?: string;
}

export interface RowMaintenanceActions {
  onReauthenticate?: () => void;
  onUpdateCredential?: () => void;
  onEditScope?: () => void;
  busy?: boolean;
}

const STATUS_PRESENTATION: Record<
  Exclude<ConnectionStatus, "active">,
  { label: string; variant: BadgeProps["variant"] }
> = {
  pending: { label: "Authorizing…", variant: "muted" },
  expired: { label: "Expired", variant: "danger" },
  disconnected: { label: "Disconnected", variant: "muted" },
};

interface Props {
  connection: ConnectionView;
  tag: string;
  iconSlug?: string;
  grant?: RowGrantControls;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  maintenance?: RowMaintenanceActions;
  onRemove?: () => void;
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
  onRemove,
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
          <p className="max-w-[50%] shrink-0 truncate text-[15px] text-foreground">
            {connection.name}
          </p>
          <Badge variant="muted" className="min-w-0 font-normal" title={tag}>
            <span className="truncate">{tag}</span>
          </Badge>
          {connection.status !== "active" && (
            <Badge variant={STATUS_PRESENTATION[connection.status].variant}>
              {STATUS_PRESENTATION[connection.status].label}
            </Badge>
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
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${connection.name} from this agent`}
            title="Remove from this agent"
            onClick={onRemove}
            data-testid={`catalog-remove-${connection.id}`}
          >
            <Close size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}
