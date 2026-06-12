import { OverflowMenuVertical } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import type { AgentDisplay } from "../utils/agent-resolver.js";
import { ContributionFailuresBadge } from "./contribution-failures-badge.js";

interface Props {
  agent: AgentView;
  display: AgentDisplay;
  subtitle: string;
  deletePending: boolean;
  onSelect: () => void;
  onWake: () => void;
  onRestart: () => void;
  onConfigure: () => void;
  onDelete: () => void;
}

export function AgentRow({
  agent,
  display,
  subtitle,
  deletePending,
  onSelect,
  onWake,
  onRestart,
  onConfigure,
  onDelete,
}: Props) {
  return (
    <Card
      data-testid="agent-row"
      onClick={onSelect}
      className="group flex cursor-pointer items-center justify-between gap-3 border border-border p-4 anim-in transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[16px] font-medium text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
          {agent.name}
        </h2>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ContributionFailuresBadge failures={agent.contributionFailures} />
        <StatusBadge state={display.state} />
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
                <DropdownMenuItem onSelect={onWake}>Wake</DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={display.powerAction === null}
                  onSelect={onRestart}
                >
                  Restart
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={onConfigure}>
                Configure
              </DropdownMenuItem>
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
