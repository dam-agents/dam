import type { ReactElement } from "react";

import { Tooltip } from "@/components/ui/tooltip";

/**
 * UNIT_BOUNDARY_DESCRIPTION: A text that names an agent's connections, cut
 * short to three, with a tooltip that lists every one of them. A text with
 * nothing left out gets no tooltip.
 */
export function ConnectionNamesTooltip({
  connections,
  children,
}: {
  connections: { names: readonly string[]; more: number } | null;
  children: ReactElement;
}) {
  if (!connections || connections.more === 0) return children;
  return (
    <Tooltip
      side="top"
      content={connections.names.map((name) => (
        <span key={name} className="block">
          {name}
        </span>
      ))}
    >
      {children}
    </Tooltip>
  );
}
