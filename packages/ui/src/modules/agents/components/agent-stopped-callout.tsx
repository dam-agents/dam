import { Information, Play } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";

export function AgentStoppedCallout({
  children,
  comingUp,
  onStart,
  className,
}: {
  children: ReactNode;
  comingUp: boolean;
  onStart: () => void;
  className?: string;
}) {
  return (
    <Notice
      icon={Information}
      title="This agent is stopped"
      className={className}
      action={
        <Button size="sm" disabled={comingUp} onClick={onStart}>
          {comingUp ? <Spinner size={14} /> : <Play size={14} />}
          {comingUp ? "Starting…" : "Start agent"}
        </Button>
      }
    >
      {children}
    </Notice>
  );
}
