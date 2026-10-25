import { Button } from "@/components/ui/button";

import { useRetryWorkspace } from "../api/mutations.js";
import { useAgent } from "../api/queries.js";
import {
  workspaceRetryNote,
  workspaceStepLabel,
} from "../lib/workspace-failure.js";

export function WorkspaceFailureNotice({
  agentId,
}: {
  agentId: string | null;
}) {
  const agent = useAgent(agentId);
  const retry = useRetryWorkspace();
  if (!agent || agent.workspaceFailures.length === 0) return null;
  return (
    <>
      {agent.workspaceFailures.map((failure) => (
        <div
          key={failure.kind}
          role="alert"
          className="flex items-center gap-2 border-b border-border/50 bg-warning/10 px-4 py-2 text-xs text-foreground"
          data-testid="workspace-failure-notice"
        >
          <span className="flex-1">
            <span className="font-medium">
              {workspaceStepLabel(failure.kind)} failed.
            </span>{" "}
            {failure.error}
            {workspaceRetryNote(failure)}
          </span>
          {failure.settled && (
            <Button
              size="sm"
              variant="outline"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate({
                  id: agent.id,
                  kind: failure.kind as "workspace-seed" | "workspace-command",
                })
              }
            >
              Retry
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
