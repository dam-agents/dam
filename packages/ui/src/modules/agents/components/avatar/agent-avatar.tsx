import { useAgentAvatars } from "../../hooks/use-agent-avatars.js";
import type { AgentDisplayState } from "../../utils/agent-resolver.js";
import { LazyRobotHead } from "./lazy-robot-head.js";

export function isAsleep(state: AgentDisplayState | undefined): boolean {
  return state === "hibernated" || state === "hibernating";
}

interface Props {
  name: string;
  size?: number;
  sleeping?: boolean;
  className?: string;
}

export function AgentAvatar({ name, size, sleeping, className }: Props) {
  const enabled = useAgentAvatars();
  if (!enabled) return null;
  return (
    <LazyRobotHead
      seed={name}
      size={size}
      sleeping={sleeping}
      className={className}
    />
  );
}
