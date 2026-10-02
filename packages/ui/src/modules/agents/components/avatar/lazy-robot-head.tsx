import { cn } from "@/lib/utils";

import { CharAvatar } from "../char-avatar.js";

export interface RobotHeadProps {
  name: string;
  size?: number;
  sleeping?: boolean;
  className?: string;
}

export function LazyRobotHead({
  name,
  size = 24,
  sleeping = false,
  className,
}: RobotHeadProps) {
  return (
    <span
      className={cn("group inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <CharAvatar
        agentId={name}
        state={sleeping ? "hibernated" : "running"}
        className="size-full"
      />
    </span>
  );
}
