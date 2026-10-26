import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useNewLayout } from "../../modules/features/hooks/use-new-layout.js";

export const PAGE_TITLE =
  "text-2xl font-semibold tracking-[-0.65px] text-foreground md:text-[28px] md:leading-[1.25]";

interface PageHeaderProps {
  title?: ReactNode;
  leading?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  adornment?: ReactNode;
  pictogram?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  leading,
  description,
  actions,
  adornment,
  pictogram,
  className,
}: PageHeaderProps) {
  const newLayout = useNewLayout();
  return (
    <header className={cn("@container mb-8", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center @lg:justify-between @lg:gap-4">
            <div className="flex min-h-10 min-w-0 items-center gap-3">
              {leading}
              {title !== undefined && (
                <h1
                  title={typeof title === "string" ? title : undefined}
                  className={cn("truncate", PAGE_TITLE)}
                >
                  {title}
                </h1>
              )}
              {adornment}
            </div>
            {actions && (
              <div className="flex shrink-0 items-center gap-2">{actions}</div>
            )}
          </div>
          {description && (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {newLayout && pictogram && (
          <span
            className="hidden shrink-0 text-muted-foreground/70 sm:block"
            aria-hidden
          >
            {pictogram}
          </span>
        )}
      </div>
    </header>
  );
}
