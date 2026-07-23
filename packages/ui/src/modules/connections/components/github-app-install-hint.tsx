import { Launch } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

type InstallHintConnection = Pick<
  ConnectionView,
  "templateId" | "host" | "appSlug" | "status"
>;

function activeInstallUrl(connection: InstallHintConnection): string | null {
  if (connection.status !== "active") return null;
  return githubAppInstallUrl(connection);
}

/** Shared banner shown once per provider group when at least one connection
 *  has a GitHub App install step. */
export function GithubAppInstallHint({
  connections,
}: {
  connections: readonly InstallHintConnection[];
}) {
  if (!connections.some((c) => activeInstallUrl(c) !== null)) return null;
  return (
    <p className="mx-4 mt-3 rounded-md border border-border bg-muted/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
      <strong className="text-foreground/80">
        GitHub App connections need one more step.
      </strong>{" "}
      To let {getBrand().name} work with your private repos, install the app on
      the organization that owns them.
    </p>
  );
}

/** Per-row link to the connection's GitHub App installation page. */
export function GithubAppInstallLink({
  connection,
}: {
  connection: InstallHintConnection;
}) {
  const url = activeInstallUrl(connection);
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
    >
      Install on GitHub <Launch size={13} aria-hidden />
    </a>
  );
}
