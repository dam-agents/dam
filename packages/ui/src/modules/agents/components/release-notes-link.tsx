import { Launch } from "@carbon/icons-react";

import { externalLinkProps, isExternalHttpUrl } from "@/lib/external-link";
import { cn } from "@/lib/utils";

export function ReleaseNotesLink({
  href,
  className,
}: {
  href: string | null;
  className?: string;
}) {
  if (!href || !isExternalHttpUrl(href)) return null;
  return (
    <a
      href={href}
      {...externalLinkProps}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-accent hover:underline",
        className,
      )}
    >
      See what changed <Launch size={16} />
    </a>
  );
}
