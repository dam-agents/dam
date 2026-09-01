import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WorkingDots } from "../../sessions/components/working-dots.js";

interface Props {
  icon: ReactNode;
  agentName: string;
  title: string;
  meta: string;
  working?: boolean;
  unread?: boolean;
  onOpen?: () => void;
  onDismiss?: () => void;
  children?: ReactNode;
}

export function FeedCard({
  icon,
  agentName,
  title,
  meta,
  working = false,
  unread = false,
  onOpen,
  onDismiss,
  children,
}: Props) {
  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (!onOpen) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group w-full rounded-2xl border border-border bg-card/80 p-5 text-left transition-all duration-200",
        onOpen && "cursor-pointer hover:shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            {icon}
            <span className="truncate">{agentName}</span>
          </div>
          <p
            className={cn(
              "text-[15px] leading-snug text-foreground",
              unread || working ? "font-semibold" : "font-normal",
            )}
          >
            {title}
            {working && (
              <WorkingDots
                className="ml-1 inline-flex align-middle text-accent"
                size="md"
              />
            )}
            {unread && !working && (
              <span className="ml-1.5 inline-block size-2 rounded-full bg-accent align-middle" />
            )}
          </p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="shrink-0 text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          >
            Dismiss
          </button>
        )}
      </div>

      {children}

      <div className="-mx-5 -mb-5 mt-3 flex items-center justify-between border-t border-border px-5 py-2.5">
        <span className="text-sm text-muted-foreground">{meta}</span>
        {onOpen && (
          <span className="w-[24px] text-center text-muted-foreground/20 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-foreground">
            →
          </span>
        )}
      </div>
    </div>
  );
}
