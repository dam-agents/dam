import { Help } from "@carbon/icons-react";

import { Tooltip } from "@/components/ui/tooltip";

const DOCS_URL = "https://docs.dam.dev";

export function DocsLinkHelpIcon() {
  return (
    <Tooltip
      side="left"
      className="w-[260px] rounded-xl border border-border bg-popover p-4 shadow-xl"
      content={
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
            <Help size={16} className="text-accent" />
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground">
              Need help?
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
              Browse guides, API references, and tutorials.
            </p>
            <a
              href={DOCS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2.5 inline-flex items-center gap-1 text-[14px] font-medium text-accent transition-colors hover:text-accent/80"
            >
              Open documentation
              <span aria-hidden>&rarr;</span>
            </a>
          </div>
        </div>
      }
    >
      <a
        href={DOCS_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Help size={18} />
      </a>
    </Tooltip>
  );
}
