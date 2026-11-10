import { TrashCan } from "@carbon/icons-react";
import type { ConnectionStatus, ConnectionView } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "./connection-icon.js";
import {
  ConnectionRowActions,
  ConnectionRowMenu,
} from "./connection-row-actions.js";
import { ConnectionRowDetail } from "./connection-row-detail.js";
import { FullAccessMark } from "./full-access-mark.js";
import { GithubAppInstallations } from "./github-app-installations.js";
import { RetiredHostNote } from "./retired-host-note.js";

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
  onMoveHost?: () => void;
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
      className="@container flex items-start gap-2 px-4 py-2.5"
    >
      {iconSlug && (
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="mt-2 shrink-0 text-foreground/80"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
          <div className="flex min-h-8 min-w-0 flex-[1_1_180px] flex-wrap content-center items-center gap-x-2 gap-y-1">
            <span
              className="min-w-0 max-w-full truncate text-md font-medium text-foreground"
              title={connection.name}
            >
              {connection.name}
            </span>
            <Badge
              variant="muted"
              className="min-w-0 max-w-full font-normal"
              title={tag}
            >
              <span className="truncate">{tag}</span>
            </Badge>
            <StatusBadges connection={connection} />
          </div>
          <ConnectionRowActions
            connection={connection}
            grant={grant}
            maintenance={maintenance}
            onNewChild={onNewChild}
          />
        </div>
        <ConnectionRowDetail connection={connection} />
        <RetiredHostNote connection={connection} />
        <GithubAppInstallations connection={connection} />
      </div>
      <div className="flex h-8 shrink-0 items-center gap-1">
        <ConnectionRowMenu
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
            tooltip="Remove from this agent"
            onClick={onRemove}
            data-testid={`catalog-remove-${connection.id}`}
          >
            <TrashCan size={16} />
          </Button>
        )}
      </div>
    </div>
  );
}

function StatusBadges({ connection }: { connection: ConnectionView }) {
  const status =
    connection.status === "active"
      ? undefined
      : STATUS_PRESENTATION[connection.status];
  if (connection.fullAccess && status?.variant === "danger")
    return <FullAccessMark connection={connection} status={status.label} />;
  return (
    <>
      <FullAccessMark connection={connection} />
      {status && (
        <Badge variant={status.variant} className="shrink-0">
          {status.label}
        </Badge>
      )}
      {connection.status === "active" &&
        connection.check?.status === "failed" && (
          <Badge
            variant="danger"
            className="shrink-0"
            title={connection.check.reason}
            data-testid={`catalog-connection-check-${connection.id}`}
          >
            Check failed
          </Badge>
        )}
    </>
  );
}
