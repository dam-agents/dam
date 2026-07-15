import { Add, Checkmark, OverflowMenuHorizontal } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { StatusBadge } from "./connection-row.js";

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
  onDelete: () => void;
  deleting: boolean;
}

export function CatalogConnectionRow({
  connection,
  subtitle,
  grant,
  onDelete,
  deleting,
}: Props) {
  return (
    <div
      data-testid={`catalog-connection-${connection.id}`}
      className="flex items-center gap-2 px-4 py-3"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[15px] text-foreground">
            {connection.name}
          </p>
          {connection.status !== "active" && (
            <StatusBadge status={connection.status} />
          )}
        </div>
        <p className="truncate text-[14px] text-muted-foreground">{subtitle}</p>
      </div>
      {grant &&
        !grant.actionHidden &&
        (grant.granted ? (
          <span className="inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[14px] text-foreground">
            <Checkmark size={16} className="text-success" />
            In this sandbox
          </span>
        ) : (
          <Button
            variant="outline"
            className="h-[32px] shrink-0 px-3 text-[14px] font-normal"
            onClick={() => grant.onToggle(true)}
            data-testid={`catalog-add-${connection.id}`}
          >
            <Add size={16} />
            Add to sandbox
          </Button>
        ))}
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
          <DropdownMenuItem tone="danger" disabled={deleting} onSelect={onDelete}>
            Delete this connection
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
