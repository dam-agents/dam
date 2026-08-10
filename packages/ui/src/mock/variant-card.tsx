import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StartingOption {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  icon: ReactNode;
  badge?: ReactNode;
}

interface StartingOptionsProps {
  options: StartingOption[];
  onSelect: (option: StartingOption) => void;
  fallback?: StartingOption;
  onFallback?: () => void;
  columns?: 2 | 3;
  heading?: string;
}

export function StartingOptions({
  options,
  onSelect,
  fallback,
  onFallback,
  columns = 3,
  heading,
}: StartingOptionsProps) {
  const allOptions =
    fallback && onFallback
      ? [{ ...fallback, _isFallback: true as const }, ...options]
      : options;

  return (
    <div className={cn("mx-auto w-full", columns === 2 ? "max-w-[560px]" : "max-w-[720px]")}>
      {heading && (
        <p className="mb-3 text-[14px] font-medium text-muted-foreground">
          {heading}
        </p>
      )}
      <div className={cn("grid gap-3", columns === 2 ? "grid-cols-2" : "grid-cols-3")}>
        {allOptions.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() =>
              "_isFallback" in opt && onFallback ? onFallback() : onSelect(opt)
            }
            className="rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-4 text-left transition-all hover:shadow-lg"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-background ring-1 ring-border/50">
                  <span className="text-foreground/70">{opt.icon}</span>
                </div>
                {opt.tags && opt.tags.length > 0 && (
                  <span className="shrink-0 text-[14px] text-muted-foreground">
                    {opt.tags.join(" · ")}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[16px] font-semibold text-foreground">
                    {opt.name}
                  </p>
                  {opt.badge}
                </div>
                {opt.description && (
                  <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
                    {opt.description}
                  </p>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
