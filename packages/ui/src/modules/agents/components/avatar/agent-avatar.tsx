import { cn } from "@/lib/utils";

import { useAgentAvatars } from "../../hooks/use-agent-avatars.js";
import type { AgentDisplayState } from "../../utils/agent-resolver.js";
import { LazyRobotHead } from "./lazy-robot-head.js";

export function isAsleep(state: AgentDisplayState | undefined): boolean {
  return state === "hibernated" || state === "hibernating";
}

export const STOPPED_AVATAR_CLASS = "grayscale";

interface Props {
  name: string;
  size?: number;
  sleeping?: boolean;
  stopped?: boolean;
  className?: string;
}

export function AgentAvatar({
  name,
  size,
  sleeping = false,
  stopped = false,
  className,
}: Props) {
  const enabled = useAgentAvatars();
  if (!enabled) return null;
  return (
    <LazyRobotHead
      name={name}
      size={size}
      sleeping={sleeping || stopped}
      className={cn(stopped && STOPPED_AVATAR_CLASS, className)}
    />
  );
}
