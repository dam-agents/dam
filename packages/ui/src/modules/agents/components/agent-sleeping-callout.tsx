import { Asleep, Play } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Spinner } from "@/components/ui/spinner";

export function AgentSleepingCallout({
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
      icon={Asleep}
      title="This agent is sleeping"
      className={className}
      action={
        <Button size="sm" disabled={comingUp} onClick={onStart}>
          {comingUp ? <Spinner size={14} /> : <Play size={14} />}
          {comingUp ? "Waking…" : "Wake agent"}
        </Button>
      }
    >
      {children}
    </Notice>
  );
}
