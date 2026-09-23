import { cn } from "@/lib/utils";

import { getUser } from "../../../../auth.js";
import { avatarDataUri } from "../../lib/avatar/svg.js";
import { avatarKey } from "../../lib/avatar/traits.js";

export interface RobotHeadProps {
  name: string;
  size?: number;
  label?: string;
  sleeping?: boolean;
  className?: string;
}

export function RobotHead({
  name,
  size = 24,
  label,
  sleeping = false,
  className,
}: RobotHeadProps) {
  return (
    <img
      data-testid="agent-avatar"
      src={avatarDataUri(
        avatarKey(getUser()?.profile.sub ?? "", name),
        sleeping,
      )}
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
