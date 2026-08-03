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
import { ConnectionStatusBadge } from "./connection-status-badge.js";
import { GithubAppInstallLink } from "./github-app-install-hint.js";

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
  const reauthLabel =
    connection.status === "pending" ? "Authorize" : "Re-authenticate";
  // One source, so the menu item and the dialog it opens can't disagree.
  const updateLabel =
    credentialCopyFor(connection.authKind)?.action ?? "Update credential";
  // Recovery one click from the failure, not a hunt through the ⋮ menu.
  // Re-authentication wins when both apply — it always works.
  const inlineFix =
    connection.status !== "expired"
      ? undefined
      : maintenance?.onReauthenticate
        ? { label: reauthLabel, run: maintenance.onReauthenticate }
        : maintenance?.onUpdateCredential
          ? { label: updateLabel, run: maintenance.onUpdateCredential }
          : undefined;
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
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
          <GithubAppInstallLink connection={connection} />
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
              // Height and text size match the sibling "Add to sandbox" button.
              <Badge
                variant="muted"
                className="h-8 shrink-0 gap-1.5 px-3 text-sm text-foreground"
              >
                <Checkmark size={16} className="text-success" />
                In this sandbox
              </Badge>
            ) : (
              <Button
                variant="outline"
                className="h-8 shrink-0 px-3 text-sm font-normal"
                onClick={() => grant.onToggle(true)}
                data-testid={`catalog-add-${connection.id}`}
              >
                <Add size={16} />
                Add to sandbox
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
                Remove from this sandbox
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
      </div>
    </div>
  );
}
