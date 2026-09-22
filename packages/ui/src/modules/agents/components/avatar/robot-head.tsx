import { cn } from "@/lib/utils";

import { avatarDataUri } from "../../lib/avatar/svg.js";

export interface RobotHeadProps {
  seed: string;
  size?: number;
  label?: string;
  className?: string;
}

export function RobotHead({
  seed,
  size = 24,
  label,
  className,
}: RobotHeadProps) {
  return (
    <img
      data-testid="agent-avatar"
      src={avatarDataUri(seed)}
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
      draggable={false}
      decoding="async"
      className={cn("shrink-0 select-none", className)}
    />
  );
}
