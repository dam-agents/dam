import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { WakeToEditButton } from "../../agents/components/wake-to-edit-button.js";
import { useOperableState } from "../../agents/hooks/use-operable-state.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one place a model picker meets an agent
 * that is not running. The model list is read from the running agent, so the
 * picker gives way to "Agent is starting…" while the gate wakes the agent, and
 * comes back once the agent answers; a wake that did not start leaves the
 * "Start agent to edit" button.
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
