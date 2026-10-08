import { Close, ConnectionSignal } from "@carbon/icons-react";
import { type ReactNode, useEffect, useState } from "react";

interface DiscoveryTooltipProps {
  children: ReactNode;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  open: boolean;
  onDismiss: () => void;
  delay?: number;
}

export function DiscoveryTooltip({
  children,
  title,
  message,
  actionLabel,
  onAction,
  open,
  onDismiss,
  delay = 1500,
}: DiscoveryTooltipProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!open) {
      setVisible(false);
      return;
    }
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [open, delay]);

  return (
    <div className="relative">
      {children}
      {visible && (
        <div className="absolute bottom-full left-0 mb-3 z-50 anim-in">
          <div className="relative w-[300px] rounded-xl border border-border bg-popover p-4 shadow-xl">
            <button
              type="button"
              onClick={onDismiss}
              className="absolute top-3 right-3 flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Close size={14} />
            </button>

            <div className="flex items-start gap-3 pr-5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                <ConnectionSignal size={16} className="text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold text-foreground">
                  {title}
                </p>
                <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                  {message}
                </p>
                {actionLabel && onAction && (
                  <button
                    type="button"
                    onClick={() => {
                      onAction();
                      onDismiss();
                    }}
                    className="mt-2.5 inline-flex items-center gap-1 text-[14px] font-medium text-accent transition-colors hover:text-accent/80"
                  >
                    {actionLabel}
                    <span aria-hidden>&rarr;</span>
                  </button>
                )}
              </div>
            </div>

            {/* Arrow pointing down */}
            <div className="absolute top-full left-5 -mt-px">
              <div className="h-2.5 w-2.5 rotate-45 border-b border-r border-border bg-popover" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
