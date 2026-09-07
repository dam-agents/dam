import { Add, Checkmark, OverflowMenuHorizontal } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { credentialCopyFor } from "../forms/field-copy.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";
import { GithubAppInstallButton } from "./github-app-install-hint.js";

interface Props {
  connection: ConnectionView;
  grant?: RowGrantControls;
  maintenance?: RowMaintenanceActions;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export function ConnectionRowActions({
  connection,
  grant,
  maintenance,
  onManage,
  onDelete,
  deleting = false,
}: Props) {
  const reauthLabel =
    connection.status === "pending" ? "Authorize" : "Re-authenticate";
  const updateLabel =
    credentialCopyFor(connection.authKind)?.action ?? "Update credential";
  const inlineFix =
    connection.status !== "expired"
      ? undefined
      : maintenance?.onReauthenticate
        ? { label: reauthLabel, run: maintenance.onReauthenticate }
        : maintenance?.onUpdateCredential
          ? { label: updateLabel, run: maintenance.onUpdateCredential }
          : undefined;
  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
        <GithubAppInstallButton connection={connection} />
        {inlineFix && (
          <Button
            variant="outline"
            className="h-8 shrink-0 px-3 text-sm font-normal"
            disabled={maintenance?.busy}
            onClick={inlineFix.run}
            data-testid={`catalog-fix-${connection.id}`}
          >
            {inlineFix.label}
          </Button>
        )}
        {grant &&
          !grant.actionHidden &&
          (grant.granted ? (
            <Badge
              variant="muted"
              className="h-8 shrink-0 gap-1.5 px-3 text-sm text-foreground"
            >
              <Checkmark size={16} className="text-success" />
              In this agent
            </Badge>
          ) : (
            <Button
              variant="outline"
              className="h-8 shrink-0 px-3 text-sm font-normal"
              onClick={() => grant.onToggle(true)}
              data-testid={`catalog-add-${connection.id}`}
            >
              <Add size={16} />
              Add to agent
            </Button>
          ))}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${connection.name}`}
            data-testid={`catalog-menu-${connection.id}`}
          >
            <OverflowMenuHorizontal size={16} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {maintenance?.onReauthenticate && (
            <DropdownMenuItem
              disabled={maintenance.busy}
              onSelect={maintenance.onReauthenticate}
              data-testid={`catalog-reauth-${connection.id}`}
            >
              {reauthLabel}
            </DropdownMenuItem>
          )}
          {maintenance?.onEditScope && (
            <DropdownMenuItem
              onSelect={maintenance.onEditScope}
              data-testid={`catalog-edit-scope-${connection.id}`}
            >
              Edit repositories &amp; permissions
            </DropdownMenuItem>
          )}
          {maintenance?.onUpdateCredential && (
            <DropdownMenuItem
              onSelect={maintenance.onUpdateCredential}
              data-testid={`catalog-update-credential-${connection.id}`}
            >
              {updateLabel}
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
            <DropdownMenuItem
              tone="danger"
              disabled={deleting}
              onSelect={onDelete}
            >
              Delete this connection
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
