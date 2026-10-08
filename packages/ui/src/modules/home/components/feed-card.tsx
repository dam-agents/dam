import { Document } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WorkingDots } from "../../sessions/components/working-dots.js";

interface ArtifactChip {
  name: string;
}

interface Props {
  icon: ReactNode;
  agentName: string;
  title: string;
  meta: string;
  working?: boolean;
  unread?: boolean;
  artifact?: ArtifactChip;
  onOpen?: () => void;
  onDismiss?: () => void;
  onArtifactClick?: () => void;
  children?: ReactNode;
}

export function FeedCard({
  icon,
  agentName,
  title,
  meta,
  working = false,
  unread = false,
  artifact,
  onOpen,
  onDismiss,
  onArtifactClick,
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
          <p className="text-[15px] leading-snug font-semibold text-foreground">
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

      {artifact && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onArtifactClick?.();
          }}
          className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 transition-colors hover:bg-muted/70"
        >
          <Document size={16} className="shrink-0 text-muted-foreground" />
          <span className="truncate text-sm text-muted-foreground">
            {artifact.name}
          </span>
        </button>
      )}

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
