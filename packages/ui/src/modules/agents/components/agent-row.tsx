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

import type { BadgeProps } from "@/components/ui/badge";

import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";

function agentBadge(
  display: AgentDisplay,
  agent: AgentView,
  isWorking: boolean,
): { label: string; variant: NonNullable<BadgeProps["variant"]> } {
  const alwaysOn = agent.hibernationTimeoutMin === 0;
  const suffix = alwaysOn ? " (Always on)" : "";

  if (display.state === "running") {
    if (isWorking) return { label: `Working${suffix}`, variant: "success" };
    return { label: `Idle${suffix}`, variant: "accent" };
  }
  if (display.state === "hibernated" || display.state === "hibernating")
    return { label: "Hibernating", variant: "muted" };
  if (display.state === "starting" || display.state === "preparing_workspace")
    return { label: "Starting", variant: "warning" };
  if (display.state === "error") return { label: "Error", variant: "danger" };
  if (display.state === "over_budget")
    return { label: "Over budget", variant: "warning" };
  return { label: "Working", variant: "success" };
}

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
  isWorking?: boolean;
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
}

export function AgentRow({
  agent,
  display,
  subtitle,
  isWorking = false,
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
}: Props) {
  const kindBadge = agentKindBadge(agent);
  const statusBadge = agentBadge(display, agent, isWorking);
  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          {}
          <h2 className="w-full min-w-0 truncate text-base font-medium text-foreground transition-colors md:w-auto [.group:hover:not(:has(button:hover))_&]:text-primary">
            {agent.name}
          </h2>
          {kindBadge && (
            <Badge variant={kindBadge.variant} className="shrink-0">
              {kindBadge.label}
            </Badge>
          )}
          <ContributionFailuresBadge failures={agent.contributionFailures} />
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {subtitle}
        </p>
        {temporaryDraw && temporaryDraw.count > 0 && (
          <p className="mt-2 flex items-center gap-1.5 border-t border-border pt-2 text-xs text-muted-foreground">
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
      <div className="flex shrink-0 items-center gap-1">
        {/* UpdateAvailableAction hidden for prototype */}
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
          <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
        </span>
        {}
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
                  {}
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
