import { Launch } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Callout } from "@/components/ui/callout";
import { externalLinkProps } from "@/lib/external-link";

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
    <Callout
      tone="muted"
      size="sm"
      className="mx-4 mt-3 text-sm leading-relaxed text-muted-foreground"
    >
      <strong className="text-foreground/80">
        GitHub app connections need one more step.
      </strong>{" "}
      To let {getBrand().name} work with your private repos, install the app on
      the organization that owns them.
    </Callout>
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
      {...externalLinkProps}
      className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
    >
      Install on GitHub <Launch size={13} aria-hidden />
    </a>
  );
}
