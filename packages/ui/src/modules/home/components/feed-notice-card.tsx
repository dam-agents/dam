import type { ReactNode } from "react";

interface Props {
  testId: string;
  warning: boolean;
  meta: ReactNode;
  headline: string;
  dismiss: { title: string; onDismiss: () => void } | null;
  children: ReactNode;
  footerStart?: ReactNode;
  footerEnd: ReactNode;
}

export function FeedNoticeCard({
  testId,
  warning,
  meta,
  headline,
  dismiss,
  children,
  footerStart,
  footerEnd,
}: Props) {
  return (
    <div
      data-testid={testId}
      className="group w-full rounded-lg border border-border bg-card/80 p-5 text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {warning && (
              <span className="size-2 shrink-0 rounded-full bg-warning" />
            )}
            {meta}
          </div>
          <p className="text-md leading-snug font-semibold text-foreground">
            {headline}
          </p>
        </div>
        {dismiss && (
          <button
            type="button"
            onClick={dismiss.onDismiss}
            title={dismiss.title}
            className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
          >
            Dismiss
          </button>
        )}
      </div>

      {children}

      <div className="-mx-5 -mb-5 mt-3 flex items-center justify-between gap-2 border-t border-border px-5 py-2.5">
        <span className="text-sm text-muted-foreground">{footerStart}</span>
        <div className="flex items-center gap-2">{footerEnd}</div>
      </div>
    </div>
  );
}
