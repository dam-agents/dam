import { Add, Checkmark, WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { credentialCopyFor } from "../forms/field-copy.js";
import { useToolApprovalOffered } from "../hooks/use-tool-approval-offered.js";
import { parentNoun } from "../lib/connection-hierarchy.js";
import { childRepair } from "../lib/github-card.js";
import {
  shownToolMode,
  toolAccessTitle,
  toolModeMark,
} from "../lib/tool-mode.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";

interface Props {
  connection: ConnectionView;
  grant?: RowGrantControls;
  maintenance?: RowMaintenanceActions;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

const ROW_BUTTON =
  "max-w-full shrink-0 @max-xs:h-auto @max-xs:min-h-8 @max-xs:whitespace-normal @max-xs:py-1 @max-xs:text-left";

function reauthLabelOf(connection: ConnectionView): string {
  if (connection.parentId) return "Re-authenticate sign-in";
  return connection.status === "pending" ? "Authorize" : "Re-authenticate";
}

function updateLabelOf(connection: ConnectionView): string {
  return credentialCopyFor(connection.authKind)?.action ?? "Update credential";
}

export function ConnectionRowActions({
  connection,
  grant,
  maintenance,
  chooseAccessAgain = false,
  usedBy,
}: Pick<Props, "connection" | "grant" | "maintenance"> & {
  chooseAccessAgain?: boolean;
  usedBy?: ReactNode;
}) {
  const offered = useToolApprovalOffered();
  const toolModeShown = shownToolMode(connection, offered) !== null;
  const narrow =
    connection.fullAccess || toolModeMark(connection, offered)
      ? maintenance?.onEditScope
      : undefined;
  const repair = chooseAccessAgain
    ? childRepair(connection, maintenance)
    : null;
  const inlineFix = repair
    ? repair
    : connection.status === "disconnected" && maintenance?.onMoveHost
      ? { label: "Move to another host", run: maintenance.onMoveHost }
      : connection.status !== "expired"
        ? undefined
        : maintenance?.onRotateKey
          ? { label: "Rotate key", run: maintenance.onRotateKey }
          : maintenance?.onReauthenticate
            ? {
                label: reauthLabelOf(connection),
                run: maintenance.onReauthenticate,
              }
            : maintenance?.onUpdateCredential
              ? {
                  label: updateLabelOf(connection),
                  run: maintenance.onUpdateCredential,
                }
              : undefined;
  return (
    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-x-2 gap-y-1.5 @max-md:ml-0 @max-md:justify-start empty:hidden">
      {inlineFix && (
        <Button
          variant="outline"
          size="sm"
          className={ROW_BUTTON}
          disabled={maintenance?.busy}
          onClick={inlineFix.run}
          data-testid={`catalog-fix-${connection.id}`}
        >
          {inlineFix.label}
        </Button>
      )}
      {grant && !grant.actionHidden && (
        <RowGrantAction rowId={connection.id} grant={grant} />
      )}
      {usedBy}
      {narrow && (
        <Button
          variant="outline"
          size="sm"
          className={cn(ROW_BUTTON, "@max-md:hidden")}
          onClick={narrow}
          data-testid={`catalog-narrow-${connection.id}`}
        >
          {toolModeShown ? toolAccessTitle(offered) : "Narrow access"}
        </Button>
      )}
    </div>
  );
}

export function ConnectionRowMenu({
  connection,
  grant,
  maintenance,
  onManage,
  onDelete,
  deleting = false,
  horizontal = false,
}: Props & { horizontal?: boolean }) {
  const reauthLabel = reauthLabelOf(connection);
  const offered = useToolApprovalOffered();
  return (
    <RowActionsMenu
      label={`Actions for ${connection.name}`}
      testId={`catalog-menu-${connection.id}`}
      horizontal={horizontal}
    >
      {maintenance?.onReauthenticate && (
        <DropdownMenuItem
          disabled={maintenance.busy}
          onSelect={maintenance.onReauthenticate}
          data-testid={`catalog-reauth-${connection.id}`}
        >
          {reauthLabel}
        </DropdownMenuItem>
      )}
      {maintenance?.onMoveHost && (
        <DropdownMenuItem
          disabled={maintenance.busy}
          onSelect={maintenance.onMoveHost}
          data-testid={`catalog-move-host-${connection.id}`}
        >
          Move to another host
        </DropdownMenuItem>
      )}
      {maintenance?.onRotateKey && (
        <DropdownMenuItem
          disabled={maintenance.busy}
          onSelect={maintenance.onRotateKey}
          data-testid={`catalog-rotate-${connection.id}`}
        >
          Rotate key
        </DropdownMenuItem>
      )}
      {maintenance?.onEditScope && (
        <DropdownMenuItem
          onSelect={maintenance.onEditScope}
          data-testid={`catalog-edit-scope-${connection.id}`}
        >
          {shownToolMode(connection, offered) !== null
            ? toolAccessTitle(offered)
            : "Edit repositories & permissions"}
        </DropdownMenuItem>
      )}
      {maintenance?.onUpdateCredential && (
        <DropdownMenuItem
          onSelect={maintenance.onUpdateCredential}
          data-testid={`catalog-update-credential-${connection.id}`}
        >
          {updateLabelOf(connection)}
        </DropdownMenuItem>
      )}
      {grant?.granted && (
        <DropdownMenuItem onSelect={() => grant.onToggle(false)}>
          Remove from this agent
        </DropdownMenuItem>
      )}
      {onManage && (
        <DropdownMenuItem onSelect={onManage}>
          Manage connections
        </DropdownMenuItem>
      )}
      {onDelete && (
        <DropdownMenuItem tone="danger" disabled={deleting} onSelect={onDelete}>
          Delete this{" "}
          {connection.isParent ? parentNoun(connection) : "connection"}
        </DropdownMenuItem>
      )}
    </RowActionsMenu>
  );
}

export function RowGrantAction({
  rowId,
  grant,
}: {
  rowId: string;
  grant: RowGrantControls;
}) {
  if (grant.granted)
    return (
      <Badge
        variant="muted"
        className="h-8 shrink-0 gap-1.5 px-3 text-sm text-foreground"
      >
        <Checkmark size={16} className="text-success" />
        In this agent
      </Badge>
    );
  if (grant.blockedReason)
    return (
      <Tooltip content={grant.blockedReason}>
        <span className="inline-flex" tabIndex={0}>
          <Badge
            variant="muted"
            className="h-8 shrink-0 gap-1.5 px-3 text-sm font-normal"
            data-testid={`catalog-add-blocked-${rowId}`}
          >
            <WarningAlt size={16} className="text-warning" aria-hidden />
            Can&apos;t add
            <span className="sr-only">{grant.blockedReason}</span>
          </Badge>
        </span>
      </Tooltip>
    );
  return (
    <Button
      variant="outline"
      size="sm"
      className={ROW_BUTTON}
      onClick={() => grant.onToggle(true)}
      data-testid={`catalog-add-${rowId}`}
    >
      <Add size={16} />
      Add to agent
    </Button>
  );
}
