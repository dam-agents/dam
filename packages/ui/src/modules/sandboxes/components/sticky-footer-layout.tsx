import { type ReactNode, useEffect } from "react";

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
  const hasFooter = footer !== undefined;

  // Publishes the bar on the root so anything floating at the bottom of the
  // viewport can clear it — see `--bottom-bar-inset`. Marking the root rather
  // than exposing a prop keeps the pages that have a bar from having to tell
  // every floating control about it.
  useEffect(() => {
    if (!hasFooter) return;
    document.documentElement.dataset.bottomBar = "";
    return () => {
      delete document.documentElement.dataset.bottomBar;
    };
  }, [hasFooter]);

  return (
    <div className="flex h-full flex-col pb-[calc(52px_+_env(safe-area-inset-bottom))] md:pb-0">
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer && (
        <div className="border-t border-border bg-background">
          <div
            className={cn(
              "mx-auto flex h-[var(--bottom-bar-h)] w-full items-center justify-end gap-3 px-4 md:px-8",
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
