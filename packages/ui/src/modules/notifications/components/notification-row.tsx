import { Close, Time } from "@carbon/icons-react";

import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { timeAgo } from "../../../lib/format-time.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
import { approvalDetail, approvalHeadline } from "../lib/approval-copy.js";
import type { NotificationItem } from "../lib/notification-types.js";

interface Props {
  item: NotificationItem;
  agentName: string;
  onOpen?: () => void;
  onDismiss?: () => void;
}

export function NotificationRow({ item, agentName, onOpen, onDismiss }: Props) {
  const now = useNow(60_000);
  const meta = item.at ? timeAgo(item.at, now) : "";

  if (item.type === "approval-tool" || item.type === "approval-network") {
    return (
      <ApprovalRow
        item={item}
        agentName={agentName}
        meta={meta}
        onDismiss={onDismiss}
      />
    );
  }

  return (
    <SessionRow
      item={item}
      agentName={agentName}
      meta={meta}
      onOpen={onOpen}
      onDismiss={onDismiss}
    />
  );
}

function ApprovalRow({
  item,
  agentName,
  meta,
  onDismiss,
}: {
  item: NotificationItem & {
    type: "approval-tool" | "approval-network";
  };
  agentName: string;
  meta: string;
  onDismiss?: () => void;
}) {
  return (
    <div className="group relative rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">{agentName}</span>
        <span className="shrink-0 text-sm text-muted-foreground">{meta}</span>
      </div>
      <p className="mt-1 text-sm text-foreground">
        {approvalHeadline(item.approval)}
      </p>
      <p className="mt-0.5 truncate font-mono text-sm text-muted-foreground">
        {approvalDetail(item.approval)}
      </p>
      {onDismiss && <DismissButton onClick={onDismiss} />}
    </div>
  );
}

function SessionRow({
  item,
  agentName,
  meta,
  onOpen,
  onDismiss,
}: {
  item: NotificationItem & { type: "running" | "unread" };
  agentName: string;
  meta: string;
  onOpen?: () => void;
  onDismiss?: () => void;
}) {
  const isRunning = item.type === "running";
  const isUnread = item.type === "unread";

  return (
    <div
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (onOpen && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        onOpen && "cursor-pointer hover:bg-muted/50",
      )}
    >
      <div className="flex w-5 shrink-0 items-center justify-center">
        {item.session.scheduleId ? (
          <Time size={16} className="text-muted-foreground" />
        ) : isRunning ? (
          <span className="size-2 rounded-full bg-accent" />
        ) : isUnread ? (
          <span className="size-2 rounded-full bg-accent" />
        ) : (
          <span className="size-2" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {item.session.title ?? "Session"}
          {isRunning && (
            <WorkingDots
              className="ml-1.5 inline-flex align-middle text-accent"
              size="md"
            />
          )}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">{agentName}</p>
      </div>
      <span className="shrink-0 text-sm text-muted-foreground">{meta}</span>
      {onDismiss && <DismissButton onClick={onDismiss} />}
    </div>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Dismiss"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="absolute right-2 top-2 flex items-center justify-center rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
    >
      <Close size={16} />
    </button>
  );
}
