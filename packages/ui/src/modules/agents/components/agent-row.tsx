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

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
  /** Live compute of this sandbox's temporary spawns, when it has any. */
  temporaryDraw?: TemporaryDraw;
  deletePending: boolean;
  /** This sandbox's template update is in flight. */
  updatePending: boolean;
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
  temporaryDraw,
  deletePending,
  updatePending,
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
  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      // The guard keeps the card flat while a nested action is hovered, so the
      // two hover states don't stack.
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          {/* Full width until there is room to share the line, so the pills drop
              below the name on a narrow screen instead of squeezing it. */}
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
              {temporaryDraw.count} temporary sandbox
              {temporaryDraw.count === 1 ? "" : "es"} running
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
        <UpdateAvailableAction
          agent={agent}
          pending={updatePending}
          onUpdate={onUpdate}
        />
        {/* A parked sandbox explains itself: the controller's figures ride
            the badge tooltip — focusable and labelled, so keyboard and
            screen-reader users reach them, not just mouse hover. */}
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
        {/* Menu clicks (incl. portaled items, which bubble through the React
            tree) must not trigger the row's onSelect. */}
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Sandbox actions">
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
                  {/* A parked sandbox was never asleep — it's waiting for
                      room, and this retries the gate. */}
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
                Delete sandbox
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </Card>
  );
}
