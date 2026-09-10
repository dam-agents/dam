import { Time } from "@carbon/icons-react";

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
}

export function NotificationRow({ item, agentName, onOpen }: Props) {
  const now = useNow(60_000);
  const meta = item.at ? timeAgo(item.at, now) : "";

  if (item.type === "approval-tool" || item.type === "approval-network") {
    return <ApprovalRow item={item} agentName={agentName} meta={meta} />;
  }

  return (
    <SessionRow item={item} agentName={agentName} meta={meta} onOpen={onOpen} />
  );
}

function ApprovalRow({
  item,
  agentName,
  meta,
}: {
  item: NotificationItem & {
    type: "approval-tool" | "approval-network";
  };
  agentName: string;
  meta: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
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
    </div>
  );
}

function SessionRow({
  item,
  agentName,
  meta,
  onOpen,
}: {
  item: NotificationItem & { type: "running" | "unread" };
  agentName: string;
  meta: string;
  onOpen?: () => void;
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
        "flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        onOpen && "cursor-pointer hover:bg-muted/50",
      )}
    >
      <div className="flex shrink-0 items-center justify-center w-5">
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
    </div>
  );
}
