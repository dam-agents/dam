import { Play, Renew, Settings, TrashCan } from "@carbon/icons-react";

import { Card } from "@/components/ui/card";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import { ContributionFailuresBadge } from "../../agents/components/contribution-failures-badge.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { harnessLabel } from "../../v2/lib/harnesses.js";

export function AgentCard({
  agent,
  display,
  onOpen,
  onRestart,
  onWake,
  onConfigure,
  onDelete,
  busy,
}: {
  agent: AgentView;
  display: AgentDisplay;
  onOpen: () => void;
  onRestart: () => void;
  onWake: () => void;
  onConfigure: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const typeLabel = harnessLabel(agent.templateId);
  return (
    <Card
      onClick={display.clickable ? onOpen : undefined}
      className={`overflow-hidden anim-in transition-shadow ${
        display.clickable
          ? "group cursor-pointer hover:not-has-[button:hover]:shadow-md"
          : "opacity-80"
      }`}
    >
      <div className="flex items-center gap-3 px-5 py-4">
        <StatusBadge state={display.state} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[16px] font-bold text-foreground truncate transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
              {agent.name}
            </span>
            {typeLabel && (
              <span className="shrink-0 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {typeLabel}
              </span>
            )}
            <ContributionFailuresBadge
              failures={agent.contributionFailures}
              size="sm"
            />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {display.powerAction === "restart" && (
            <CardAction title="Restart" onClick={onRestart} disabled={busy}>
              <Renew />
            </CardAction>
          )}
          {display.powerAction === "start" && (
            <CardAction title="Start" onClick={onWake} disabled={busy}>
              <Play />
            </CardAction>
          )}
          <CardAction title="Configure" onClick={onConfigure} disabled={busy}>
            <Settings />
          </CardAction>
          <CardAction
            title="Delete sandbox"
            onClick={onDelete}
            disabled={busy}
            destructive
          >
            <TrashCan />
          </CardAction>
        </div>
      </div>
    </Card>
  );
}

function CardAction({
  title,
  onClick,
  disabled,
  destructive,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled: boolean;
  destructive?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-md p-2 text-muted-foreground transition-colors disabled:opacity-50 ${
        destructive ? "hover:text-destructive" : "hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
