import { LogoGithub } from "@carbon/icons-react";
import type { SessionRepository } from "agent-runtime-api";

import { pullRequestLinks } from "../lib/pull-request-links.js";

export function SessionPullRequests({
  repositories,
}: {
  repositories: readonly SessionRepository[] | undefined;
}) {
  const links = pullRequestLinks(repositories);
  if (links.length === 0) return null;

  return (
    <span
      className="flex min-w-0 shrink items-center gap-3"
      aria-label="Pull requests of this session"
    >
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          title={link.title}
          className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <LogoGithub size={14} className="shrink-0" />
          <span className="truncate">{link.label}</span>
        </a>
      ))}
    </span>
  );
}
