import { Badge } from "@/components/ui/badge";

import { pullRequestStatus } from "../lib/pull-request-state.js";
import type { ChangeSet } from "../types.js";
import { DiffStatText } from "./diff-stat-text.js";

export function ChangeSetSummary({ changeSet }: { changeSet: ChangeSet }) {
  const { stat, commitsAhead, uncommitted, pullRequest } = changeSet;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      <span>
        {stat.files} file{stat.files !== 1 ? "s" : ""}
      </span>
      <DiffStatText additions={stat.additions} deletions={stat.deletions} />
      {commitsAhead > 0 && (
        <span>
          {commitsAhead} commit{commitsAhead !== 1 ? "s" : ""} ahead
        </span>
      )}
      {uncommitted && <span>Uncommitted changes</span>}
      {pullRequest && (
        <a
          href={pullRequest.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:underline"
        >
          <PrBadge pullRequest={pullRequest} />
        </a>
      )}
    </div>
  );
}

function PrBadge({
  pullRequest,
}: {
  pullRequest: NonNullable<ChangeSet["pullRequest"]>;
}) {
  const status = pullRequestStatus(pullRequest);
  return (
    <Badge variant={status.variant} size="sm">
      <span className={status.struck ? "line-through" : ""}>
        #{pullRequest.number}
      </span>
      {status.label && <span className="ml-1">{status.label}</span>}
    </Badge>
  );
}
