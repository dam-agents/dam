import type { ConnectionView } from "api-server-api";

import { CARD_SURFACE } from "@/components/ui/card";

import { nestConnections } from "../lib/connection-hierarchy.js";
import { parentCardTitles } from "../lib/github-card.js";
import { ConnectionRow, type ConnectionRowControls } from "./connection-row.js";
import { ParentConnectionBlock } from "./parent-connection-block.js";

interface Props extends ConnectionRowControls {
  connections: readonly ConnectionView[];
  onNewChild?: (parent: ConnectionView) => void;
  cards?: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: one provider's connections, each GitHub sign-in or GitHub App installation as a card of the connections made from it. With cards, every other connection is a card of one row and no header, since an agent holds it directly; without, it is a row of the list it sits in. A connection whose sign-in or installation is not in the list is an ordinary connection.
export function ConnectionRows({
  connections,
  onNewChild,
  cards = false,
  ...controls
}: Props) {
  const entries = nestConnections(connections);
  const titles = parentCardTitles(
    entries.flatMap((e) => (e.children ? [e.connection] : [])),
    controls.templateById,
  );
  return entries.map(({ connection, children }) =>
    children ? (
      <ParentConnectionBlock
        key={connection.id}
        parent={connection}
        title={titles.get(connection.id) ?? connection.name}
        childConnections={children}
        onNewChild={onNewChild && (() => onNewChild(connection))}
        {...controls}
      />
    ) : cards ? (
      <div
        key={connection.id}
        className={`${CARD_SURFACE} overflow-hidden`}
        data-testid={`connection-card-${connection.id}`}
      >
        <ConnectionRow connection={connection} {...controls} bare />
      </div>
    ) : (
      <ConnectionRow
        key={connection.id}
        connection={connection}
        {...controls}
      />
    ),
  );
}
