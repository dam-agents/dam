import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WakeToEditButton } from "../../agents/components/wake-to-edit-button.js";
import { useOperableState } from "../../agents/hooks/use-operable-state.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a model picker meets a sleeping
 * agent. The model list is read from the running agent, so while it sleeps
 * the picker gives way to the "Start agent to edit" button, then "Agent is
 * starting…", and comes back once the agent answers. Nothing here wakes the
 * agent on its own.
 */
export function AwakeModelsGate({
  agentId,
  className,
  children,
}: {
  agentId: string;
  className?: string;
  children?: ReactNode;
}) {
  const { operable, comingUp } = useOperableState(agentId);
  if (operable) return <>{children}</>;
  return (
    <div className={cn("flex", className)}>
      <WakeToEditButton agentId={agentId} comingUp={comingUp} />
    </div>
  );
}
