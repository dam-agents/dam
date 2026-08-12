import { ArrowRight } from "@carbon/icons-react";

import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

/**
 * The harness's release list, as its template declares it. Rendered in both the
 * hover card and the confirmation: the card's copy is pointer-only, because
 * Radix takes its content out of the tab order, so the confirmation is where a
 * keyboard reaches this at all.
 *
 * No href renders nothing, so a template that publishes no notes simply has no
 * link — and no empty box holding a margin.
 */
export function ReleaseNotesLink({
  href,
  className,
}: {
  href: string | null;
  className?: string;
}) {
  if (!href) return null;
  return (
    <a
      href={href}
      {...externalLinkProps}
      className={cn(
        "inline-flex items-center gap-1.5 font-medium text-accent hover:underline",
        className,
      )}
    >
      See what changed <ArrowRight size={16} />
    </a>
  );
}
