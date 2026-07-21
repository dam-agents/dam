import { Launch } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";

import { getBrand } from "../../../brand.js";
import { githubAppInstallUrl } from "../lib/github-app-install-url.js";

export function GithubAppInstallHint({
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
    <div className="mt-2.5 flex flex-wrap items-center gap-x-10 gap-y-1.5 rounded-md border border-border bg-muted/40 px-3.5 py-2.5">
      <p className="min-w-0 flex-1 basis-[280px] text-[13px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground/80">Connecting is step one.</strong>{" "}
        To let {getBrand().name} work with your private repos, install the app
        on the organization that owns them.
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
      >
        Install on GitHub <Launch size={13} aria-hidden />
      </a>
    </div>
  );
}
