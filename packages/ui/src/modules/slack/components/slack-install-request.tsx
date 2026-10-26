import { ArrowUpRight } from "@carbon/icons-react";

import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";

export function SlackInstallRequest({
  href,
  workspaceLabel = "workspace",
}: {
  href: string;
  workspaceLabel?: string;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {getBrand().name} not installed in your {workspaceLabel}?{" "}
      <a
        href={href}
        {...externalLinkProps}
        className="inline-flex items-center gap-1 font-medium text-accent hover:underline"
      >
        Request it <ArrowUpRight size={14} />
      </a>
    </p>
  );
}
