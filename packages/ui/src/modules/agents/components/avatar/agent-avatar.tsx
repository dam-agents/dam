import type { FC } from "react";

import type { AgentDisplayState } from "../../utils/agent-resolver.js";

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

export const AgentAvatar: FC<Props> = () => null;
