import type { ConnectionView } from "api-server-api";

import { cn } from "@/lib/utils";

import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

// Installing the GitHub App is only meaningful once the connection is
// authorized, so the link is gated on an active status.
export function GithubAppInstallLink({
  connection,
  className,
}: {
  connection: Pick<
    ConnectionView,
    "templateId" | "host" | "appSlug" | "status"
  >;
  className?: string;
}) {
  const url = githubAppInstallUrl(connection);
  if (!url || connection.status !== "active") return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "shrink-0 text-[14px] font-normal text-foreground hover:underline",
        className,
      )}
    >
      Install on GitHub
    </a>
  );
}
