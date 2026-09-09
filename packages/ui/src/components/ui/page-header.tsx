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
    <header className={cn("mb-8", className)}>
      {actions && <div className="mb-4 flex items-center justify-end gap-2">{actions}</div>}
      <div className="flex min-h-10 min-w-0 items-center gap-3">
        <h1
          title={typeof title === "string" ? title : undefined}
          className="truncate text-2xl font-semibold tracking-[-0.65px] text-foreground md:text-[28px] md:leading-[1.25]"
        >
          {title}
        </h1>
        {adornment}
      </div>
      {description && (
        <p className="mt-3 max-w-[640px] text-sm text-balance text-muted-foreground">
          {description}
        </p>
      )}
    </header>
  );
}
