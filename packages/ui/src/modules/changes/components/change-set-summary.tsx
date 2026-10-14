import { Launch } from "@carbon/icons-react";
import type { ChangeSet, ChangeSetDiff } from "agent-runtime-api";

import { DiffStatText } from "./diff-stat-text.js";

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ChangeSetSummary({
  changeSet,
  diff,
}: {
  changeSet: ChangeSet;
  diff: ChangeSetDiff | undefined;
}) {
  const files = diff?.files ?? [];
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-4 py-2 text-xs text-muted-foreground">
      <span>{plural(files.length, "file")}</span>
      <DiffStatText stat={{ additions, deletions }} />
      <span>
        {changeSet.baseRef
          ? `${plural(changeSet.commitsAhead, "commit")} ahead of ${changeSet.baseRef}`
          : "no base branch"}
      </span>
      {changeSet.uncommitted && <span>uncommitted changes</span>}
      {changeSet.pullRequest && (
        <a
          href={changeSet.pullRequest.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          Pull request #{changeSet.pullRequest.number}
          <Launch size={12} />
        </a>
      )}
    </div>
  );
}
