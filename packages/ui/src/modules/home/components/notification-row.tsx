import { Document } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type ChannelKind = "agent" | "slack" | "telegram" | "schedule" | "approval";

interface ArtifactChip {
  name: string;
}

interface Props {
  channelIcon: ReactNode;
  channelKind: ChannelKind;
  agentName: string;
  action: string;
  channel?: string;
  meta: string;
  working?: boolean;
  unread?: boolean;
  read?: boolean;
  artifact?: ArtifactChip;
  onOpen?: () => void;
  onDismiss?: () => void;
  onArtifactClick?: () => void;
  children?: ReactNode;
  forceHover?: boolean;
}

const iconBg: Record<ChannelKind, string> = {
  agent: "bg-[#f2f4f8] text-foreground dark:bg-white/10",
  slack:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  telegram:
    "bg-white border border-[#dde1e6] dark:bg-white/5 dark:border-white/10",
  schedule:
    "bg-[#edf5ff] text-[#0f62fe] dark:bg-[#0f62fe]/15 dark:text-[#78a9ff]",
  approval: "bg-warning/10 text-warning",
};

export function NotificationRow({
  channelIcon,
  channelKind,
  agentName,
  action,
  channel,
  meta,
  working = false,
  unread = false,
  read = false,
  artifact,
  onOpen,
  onDismiss,
  onArtifactClick,
  children,
  forceHover = false,
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
        "group flex w-full gap-3 rounded-xl px-3 py-3 text-left transition-colors",
        onOpen && "cursor-pointer hover:bg-muted/50",
        forceHover && onOpen && "bg-muted/50",
        unread && "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            iconBg[channelKind],
          )}
        >
          {channelIcon}
        </div>
        {working && (
          <span className="working-dots absolute -left-[8px] top-0 flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {unread && !working && (
          <span className="absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[15px] leading-snug">
          <span className={cn("text-foreground", !read && "font-semibold")}>
            {agentName}
          </span>
          <span className="text-muted-foreground"> {action}</span>
          {channel && (
            <span className="text-muted-foreground/60"> #{channel}</span>
          )}
        </p>

        <p className="mt-0.5 text-sm text-muted-foreground">{meta}</p>

        {artifact && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onArtifactClick?.();
            }}
            className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 transition-all hover:border-border hover:bg-muted/80 hover:shadow-sm"
          >
            <Document size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm text-muted-foreground">
              {artifact.name}
            </span>
          </button>
        )}

        {children}
      </div>

      <div className="flex shrink-0 items-start gap-1 pt-0.5">
        {onDismiss && (
          <button
            type="button"
            className={cn(
              "text-sm text-muted-foreground transition-all group-hover:opacity-100 hover:text-foreground",
              forceHover ? "opacity-100" : "opacity-0",
            )}
            onClick={(event) => {
              event.stopPropagation();
              onDismiss();
            }}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
