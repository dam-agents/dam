import { Chemistry, OverflowMenuVertical } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { openBindModal } from "../../sandboxes/components/channels/bind-modal-state.js";
import type {
  AgentDisplay,
  AgentDisplayState,
} from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";

export interface AgentRowProps {
  agent: AgentView;
  display: AgentDisplay;
  temporaryDraw?: TemporaryDraw;
  deletePending: boolean;
  updatePending: boolean;
  updateBusy: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onConfigure: () => void;
  configureLabel: string;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  scheduleCount?: number;
}

const BLUE_BADGE =
  "border-transparent bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400";

function formatCpu(raw: string): string {
  const m = raw.match(/^(\d+)m$/);
  if (m) return `${Number(m[1]) / 1000} CPU`;
  return `${raw} CPU`;
}

function formatMemory(raw: string): string {
  const gi = raw.match(/^(\d+)Gi$/);
  if (gi) return `${gi[1]} Gi`;
  const mi = raw.match(/^(\d+)Mi$/);
  if (mi) return `${mi[1]} Mi`;
  return raw;
}

function computeSubtitle(size: { cpu?: string; memory?: string }): string {
  const parts: string[] = [];
  if (size.cpu) parts.push(formatCpu(size.cpu));
  if (size.memory) parts.push(formatMemory(size.memory));
  return parts.join(" · ") || "";
}

function AgentStateBadge({
  state,
  neverHibernates,
}: {
  state: AgentDisplayState;
  neverHibernates: boolean;
}) {
  const alwaysOn = neverHibernates;

  if (state === "running") {
    return (
      <Badge variant="success">
        {alwaysOn ? "Working (Always-on)" : "Working"}
      </Badge>
    );
  }
  if (state === "hibernating" || state === "hibernated") {
    if (alwaysOn) {
      return <Badge className={BLUE_BADGE}>Idle (Always-on)</Badge>;
    }
    return <Badge variant="muted">Hibernating</Badge>;
  }
  if (state === "starting" || state === "preparing_workspace") {
    return <Badge variant="warning">Starting</Badge>;
  }
  if (state === "error") {
    return <Badge variant="danger">Error</Badge>;
  }
  if (state === "over_budget") {
    return <Badge variant="warning">Over budget</Badge>;
  }
  return <Badge variant="muted">{state}</Badge>;
}

export function AgentRow({
  agent,
  display,
  temporaryDraw,
  deletePending,
  updatePending,
  updateBusy,
  onSelect,
  onUpdate,
  onConfigure,
  configureLabel,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
  scheduleCount,
}: AgentRowProps) {
  const neverHibernates = agent.hibernationTimeoutMin === 0;

  const slackChannels = agent.channels.filter((c) => c.type === "slack") as {
    type: "slack";
    slackChannelId: string;
  }[];

  const maxVisibleSlack = 2;
  const visibleSlack = slackChannels.slice(0, maxVisibleSlack);
  const slackOverflow = slackChannels.length - visibleSlack.length;

  const hasSchedules = (scheduleCount ?? 0) > 0;
  const hasSlack = slackChannels.length > 0;
  const hasMeta = hasSchedules || hasSlack;

  return (
    <div
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className={cn(
        CARD_SURFACE,
        "group max-w-[960px] cursor-pointer anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40",
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
              {agent.name}
            </h2>
            <ContributionFailuresBadge failures={agent.contributionFailures} />
          </div>

          {agent.size && computeSubtitle(agent.size) && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {computeSubtitle(agent.size)}
            </p>
          )}

          {hasMeta && (
            <div
              data-testid="attachments-row"
              className="mt-2 flex flex-wrap items-center gap-2"
            >
              {hasSlack && (
                <Badge variant="muted" className="gap-1.5">
                  <ConnectionIcon iconSlug="slack" alt="" size={16} />
                  {visibleSlack.map((ch) => ch.slackChannelId).join(", ")}
                  {slackOverflow > 0 && `, +${slackOverflow}`}
                </Badge>
              )}

              {hasSchedules && (
                <Badge variant="muted">
                  {scheduleCount} active schedule
                  {scheduleCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          )}

          {temporaryDraw && temporaryDraw.count > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              <Chemistry size={16} className="shrink-0 text-accent" />
              <span className="truncate">
                {temporaryDraw.count} temporary agent
                {temporaryDraw.count === 1 ? "" : "s"} running
                {formatTemporaryDraw(temporaryDraw) &&
                  ` · ${formatTemporaryDraw(temporaryDraw)}`}
              </span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <UpdateAvailableAction
            agent={agent}
            pending={updatePending}
            busy={updateBusy}
            onUpdate={onUpdate}
          />
          <span
            title={agent.overBudgetMessage ?? undefined}
            {...(agent.overBudgetMessage
              ? {
                  tabIndex: 0,
                  role: "note",
                  "aria-label": agent.overBudgetMessage,
                }
              : {})}
          >
            <AgentStateBadge
              state={display.state}
              neverHibernates={neverHibernates}
            />
          </span>
          <span onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Agent actions">
                  <OverflowMenuVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={onConfigure}>
                  {configureLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    openBindModal(["slack"], { initialKind: "slack" })
                  }
                >
                  <ConnectionIcon iconSlug="slack" alt="" size={16} />
                  Add to Slack channel
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    openBindModal(["telegram"], { initialKind: "telegram" })
                  }
                >
                  <ConnectionIcon iconSlug="telegram" alt="" size={16} />
                  Add to Telegram chat
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {display.powerAction === "start" ? (
                  <DropdownMenuItem onSelect={onWake}>
                    {display.state === "over_budget" ? "Start" : "Wake"}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    disabled={display.powerAction === null}
                    onSelect={onRestart}
                  >
                    Restart
                  </DropdownMenuItem>
                )}
                {display.state === "running" && (
                  <>
                    <DropdownMenuItem onSelect={onPause}>
                      Pause — wakes on next use
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onStop}>
                      Stop — until started again
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  tone="danger"
                  disabled={deletePending}
                  onSelect={onDelete}
                >
                  Delete agent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      </div>
    </div>
  );
}
