import { Code, LogoGithub } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface MockChangesData {
  filesChanged: number;
  additions: number;
  deletions: number;
  repo: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
}

interface Props {
  changes: MockChangesData;
  onViewChanges: () => void;
}

export function MockChangesCard({ changes, onViewChanges }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
      <Code size={16} className="shrink-0 text-muted-foreground" />
      <div className="flex flex-1 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm text-foreground">
          {changes.filesChanged} files changed{" "}
          <span className="font-mono text-2xs tabular-nums">
            <span className="text-success">+{changes.additions}</span>{" "}
            <span className="text-danger">&minus;{changes.deletions}</span>
          </span>
        </span>
        <Badge variant="muted" size="sm" className="gap-1 max-w-full">
          <span className="truncate">
            {changes.repo} &middot; {changes.branch}
          </span>
          {changes.prNumber != null && changes.prUrl && (
            <a
              href={changes.prUrl}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              #{changes.prNumber}
            </a>
          )}
        </Badge>
        {changes.prNumber != null && changes.prUrl && (
          <a
            href={changes.prUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            <LogoGithub size={12} />
            PR #{changes.prNumber}
          </a>
        )}
      </div>
      <Button variant="outline" size="sm" onClick={onViewChanges}>
        View changes
      </Button>
    </div>
  );
}
