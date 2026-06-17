import type { ConnectionView } from "api-server-api";

import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

// Installing the GitHub App is only meaningful once the connection is
// authorized, so the link is gated on an active status.
export function GithubAppInstallLink({
  connection,
}: {
  connection: Pick<
    ConnectionView,
    "templateId" | "host" | "appSlug" | "status"
  >;
}) {
  const url = githubAppInstallUrl(connection);
  if (!url || connection.status !== "active") return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="shrink-0 text-[13px] font-medium text-foreground hover:underline"
    >
      Install on GitHub
    </a>
  );
}
