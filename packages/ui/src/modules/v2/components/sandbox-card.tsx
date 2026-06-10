import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { StatusBadge } from "../../../components/status-indicator.js";
import type { AgentView } from "../../../types.js";
import type { AgentDisplay } from "../../agents/utils/agent-resolver.js";
import { harnessLabel } from "../lib/harnesses.js";

export function SandboxCard({
  agent,
  display,
  onOpen,
  onDelete,
  deleting,
}: {
  agent: AgentView;
  display: AgentDisplay;
  onOpen: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const degraded = agent.contributionFailures.length > 0;
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
          </div>
          {degraded && (
            <div className="text-[12px] text-warning">
              Some setup didn't apply
            </div>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          tone="danger"
          size="icon-sm"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={deleting}
          title="Delete sandbox"
        >
          <Trash2 size={16} />
        </Button>
      </div>
    </Card>
  );
}
