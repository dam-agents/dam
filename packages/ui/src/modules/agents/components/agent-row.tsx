import { Chemistry, OverflowMenuVertical } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { clickableProps } from "@/lib/clickable";

import {
  stateDotClass,
  StatusBadge,
} from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";

export interface AgentRowProps {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
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
  connectionCount?: number;
  packName?: string;
  skillCount?: number | null;
  scheduleCount?: number;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function AgentRow({
  agent,
  display,
  subtitle,
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
  connectionCount: connectionCountProp,
  packName,
  skillCount,
  scheduleCount,
}: AgentRowProps) {
  const kindBadge = agentKindBadge(agent);
  const neverHibernates = agent.hibernationTimeoutMin === 0;

  const slackCount = agent.channels.filter((c) => c.type === "slack").length;
  const telegramCount = agent.channels.filter(
    (c) => c.type === "telegram",
  ).length;
  const connectionCount = connectionCountProp ?? 0;

  const meta: string[] = [subtitle];
  if (slackCount > 0) meta.push(plural(slackCount, "channel"));
  if (telegramCount > 0) meta.push(plural(telegramCount, "chat"));
  if (connectionCount > 0) meta.push(plural(connectionCount, "connection"));
  if ((scheduleCount ?? 0) > 0) meta.push(plural(scheduleCount!, "schedule"));
  if (skillCount !== undefined && skillCount !== null && skillCount > 0)
    meta.push(plural(skillCount, "skill"));
  if (neverHibernates) meta.push("Never hibernates");

  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className="group flex max-w-[960px] cursor-pointer items-center justify-between gap-4 border border-border px-4 py-3.5 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={`mt-0.5 size-2 shrink-0 self-start rounded-full ${stateDotClass[display.state]}`}
          title={display.state}
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-sm font-medium text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
              {agent.name}
            </h2>
            {kindBadge && (
              <Badge variant={kindBadge.variant} size="sm" className="shrink-0">
                {kindBadge.label}
              </Badge>
            )}
            {packName && (
              <Badge
                variant="muted"
                size="sm"
                className="shrink-0"
                data-testid="pack-badge"
                title={`Created from the ${packName} pack`}
              >
                {packName}
              </Badge>
            )}
            <ContributionFailuresBadge failures={agent.contributionFailures} />
          </div>

          <p
            data-testid="attachments-row"
            className="mt-0.5 truncate text-sm text-muted-foreground"
          >
            {meta.join(" · ")}
          </p>

          {temporaryDraw && temporaryDraw.count > 0 && (
            <p className="mt-1.5 flex items-center gap-1.5 border-t border-border pt-1.5 text-xs text-muted-foreground">
              <Chemistry size={12} className="shrink-0 text-accent" />
              <span className="truncate">
                {temporaryDraw.count} temporary agent
                {temporaryDraw.count === 1 ? "" : "s"} running
                {formatTemporaryDraw(temporaryDraw) &&
                  ` · ${formatTemporaryDraw(temporaryDraw)}`}{" "}
                ·{" "}
                <span className="text-muted-foreground">
                  released when the run ends
                </span>
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
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
          <StatusBadge state={display.state} />
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
    </Card>
  );
}
