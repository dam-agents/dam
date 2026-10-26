import type { ConnectionView } from "api-server-api";

import { nestConnections } from "../lib/connection-hierarchy.js";
import { ConnectionRow, type ConnectionRowControls } from "./connection-row.js";
import { ParentConnectionBlock } from "./parent-connection-block.js";

interface Props extends ConnectionRowControls {
  connections: readonly ConnectionView[];
  onNewChild?: (parent: ConnectionView) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the rows of one provider's connections, with each GitHub sign-in or GitHub App installation followed by the connections made from it. A connection whose sign-in or installation is not in the list is an ordinary row.
export function ConnectionRows({
  connections,
  onNewChild,
  ...controls
}: Props) {
  return nestConnections(connections).map(({ connection, children }) =>
    children ? (
      <ParentConnectionBlock
        key={connection.id}
        parent={connection}
        childConnections={children}
        onNewChild={onNewChild && (() => onNewChild(connection))}
        {...controls}
      />
    ) : (
      <ConnectionRow
        key={connection.id}
        connection={connection}
        {...controls}
      />
    ),
  );
}
