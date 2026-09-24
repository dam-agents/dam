import { Bot } from "@carbon/icons-react";
import type { DelegationNode } from "api-server-api";
import { type ReactNode, useState } from "react";

import { ActivityBlock } from "../../sessions/components/activity-block.js";
import { countByStatus, flattenIds } from "../lib/delegation-state.js";
import { DelegationCards } from "./delegation-cards.js";

interface Props {
  verb: string;
  nodes: readonly DelegationNode[];
  driverAgentId: string;
  fallback?: ReactNode;
  footer?: ReactNode;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a delegation renders. Both the block
 * a fan-out's chip carries and the live one standing in for it before the chip
 * lands are this component with different nodes, so a child looks and behaves
 * the same whichever is speaking for it.
 */
export function DelegationShell({
  verb,
  nodes,
  driverAgentId,
  fallback,
  footer,
}: Props) {
  const [open, setOpen] = useState(true);
  const counts = countByStatus(nodes);
  const total = nodes.length > 0 ? flattenIds(nodes).length : 0;

  return (
    <ActivityBlock
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <Bot size={14} className="shrink-0 text-accent" aria-hidden />
          <span className="truncate">
            {verb} {total} temporary agent{total === 1 ? "" : "s"}
          </span>
          {counts.running > 0 && (
            <span className="shrink-0 text-[11px]">
              {counts.running} working
            </span>
          )}
          {counts.failed > 0 && (
            <span className="shrink-0 text-[11px] text-danger">
              {counts.failed} failed
            </span>
          )}
        </span>
      }
    >
      {nodes.length > 0 ? (
        <DelegationCards nodes={nodes} driverAgentId={driverAgentId} />
      ) : (
        fallback
      )}
      {footer}
    </ActivityBlock>
  );
}
