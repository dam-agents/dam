import { TrashCan } from "@carbon/icons-react";
import type { ConnectionStatus, ConnectionView } from "api-server-api";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowActions } from "./connection-row-actions.js";
import { ConnectionRowDetail } from "./connection-row-detail.js";
import { FullAccessMark } from "./full-access-mark.js";
import { GithubAppInstallations } from "./github-app-installations.js";

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
      className="@container flex gap-2 px-4 py-2.5"
    >
      {iconSlug && (
        <ConnectionIcon
          iconSlug={iconSlug}
          alt=""
          size={16}
          className="mt-1.5 shrink-0 text-foreground/80"
        />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex min-w-0 flex-[1_1_180px] flex-wrap items-center gap-x-2 gap-y-1">
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
            <FullAccessMark connection={connection} />
            {connection.status !== "active" && (
              <Badge
                variant={STATUS_PRESENTATION[connection.status].variant}
                className="shrink-0"
              >
                {STATUS_PRESENTATION[connection.status].label}
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
          </div>
          <div className="ml-auto flex min-w-0 max-w-full items-center gap-2 @max-md:ml-0">
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
        </div>
        <ConnectionRowDetail connection={connection} />
        <GithubAppInstallations connection={connection} />
      </div>
    </div>
  );
}
