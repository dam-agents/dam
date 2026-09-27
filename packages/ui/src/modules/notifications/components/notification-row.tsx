import {
  Document,
  EdgeDevice,
  OverflowMenuVertical,
  Settings,
  Time,
  Warning,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

import { timeAgo } from "../../../lib/format-time.js";
import type { AgentView } from "../../../types.js";
import { useApprovalActions } from "../../approvals/hooks/use-approval-actions.js";
import { approvalDetail, approvalHeadline } from "../lib/approval-copy.js";
import type { NotificationItem } from "../lib/notification-types.js";

type ChannelKind = "agent" | "slack" | "telegram" | "schedule" | "approval";

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

function channelKindFor(
  item: NotificationItem,
  agents: readonly AgentView[],
): ChannelKind {
  if (item.type === "approval-tool" || item.type === "approval-network")
    return "approval";
  if (item.session.scheduleId) return "schedule";
  if (item.session.threadTs) return "slack";
  const agent = agents.find((a) => a.id === item.agentId);
  if (agent?.channels.some((c) => c.type === "slack")) return "slack";
  return "agent";
}

function channelIcon(kind: ChannelKind) {
  switch (kind) {
    case "schedule":
      return <Time size={16} />;
    case "slack":
      return <img src="/icons/slack.svg" alt="Slack" className="size-4" />;
    case "telegram":
      return (
        <img src="/icons/telegram.svg" alt="Telegram" className="size-4" />
      );
    case "approval":
      return <Warning size={16} />;
    case "agent":
      return <EdgeDevice size={16} />;
  }
}

interface Props {
  item: NotificationItem;
  agentName: string;
  agents?: readonly AgentView[];
  onOpen?: () => void;
  onArtifactClick?: () => void;
  onDismiss?: () => void;
}

export function NotificationRow({
  item,
  agentName,
  agents,
  onOpen,
  onArtifactClick,
  onDismiss,
}: Props) {
  const now = useNow(60_000);
  const meta = item.at ? timeAgo(item.at, now) : "";
  const kind = channelKindFor(item, agents ?? []);

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

  const isRunning = item.type === "running";
  const isUnread = item.type === "unread";
  const isRead = item.type === "read";

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
        "group flex w-full gap-3 rounded-xl px-4 py-4 text-left transition-colors",
        onOpen && "cursor-pointer hover:bg-muted/50",
        (isUnread || isRunning) && "bg-[#f4f4f4]/50 dark:bg-white/[0.03]",
      )}
    >
      <div className="relative shrink-0 pt-0.5">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl",
            iconBg[kind],
          )}
        >
          {channelIcon(kind)}
        </div>
        {isRunning && (
          <span className="working-dots absolute -left-[8px] top-0 flex items-center -space-x-[1px]">
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
            <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          </span>
        )}
        {isUnread && !isRunning && (
          <span className="absolute -left-0.5 top-0 size-2.5 rounded-full border-2 border-background bg-accent" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1 text-sm leading-snug">
          <p className="min-w-0 truncate">
            <span className={cn("text-foreground", !isRead && "font-semibold")}>
              {agentName}
            </span>
            <span className="text-muted-foreground">
              {" "}
              {item.session.title ?? "Session"}
            </span>
          </p>
          {kind === "slack" && (item.session as any).slackChannel && (
            <span className="shrink-0 text-muted-foreground/60">
              #{(item.session as any).slackChannel}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>

        {item.artifactName && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onArtifactClick?.();
            }}
            className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 transition-all hover:border-border hover:bg-muted/80 hover:shadow-sm"
          >
            <Document size={16} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-sm text-muted-foreground">
              {item.artifactName}
            </span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 items-start pt-0.5">
        {!isRunning && onDismiss && (
          <button
            type="button"
            className="text-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
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
  const { actions, inflight, hostLabel, expiredNote, openSettings } =
    useApprovalActions(item.approval);
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!resolved || !onDismiss) return;
    const timer = setTimeout(onDismiss, 2000);
    return () => clearTimeout(timer);
  }, [resolved, onDismiss]);

  const allowOnce = actions.find((a) => a.id === "allow-once");
  const rest = actions.filter((a) => a.id !== "allow-once");

  const act = async (run: () => Promise<boolean>, label: string) => {
    if (!(await run())) return;
    setResolved(label);
  };

  return (
    <div className="group flex w-full gap-3 rounded-xl px-4 py-4 text-left">
      <div className="relative shrink-0 pt-0.5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <Warning size={16} />
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-semibold text-foreground">{agentName}</span>
          <span className="text-muted-foreground">
            {" "}
            {approvalHeadline(item.approval).toLowerCase()}
          </span>
        </p>

        <p
          className="mt-0.5 truncate font-mono text-sm text-muted-foreground/70"
          title={approvalDetail(item.approval)}
        >
          {approvalDetail(item.approval)}
        </p>

        {expiredNote && (
          <p className="mt-1 text-sm text-muted-foreground">{expiredNote}</p>
        )}

        {resolved ? (
          <div className="mt-2 flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2.5 py-1 text-sm font-medium",
                resolved.startsWith("Denied")
                  ? "bg-destructive/10 text-destructive"
                  : "bg-success/10 text-success",
              )}
            >
              {resolved}
            </span>
            {hostLabel !== null && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    aria-label="More actions"
                  >
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={openSettings}>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : expiredNote ? (
          <div className="mt-2 flex items-center gap-2">
            {hostLabel !== null && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="px-2"
                    aria-label="More actions"
                  >
                    <OverflowMenuVertical size={16} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onSelect={openSettings}>
                    <Settings size={16} />
                    Network settings
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-2">
            {allowOnce && (
              <Button
                size="sm"
                disabled={allowOnce.disabled}
                tooltip={allowOnce.tooltip}
                onClick={(e) => {
                  e.stopPropagation();
                  void act(allowOnce.run, allowOnce.resolvedLabel);
                }}
              >
                Allow
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="px-2"
                  disabled={inflight}
                  aria-label="More approval actions"
                >
                  <OverflowMenuVertical size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {rest.map((action) => (
                  <DropdownMenuItem
                    key={action.id}
                    disabled={action.disabled}
                    className={action.danger ? "text-destructive" : undefined}
                    onSelect={() => void act(action.run, action.resolvedLabel)}
                    title={action.tooltip}
                  >
                    {action.label}
                  </DropdownMenuItem>
                ))}
                {hostLabel !== null && (
                  <>
                    <DropdownMenuSeparator className="-mx-1" />
                    <DropdownMenuItem onSelect={openSettings}>
                      <Settings size={16} />
                      Network settings
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-start pt-0.5">
        <span className="text-xs text-muted-foreground">{meta}</span>
      </div>
    </div>
  );
}
