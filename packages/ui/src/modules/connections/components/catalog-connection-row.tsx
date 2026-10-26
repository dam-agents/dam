import { TrashCan } from "@carbon/icons-react";
import type { ConnectionStatus, ConnectionView } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowActions } from "./connection-row-actions.js";
import { ConnectionRowDetail } from "./connection-row-detail.js";
import { FullAccessMark } from "./full-access-mark.js";

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
  onNewChild?: () => void;
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
  onNewChild,
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
          <p className="max-w-[50%] shrink-0 truncate text-md font-medium text-foreground">
            {connection.name}
          </p>
          <Badge variant="muted" className="min-w-0 font-normal" title={tag}>
            <span className="truncate">{tag}</span>
          </Badge>
          <FullAccessMark connection={connection} />
          {connection.status !== "active" && (
            <Badge variant={STATUS_PRESENTATION[connection.status].variant}>
              {STATUS_PRESENTATION[connection.status].label}
            </Badge>
          )}
          {connection.status === "active" &&
            connection.check?.status === "failed" && (
              <Badge
                variant="danger"
                title={connection.check.reason}
                data-testid={`catalog-connection-check-${connection.id}`}
              >
                Check failed
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
          onNewChild={onNewChild}
        />
        {onRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove ${connection.name} from this agent`}
            tooltip="Remove from this agent"
            onClick={onRemove}
            data-testid={`catalog-remove-${connection.id}`}
          >
            <TrashCan size={16} />
          </Button>
        )}
      </div>
      <ConnectionRowDetail connection={connection} indented={!!iconSlug} />
    </div>
  );
}
