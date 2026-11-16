import { Information, InProgress, Play } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

import { useAutoWakeOnOpen } from "../hooks/use-auto-wake-on-open.js";

export function AgentStartingCallout({
  agentId,
  children,
  comingUp,
  onStart,
  className,
}: {
  agentId: string | null;
  children: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  className?: string;
}) {
  useAutoWakeOnOpen(agentId);
  return (
    <Notice
      icon={comingUp ? InProgress : Information}
      title={comingUp ? "Starting the agent" : "The agent isn’t running"}
      className={className}
      action={
        !comingUp && (
          <Button size="sm" onClick={onStart}>
            <Play size={14} />
            Start agent
          </Button>
        )
      }
    >
      {children}
    </Notice>
  );
}
