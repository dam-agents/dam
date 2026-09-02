import { Launch } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

type InstallHintConnection = Pick<
  ConnectionView,
  "templateId" | "host" | "appSlug" | "status"
>;

export function activeInstallUrl(
  connection: InstallHintConnection,
): string | null {
  if (connection.status !== "active") return null;
  return githubAppInstallUrl(connection);
}

export function GithubAppInstallButton({
  connection,
}: {
  connection: InstallHintConnection;
}) {
  const url = activeInstallUrl(connection);
  if (!url) return null;
  return (
    <Button asChild className="h-8 shrink-0 px-3 text-sm">
      <a href={url} {...externalLinkProps}>
        Install {getBrand().name} app <Launch size={13} aria-hidden />
      </a>
    </Button>
  );
}
