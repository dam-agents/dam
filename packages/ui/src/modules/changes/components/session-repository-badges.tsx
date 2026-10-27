import type { SessionRepository } from "agent-runtime-api";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { repositoryBadgeLabels } from "../lib/pull-request-links.js";
import { pullRequestStatus } from "../lib/pull-request-state.js";

const SHOWN_REPOSITORIES = 3;

export function SessionRepositoryBadges({
  repositories,
}: {
  repositories: readonly SessionRepository[];
}) {
  const shown = repositories.slice(0, SHOWN_REPOSITORIES);
  const labels = repositoryBadgeLabels(shown);
  const hidden = repositories.length - shown.length;

  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-1"
      aria-label="Repositories this session has pull requests in"
    >
      {shown.map((repository, index) => {
        const status = repository.pullRequest
          ? pullRequestStatus(repository.pullRequest)
          : null;
        return (
          <Badge
            key={repository.path}
            variant={status?.variant ?? "muted"}
            size="sm"
            className="max-w-full gap-1"
            title={[
              `${repository.name}${repository.branch ? ` · ${repository.branch}` : ""}`,
              repository.path,
              ...(repository.pullRequest && status?.label
                ? [
                    `Pull request #${repository.pullRequest.number}: ${status.label}`,
                  ]
                : []),
            ].join("\n")}
          >
            <span className="truncate">{labels[index]}</span>
            {repository.pullRequest && (
              <a
                href={repository.pullRequest.url}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  "hover:underline",
                  !status?.label && "text-accent",
                  status?.struck && "line-through",
                )}
                onClick={(event) => event.stopPropagation()}
              >
                #{repository.pullRequest.number}
              </a>
            )}
          </Badge>
        );
      })}
      {hidden > 0 && (
        <Badge variant="muted" size="sm">
          +{hidden}
        </Badge>
      )}
    </span>
  );
}
