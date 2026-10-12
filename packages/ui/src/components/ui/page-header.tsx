import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const PAGE_TITLE =
  "text-2xl font-semibold tracking-[-0.65px] text-foreground md:text-[28px] md:leading-[1.25]";

interface PageHeaderProps {
  title?: ReactNode;
  leading?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  adornment?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  leading,
  description,
  actions,
  adornment,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("@container mb-8", className)}>
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
    </header>
  );
}
