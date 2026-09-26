import {
  Book,
  Chemistry,
  Gift,
  OverflowMenuVertical,
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
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { AgentChannelChips } from "../../sandboxes/components/channels/agent-channel-chips.js";
import { OnboardingTag } from "../../starter-kits/components/onboarding-tag.js";
import {
  agentKindBadge,
  knowledgeBadge,
  starterKitBadge,
} from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { AgentAvatar, isAsleep } from "./avatar/agent-avatar.js";
import {
  agentFailures,
  ContributionFailuresBadge,
} from "./contribution-failures-badge.js";
import { FreeUpComputeItems } from "./power-menu-items.js";
import { UnsupportedContributionsBadge } from "./unsupported-contributions-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";
import { VmRuntimeBadge } from "./vm-runtime-badge.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  working?: boolean;
  subtitle: string;
  temporaryDraw?: TemporaryDraw;
  deletePending: boolean;
  updatePending: boolean;
  updateBusy: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  onConfigure: () => void;
  configureLabel: string;
  onShare?: () => void;
  onWake: () => void;
  onRestart: () => void;
  onPause: () => void;
  onStop: () => void;
  onDelete: () => void;
  onAddToChannel?: (messenger: "slack" | "telegram") => void;
  messengers?: { slack?: boolean; telegram?: boolean };
}

export function AgentRow({
  agent,
  display,
  working,
  subtitle,
  temporaryDraw,
  deletePending,
  updatePending,
  updateBusy,
  onSelect,
  onUpdate,
  onConfigure,
  configureLabel,
  onShare,
  onWake,
  onRestart,
  onPause,
  onStop,
  onDelete,
  onAddToChannel,
  messengers = {},
}: Props) {
  const kindBadge = agentKindBadge(agent);
  const kitBadge = starterKitBadge(agent);
  const knowledge = knowledgeBadge(agent);
  const onShareKnowledge = knowledge ? onShare : undefined;
  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <AgentAvatar
        name={agent.name}
        size={64}
        sleeping={isAsleep(display.state)}
        stopped={agent.stopRequested}
        className="mr-1 self-start"
      />
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
          <VmRuntimeBadge agent={agent} />
          {kitBadge && (
            <Badge
              variant={kitBadge.variant}
              className="shrink-0"
              title={kitBadge.title}
              aria-label={`From the ${kitBadge.label} starter kit`}
            >
              <span className="flex items-center gap-1.5">
                <Gift size={12} aria-hidden />
                {kitBadge.label}
              </span>
            </Badge>
          )}
          {knowledge && (
            <Badge
              variant={knowledge.variant}
              className="shrink-0"
              title={knowledge.title}
            >
              <span className="flex items-center gap-1.5">
                <Book size={12} aria-hidden />
                {knowledge.label}
              </span>
            </Badge>
          )}
          <OnboardingTag agent={agent} />
          <ContributionFailuresBadge failures={agentFailures(agent)} />
          <UnsupportedContributionsBadge agent={agent} />
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {subtitle}
        </p>
        <AgentChannelChips agent={agent} className="mt-2" />
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
          <StatusBadge
            state={display.state}
            working={working}
            alwaysOn={agent.hibernationTimeoutMin === 0}
          />
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
              {onShareKnowledge && (
                <DropdownMenuItem onSelect={onShareKnowledge}>
                  Share knowledge base
                </DropdownMenuItem>
              )}
              {onAddToChannel && (messengers.slack || messengers.telegram) && (
                <>
                  <DropdownMenuSeparator />
                  {messengers.slack && (
                    <DropdownMenuItem onSelect={() => onAddToChannel("slack")}>
                      <ConnectionIcon iconSlug="slack" alt="" size={16} />
                      Add to Slack channel
                    </DropdownMenuItem>
                  )}
                  {messengers.telegram && (
                    <DropdownMenuItem
                      onSelect={() => onAddToChannel("telegram")}
                    >
                      <ConnectionIcon iconSlug="telegram" alt="" size={16} />
                      Add to Telegram chat
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuSeparator />
              {display.state === "running" && (
                <FreeUpComputeItems
                  agent={agent}
                  onPause={onPause}
                  onStop={onStop}
                />
              )}
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
