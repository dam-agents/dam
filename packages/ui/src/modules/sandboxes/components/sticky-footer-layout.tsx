import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface Props {
  footer?: ReactNode;
  footerClassName?: string;
  children: ReactNode;
}

export function StickyFooterLayout({
  footer,
  footerClassName,
  children,
}: Props) {
  return (
    <div className="flex h-full flex-col pb-[calc(52px_+_env(safe-area-inset-bottom))] md:pb-0">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && (
        <div className="border-t border-border bg-background">
          <div
            className={cn(
              "mx-auto flex h-[52px] w-full items-center justify-end gap-3 px-4 md:h-[70px] md:px-8",
              footerClassName,
            )}
          >
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}
