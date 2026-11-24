import { Renew } from "@carbon/icons-react";
import type { ConnectionToolAccess } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { timeAgo } from "@/lib/format-time";

// UNIT_BOUNDARY_DESCRIPTION: when an MCP connection's tool list was last read from its server, with a refresh that reads it again. A read that failed says why; the old list stays in use.
export function ToolListStatus({
  toolAccess,
  refreshing,
  refreshError,
  onRefresh,
}: {
  toolAccess: Pick<ConnectionToolAccess, "listedAt" | "listError"> | undefined;
  refreshing: boolean;
  refreshError: string | undefined;
  onRefresh: () => void;
}) {
  const problem = refreshError ?? toolAccess?.listError;
  return (
    <section className="flex flex-col gap-3" aria-label="Tool list">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {toolAccess?.listedAt
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
    </section>
  );
}
