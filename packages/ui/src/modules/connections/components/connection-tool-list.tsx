import { Renew } from "@carbon/icons-react";
import type { ConnectionTool, ConnectionToolAccess } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { timeAgo } from "@/lib/format-time";

function ToolGroup({
  title,
  tools,
  testId,
}: {
  title: string;
  tools: readonly ConnectionTool[];
  testId: string;
}) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">
        {title} ({tools.length})
      </p>
      {tools.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {tools.map((tool) => (
            <li
              key={tool.name}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-foreground"
            >
              {tool.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the tools an MCP connection's server listed, the ones that read first, so the owner sees what read only lets through. The list is read when the connection is made; refresh reads it again, and a read that failed says why.
export function ConnectionToolList({
  toolAccess,
  refreshing,
  refreshError,
  onRefresh,
}: {
  toolAccess: Pick<ConnectionToolAccess, "tools" | "listedAt" | "listError">;
  refreshing: boolean;
  refreshError: string | undefined;
  onRefresh: () => void;
}) {
  const tools = toolAccess.tools;
  const problem = refreshError ?? toolAccess.listError;
  return (
    <section className="flex flex-col gap-3" aria-label="Tools">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {toolAccess.listedAt
            ? `Tools listed ${timeAgo(toolAccess.listedAt)}`
            : "The tool list has not been read yet."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={refreshing}
          data-testid="tool-access-refresh"
        >
          <Renew size={16} aria-hidden />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>
      {problem && (
        <Callout tone="warning" size="sm" data-testid="tool-access-list-error">
          Couldn&apos;t read the tool list: {problem}
        </Callout>
      )}
      {tools && (
        <>
          <ToolGroup
            title="Read tools"
            tools={tools.filter((t) => t.readOnly)}
            testId="tool-access-read-tools"
          />
          <ToolGroup
            title="Write tools"
            tools={tools.filter((t) => !t.readOnly)}
            testId="tool-access-write-tools"
          />
        </>
      )}
    </section>
  );
}
