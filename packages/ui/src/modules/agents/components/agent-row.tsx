import {
  Chemistry,
  Connect,
  LogoSlack,
  OverflowMenuVertical,
  Package,
  SkillLevel,
  Time,
} from "@carbon/icons-react";

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

function TelegramIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
    >
      <path d="M26.07 5.26 3.81 14.09c-1.52.61-1.51 1.46-.28 1.84l5.71 1.78 2.22 6.81c.27.74.13.98.88.98.57 0 .82-.26 1.14-.57l2.74-2.66 5.7 4.21c1.05.58 1.81.28 2.07-.97l3.75-17.67c.38-1.54-.59-2.24-1.67-1.58zm-5.87 5.84L12.4 18l-.39 4.15-1.63-5.83 10.45-6.34c.49-.3.94-.14.57.28z" />
    </svg>
  );
}

interface ChipProps {
  icon: React.ReactNode;
  count: number;
  unit: string;
}

function AttachmentChip({ icon, count, unit }: ChipProps) {
  const label = `${count} ${unit}${count === 1 ? "" : "s"}`;
  return (
    <span
      data-testid={`chip-${unit}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground"
    >
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </span>
  );
}

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

const ICON_SIZE = 16;

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

  const hasAttachments =
    slackCount > 0 ||
    telegramCount > 0 ||
    connectionCount > 0 ||
    (scheduleCount ?? 0) > 0 ||
    (skillCount !== undefined && skillCount !== null && skillCount > 0) ||
    neverHibernates;

  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className="group flex max-w-[960px] cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <div className="min-w-0 flex-1">
        {/* Row 1 — identity: name, kind badge, pack provenance */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="min-w-0 truncate text-base font-medium text-foreground transition-colors md:w-auto [.group:hover:not(:has(button:hover))_&]:text-primary">
            {agent.name}
          </h2>
          {kindBadge && (
            <Badge variant={kindBadge.variant} className="shrink-0">
              {kindBadge.label}
            </Badge>
          )}
          {packName && (
            <Badge
              variant="muted"
              className="shrink-0"
              data-testid="pack-badge"
              title={`Created from the ${packName} pack`}
            >
              <Package size={12} className="mr-0.5" />
              {packName}
            </Badge>
          )}
          <ContributionFailuresBadge failures={agent.contributionFailures} />
        </div>

        {/* Row 2 — runtime: harness · provider */}
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {subtitle}
        </p>

        {/* Row 3 — attachments: counted chips, absent when empty */}
        {hasAttachments && (
          <div
            data-testid="attachments-row"
            className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1"
          >
            {slackCount > 0 && (
              <AttachmentChip
                icon={<LogoSlack size={ICON_SIZE} />}
                count={slackCount}
                unit="channel"
              />
            )}
            {telegramCount > 0 && (
              <AttachmentChip
                icon={<TelegramIcon size={ICON_SIZE} />}
                count={telegramCount}
                unit="chat"
              />
            )}
            {connectionCount > 0 && (
              <AttachmentChip
                icon={<Connect size={ICON_SIZE} />}
                count={connectionCount}
                unit="connection"
              />
            )}
            {(scheduleCount ?? 0) > 0 && (
              <AttachmentChip
                icon={<Time size={ICON_SIZE} />}
                count={scheduleCount!}
                unit="schedule"
              />
            )}
            {skillCount !== undefined &&
              skillCount !== null &&
              skillCount > 0 && (
                <AttachmentChip
                  icon={<SkillLevel size={ICON_SIZE} />}
                  count={skillCount}
                  unit="skill"
                />
              )}
            {neverHibernates && (
              <span
                data-testid="chip-never-hibernates"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground"
              >
                <span className="inline-block size-1.5 rounded-full bg-success" />
                <span>Never hibernates</span>
              </span>
            )}
          </div>
        )}

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
