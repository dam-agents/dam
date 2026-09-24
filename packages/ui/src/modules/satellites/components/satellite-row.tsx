import { OverflowMenuHorizontal } from "@carbon/icons-react";
import type { SatelliteView } from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { RowGrantControls } from "../../connections/components/catalog-connection-row.js";
import { RowGrantAction } from "../../connections/components/connection-row-actions.js";
import { SatelliteStateBadge } from "./satellite-state-badge.js";
import { SatelliteTools } from "./satellite-tools.js";

interface Props {
  satellite: SatelliteView;
  grant?: RowGrantControls;
  onRemove?: () => void;
  removing?: boolean;
}

function toolCount(n: number): string {
  return n === 1 ? "1 tool" : `${n} tools`;
}

export function SatelliteRow({
  satellite,
  grant,
  onRemove,
  removing = false,
}: Props) {
  const [toolsShown, setToolsShown] = useState(false);
  const rowId = `satellite-${satellite.name}`;
  const tag = [toolCount(satellite.tools.length), satellite.host]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-border" data-testid={rowId}>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="flex min-w-[160px] flex-1 flex-wrap items-center gap-2">
          <p className="max-w-[50%] shrink-0 truncate text-[15px] text-foreground">
            {satellite.name}
          </p>
          <SatelliteStateBadge satellite={satellite} />
          <Badge variant="muted" className="min-w-0 font-normal" title={tag}>
            <span className="truncate">{tag}</span>
          </Badge>
        </div>
        {grant && !grant.actionHidden && (
          <RowGrantAction rowId={rowId} grant={grant} />
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${satellite.name}`}
              data-testid={`${rowId}-menu`}
            >
              <OverflowMenuHorizontal size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setToolsShown((v) => !v)}>
              {toolsShown ? "Hide tools" : "Show tools"}
            </DropdownMenuItem>
            {grant?.granted && (
              <DropdownMenuItem onSelect={() => grant.onToggle(false)}>
                Remove from this agent
              </DropdownMenuItem>
            )}
            {onRemove && (
              <DropdownMenuItem
                tone="danger"
                disabled={removing}
                onSelect={onRemove}
              >
                Remove this satellite
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {satellite.description && (
        <p className="-mt-1 px-4 pb-3 text-sm text-muted-foreground">
          {satellite.description}
        </p>
      )}
      {toolsShown && <SatelliteTools tools={satellite.tools} />}
    </div>
  );
}
