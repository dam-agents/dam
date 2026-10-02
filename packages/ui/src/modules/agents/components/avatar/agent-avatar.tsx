import { cn } from "@/lib/utils";

import type { AgentDisplayState } from "../../utils/agent-resolver.js";
import { CharAvatar } from "../char-avatar.js";

export function isAsleep(state: AgentDisplayState | undefined): boolean {
  return state === "hibernated" || state === "hibernating";
}

export const STOPPED_AVATAR_CLASS = "grayscale";

interface Props {
  name: string;
  agentId?: string;
  size?: number;
  sleeping?: boolean;
  stopped?: boolean;
  className?: string;
}

export function AgentAvatar({
  name,
  agentId,
  size = 24,
  sleeping = false,
  stopped = false,
  className,
}: Props) {
  const state = sleeping || stopped ? "hibernated" : "running";
  return (
    <span
      className={cn(
        "group inline-flex shrink-0",
        stopped && STOPPED_AVATAR_CLASS,
        className,
      )}
      style={{ width: size, height: size }}
    >
      <CharAvatar
        agentId={agentId ?? name}
        state={state}
        idle={stopped && !sleeping}
        className="size-full"
      />
    </span>
  );
}
