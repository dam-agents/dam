import { OverflowMenuVertical, Renew } from "@carbon/icons-react";
import { FlaskConical } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { agentKindBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
  /** Live compute of this sandbox's temporary spawns, when it has any. */
  temporaryDraw?: TemporaryDraw;
  deletePending: boolean;
  /** Hide the kind badge (e.g. "Knowledge base") when the context already makes it obvious. */
  hideKindBadge?: boolean;
  onSelect: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  onUpdate?: () => void;
}

export function AgentRow({
  agent,
  display,
  subtitle,
  temporaryDraw,
  deletePending,
  hideKindBadge,
  onSelect,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
  onUpdate,
}: Props) {
  const kindBadge = hideKindBadge ? null : agentKindBadge(agent);
  return (
    <Card
      data-testid="agent-row"
      onClick={onSelect}
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-[16px] font-medium text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
            {agent.name}
          </h2>
          {/* Beside the name, not with the status pills: the Kind is part of what
              this sandbox *is*, not something it is currently doing. */}
          {kindBadge && (
            <Badge variant={kindBadge.variant} className="shrink-0">
              {kindBadge.label}
            </Badge>
          )}
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {subtitle}
        </p>
        {temporaryDraw && temporaryDraw.count > 0 && (
          <p className="mt-2 flex items-center gap-1.5 border-t border-border-light pt-2 text-[12px] text-muted-foreground">
            <FlaskConical size={12} className="shrink-0 text-accent" />
            <span className="truncate">
              {temporaryDraw.count} temporary sandbox
              {temporaryDraw.count === 1 ? "" : "es"} running
              {formatTemporaryDraw(temporaryDraw) &&
                ` · ${formatTemporaryDraw(temporaryDraw)}`}{" "}
              ·{" "}
              <span className="text-text-muted">
                released when the run ends
              </span>
            </span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {agent.templateUpdate && (
          <Tooltip
            side="bottom"
            className="w-[300px] rounded-xl border border-border bg-popover p-4 shadow-xl"
            content={
              <div className="flex items-start gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10">
                  <Renew size={16} className="text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-foreground">
                    Update available
                  </p>
                  <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                    Latest:{" "}
                    <span className="font-mono text-[12px] text-foreground">
                      {agent.templateUpdate.toImage}
                    </span>
                  </p>
                </div>
              </div>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onUpdate?.();
              }}
              className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
            >
              <Renew size={14} className="shrink-0" />
              Update
            </Button>
          </Tooltip>
        )}
        <ContributionFailuresBadge failures={agent.contributionFailures} />
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
              <Button variant="ghost" size="icon" title="Sandbox actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
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
