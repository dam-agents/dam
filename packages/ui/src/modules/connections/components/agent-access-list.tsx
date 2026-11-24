import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure";

import type { AgentAccessLine } from "../hooks/use-agent-access-lines.js";
import type { ConnectionHolder } from "../hooks/use-connection-holders.js";
import { AccessSummaryLabel } from "./access-summary-label.js";
import { GrantToolAccessDialog } from "./grant-tool-access-dialog.js";

const SHOWN_AT_FIRST = 6;

function agentsLabel(count: number): string {
  return `${count} agent${count === 1 ? "" : "s"}`;
}

export function AgentAccessToggle({
  connectionId,
  count,
  open,
  onToggle,
}: {
  connectionId: string;
  count: number;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <DisclosureToggle
      open={open}
      onToggle={onToggle}
      testId={`connection-used-by-${connectionId}`}
      className="h-8 shrink-0 gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
    >
      Used by {agentsLabel(count)}
    </DisclosureToggle>
  );
}

function AgentAccessRow({
  connectionId,
  line,
  onEdit,
}: {
  connectionId: string;
  line: AgentAccessLine;
  onEdit: (agent: ConnectionHolder) => void;
}) {
  const { agent, summary } = line;
  const testId = `connection-agent-${connectionId}-${agent.id}`;
  return (
    <li
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2 @md:grid-cols-[minmax(110px,190px)_minmax(0,1fr)_auto]"
      data-testid={testId}
    >
      <span className="min-w-0 break-words text-sm font-medium text-foreground">
        {agent.name}
      </span>
      <span className="col-span-full row-start-2 min-w-0 @md:col-span-1 @md:row-start-1">
        {summary && (
          <AccessSummaryLabel summary={summary} testId={`${testId}-access`} />
        )}
      </span>
      {agent.toolAccess && (
        <Button
          variant="outline"
          size="sm"
          className="col-start-2 row-start-1 @md:col-start-3"
          onClick={() => onEdit(agent)}
          aria-label={`Tool access for ${agent.name}`}
          data-testid={`${testId}-tool-access`}
        >
          Tool access
        </Button>
      )}
    </li>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the agents that use a connection, opened inside its row on the Connections page: one line per agent with what its grant lets it do and its own Tool access. The list shows six agents first, so a connection that many agents use does not push the page down.
export function AgentAccessList({
  connection,
  lines,
}: {
  connection: ConnectionView;
  lines: readonly AgentAccessLine[];
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<ConnectionHolder | null>(null);
  const shown = showAll ? lines : lines.slice(0, SHOWN_AT_FIRST);
  const hidden = lines.length - SHOWN_AT_FIRST;
  return (
    <div
      className="mt-2 border-t border-border-hairline"
      data-testid={`connection-used-by-${connection.id}-agents`}
    >
      <ul className="divide-y divide-border-hairline">
        {shown.map((line) => (
          <AgentAccessRow
            key={line.agent.id}
            connectionId={connection.id}
            line={line}
            onEdit={setEditing}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <Button
          variant="link"
          size="inline"
          tone="muted"
          className="mt-1 mb-1 text-sm"
          onClick={() => setShowAll((was) => !was)}
          data-testid={`connection-used-by-${connection.id}-more`}
        >
          {showAll ? "Show fewer" : `Show ${hidden} more`}
        </Button>
      )}
      {editing?.toolAccess && (
        <GrantToolAccessDialog
          agent={editing}
          connection={connection}
          access={editing.toolAccess}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
