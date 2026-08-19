import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  adornment?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  adornment,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("@container mb-8", className)}>
      <div className="flex flex-col @lg:flex-row @lg:flex-wrap @lg:items-center @lg:justify-between @lg:gap-x-4">
        {}
        <div className="order-1 flex min-h-10 min-w-0 items-center gap-3">
          <h1
            title={typeof title === "string" ? title : undefined}
            className="truncate text-2xl font-semibold tracking-[-0.65px] text-foreground md:text-[28px] md:leading-[1.25]"
          >
            {title}
          </h1>
          {adornment}
        </div>
        {actions && (
          <div className="order-3 mt-3 flex shrink-0 items-center gap-2 @lg:order-2 @lg:mt-0">
            {actions}
          </div>
        )}
        {description && (
          <p className="order-2 mt-3 text-sm text-balance text-muted-foreground @lg:order-3 @lg:w-full">
            {description}
          </p>
        )}
      </div>
    </header>
  );
}
