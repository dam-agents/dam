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

import { ConnectionStatusBadge } from "./connection-status-badge.js";
import { GithubAppInstallLink } from "./github-app-install-hint.js";

export interface RowGrantControls {
  granted: boolean;
  onToggle: (on: boolean) => void;
  /** Hide the Add/In-this-sandbox affordance; the ⋮ menu keeps Remove. */
  actionHidden?: boolean;
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
}

export function CatalogConnectionRow({
  connection,
  subtitle,
  grant,
  onManage,
  onDelete,
  deleting = false,
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
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
          <GithubAppInstallLink connection={connection} />
          {grant &&
            !grant.actionHidden &&
            (grant.granted ? (
              // Height and text size match the sibling "Add to sandbox" button.
              <Badge
                variant="muted"
                className="h-[32px] shrink-0 gap-1.5 px-3 text-sm text-foreground"
              >
                <Checkmark size={16} className="text-success" />
                In this sandbox
              </Badge>
            ) : (
              <Button
                variant="outline"
                className="h-[32px] shrink-0 px-3 text-sm font-normal"
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
