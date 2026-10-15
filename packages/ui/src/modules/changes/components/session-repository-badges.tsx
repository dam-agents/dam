import type { SessionRepository } from "agent-runtime-api";

import { Badge } from "@/components/ui/badge";

import { repositoryShortName } from "../lib/pull-request-links.js";

const SHOWN_REPOSITORIES = 3;

export function SessionRepositoryBadges({
  repositories,
}: {
  repositories: readonly SessionRepository[];
}) {
  const shown = repositories.slice(0, SHOWN_REPOSITORIES);
  const hidden = repositories.length - shown.length;

  return (
    <span
      className="flex min-w-0 flex-wrap items-center gap-1"
      aria-label="Repositories this session touched"
    >
      {shown.map((repository) => (
        <Badge
          key={repository.path}
          variant="muted"
          size="sm"
          className="max-w-full gap-1"
          title={`${repository.name}${repository.branch ? ` · ${repository.branch}` : ""}\n${repository.path}`}
        >
          <span className="truncate">
            {repositoryShortName(repository.name)}
          </span>
          {repository.pullRequest && (
            <a
              href={repository.pullRequest.url}
              target="_blank"
              rel="noreferrer"
              className="text-accent hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              #{repository.pullRequest.number}
            </a>
          )}
        </Badge>
      ))}
      {hidden > 0 && (
        <Badge variant="muted" size="sm">
          +{hidden}
        </Badge>
      )}
    </span>
  );
}
