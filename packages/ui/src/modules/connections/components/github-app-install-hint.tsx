import { Launch } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import type { ReactNode } from "react";

import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

type InstallHintConnection = Pick<
  ConnectionView,
  "templateId" | "host" | "appSlug" | "status" | "parentId"
>;

export function activeInstallUrl(
  connection: InstallHintConnection,
): string | null {
  if (connection.status !== "active" || connection.parentId) return null;
  return githubAppInstallUrl(connection);
}

export const INSTALL_REACH = "on each account whose repositories agents need";

export function GithubAppInstallLink({
  url,
  testId,
  children,
}: {
  url: string;
  testId?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={url}
      {...externalLinkProps}
      data-testid={testId}
      className="inline-flex items-center gap-1 font-medium text-accent underline-offset-2 hover:underline"
    >
      {children ?? `Install the ${getBrand().name} app`}
      <Launch size={12} aria-hidden />
    </a>
  );
}
