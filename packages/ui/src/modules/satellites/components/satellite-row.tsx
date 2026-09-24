import { OverflowMenuHorizontal, Satellite } from "@carbon/icons-react";
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
        <div className="flex min-w-[160px] flex-1 items-center gap-2">
          <Satellite size={16} className="shrink-0 text-foreground/80" />
          <p
            className="max-w-[50%] shrink-0 truncate text-[15px] text-foreground"
            title={satellite.description ?? undefined}
          >
            {satellite.name}
          </p>
          <Badge variant="muted" className="min-w-0 font-normal" title={tag}>
            <span className="truncate">{tag}</span>
          </Badge>
          {(!satellite.online || satellite.draining) && (
            <SatelliteStateBadge satellite={satellite} />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1.5">
          {grant && !grant.actionHidden && (
            <RowGrantAction rowId={rowId} grant={grant} />
          )}
        </div>
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
      {toolsShown && <SatelliteTools tools={satellite.tools} />}
    </div>
  );
}
