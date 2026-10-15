import { Box, Chemistry } from "@carbon/icons-react";
import { isStartRefusal } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import {
  AlwaysOnTag,
  StatusBadge,
} from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { AgentChannelChips } from "../../sandboxes/components/channels/agent-channel-chips.js";
import { useKeptWorkCount } from "../../sessions/api/background-work.js";
import { KitUpdateTag } from "../../starter-kits/components/kit-update-tag.js";
import { OnboardingTag } from "../../starter-kits/components/onboarding-tag.js";
import { reclaimSentence } from "../lib/reclaim-notices.js";
import { statusTone } from "../lib/status-tone.js";
import { agentKindBadge, starterKitBadge } from "../utils/agent-kind.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import type { AgentUsage } from "../utils/sandbox-subtitle.js";
import {
  formatTemporaryDraw,
  type TemporaryDraw,
} from "../utils/temporary-sandboxes.js";
import { AgentActionsMenu } from "./agent-actions-menu.js";
import { AgentAvatar, avatarMood } from "./avatar/agent-avatar.js";
import {
  agentFailures,
  ContributionFailuresBadge,
} from "./contribution-failures-badge.js";
import { GatewayFailureBadge } from "./gateway-failure-badge.js";
import { MigrateRuntimeAction } from "./migrate-runtime-action.js";
import { UnsupportedContributionsBadge } from "./unsupported-contributions-badge.js";
import { UpdateAvailableAction } from "./update-available-action.js";
import { UsagePairs } from "./usage-pairs.js";
import { VmRuntimeBadge } from "./vm-runtime-badge.js";

const SECOND_LINE_ITEM =
  "rounded-none border-0 bg-transparent p-0 text-sm tracking-normal text-muted-foreground dark:text-muted-foreground";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  working?: boolean;
  subtitle: string | null;
  usage: AgentUsage | null;
  temporaryDraw?: TemporaryDraw;
  deletePending: boolean;
  updatePending: boolean;
  updateBusy: boolean;
  onSelect: () => void;
  onUpdate: () => void;
  migratePending: boolean;
  onMigrate: () => void;
  migrationControlsBusy: boolean;
  onAbortMigration: () => void;
  onRetryMigration: () => void;
  onConfigure: () => void;
  configureLabel: string;
  onWake: () => void;
  onRestart: () => void;
  onSleep: () => void;
  onDelete: () => void;
  onAddToChannel?: (messenger: "slack" | "telegram") => void;
  messengers?: { slack?: boolean; telegram?: boolean };
}

export function AgentRow({
  agent,
  display,
  working,
  subtitle,
  usage,
  temporaryDraw,
  deletePending,
  updatePending,
  updateBusy,
  onSelect,
  onUpdate,
  migratePending,
  onMigrate,
  migrationControlsBusy,
  onAbortMigration,
  onRetryMigration,
  onConfigure,
  configureLabel,
  onWake,
  onRestart,
  onSleep,
  onDelete,
  onAddToChannel,
  messengers = {},
}: Props) {
  const kindBadge = agentKindBadge(agent);
  const kitBadge = starterKitBadge(agent);
  const keptWork = useKeptWorkCount(agent.id);
  const statusNote =
    agent.overBudgetMessage ??
    (display.state === "hibernated" ? reclaimSentence(agent) : undefined);
  return (
    <Card
      data-testid="agent-row"
      {...clickableProps(onSelect)}
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-colors hover:not-has-[button:hover]:bg-muted/40"
    >
      <AgentAvatar
        name={agent.name}
        avatar={agent.avatar}
        size={64}
        mood={avatarMood(display.state, agent.stopRequested)}
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
          <KitUpdateTag agentId={agent.id} />
          <ContributionFailuresBadge failures={agentFailures(agent)} />
          <GatewayFailureBadge agent={agent} />
          <UnsupportedContributionsBadge agent={agent} />
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground [&>*+*]:before:mr-1.5 [&>*+*]:before:content-['·'_/_'']">
          <span
            title={statusNote}
            {...(statusNote
              ? {
                  tabIndex: 0,
                  role: "note",
                  "aria-label": statusNote,
                }
              : {})}
          >
            <StatusBadge
              state={display.state}
              working={working}
              keptWork={keptWork}
              vm={agent.vm}
              refused={isStartRefusal(agent.podTerminationCode)}
              className={cn(
                SECOND_LINE_ITEM,
                statusTone(display.state, working, keptWork),
              )}
            />
          </span>
          <OnboardingTag agent={agent} className={SECOND_LINE_ITEM} />
          {kitBadge && (
            <span
              className="flex min-w-0 items-center gap-1"
              title={kitBadge.title}
              aria-label={`From the ${kitBadge.label} starter kit`}
            >
              <Box size={14} className="shrink-0" aria-hidden />
              <span className="truncate">{kitBadge.label}</span>
            </span>
          )}
          {subtitle && <span className="truncate">{subtitle}</span>}
          {usage && <UsagePairs usage={usage} />}
        </div>
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
        <MigrateRuntimeAction
          agent={agent}
          pending={migratePending}
          onMigrate={onMigrate}
          controlsBusy={migrationControlsBusy}
          onAbort={onAbortMigration}
          onRetry={onRetryMigration}
        />
        {agent.hibernationTimeoutMin === 0 && <AlwaysOnTag />}
        {}
        <span onClick={(e) => e.stopPropagation()}>
          <AgentActionsMenu
            agent={agent}
            display={display}
            deletePending={deletePending}
            configureLabel={configureLabel}
            onConfigure={onConfigure}
            onWake={onWake}
            onRestart={onRestart}
            onSleep={onSleep}
            onDelete={onDelete}
            onAddToChannel={onAddToChannel}
            messengers={messengers}
          />
        </span>
      </div>
    </Card>
  );
}
