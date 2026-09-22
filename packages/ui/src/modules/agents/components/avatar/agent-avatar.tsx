import { useId, useMemo } from "react";

import { cn } from "@/lib/utils";

import { HEAD_GEOMETRY } from "../../lib/avatar/geometry.js";
import { avatarTraits } from "../../lib/avatar/traits.js";
import {
  AvatarBottom,
  AvatarCapOverlay,
  AvatarChinOverlay,
  AvatarEars,
  AvatarFace,
  AvatarMouth,
  AvatarTop,
} from "./avatar-parts.js";

interface Props {
  seed: string;
  size?: number;
  label?: string;
  className?: string;
}

export function AgentAvatar({ seed, size = 24, label, className }: Props) {
  const traits = useMemo(() => avatarTraits(seed), [seed]);
  const head = HEAD_GEOMETRY[traits.head];
  const clipId = `avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const parts = { traits, head };
  return (
    <svg
      data-testid="agent-avatar"
      data-seed={seed}
      viewBox="3 -2 94 94"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={head.path} />
        </clipPath>
      </defs>
      <AvatarTop {...parts} />
      <AvatarBottom {...parts} />
      <AvatarEars {...parts} />
      <path d={head.path} fill={traits.palette.base} />
      <g clipPath={`url(#${clipId})`}>
        <AvatarCapOverlay {...parts} />
        <AvatarChinOverlay {...parts} />
        <AvatarFace {...parts} />
        <AvatarMouth {...parts} />
      </g>
    </svg>
  );
}
