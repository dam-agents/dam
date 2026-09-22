import { useId, useMemo } from "react";

import { cn } from "@/lib/utils";

import { HEAD_GEOMETRY } from "../../lib/avatar/geometry.js";
import { avatarTraits } from "../../lib/avatar/traits.js";
import { AvatarFace, AvatarMouth } from "./avatar-face.js";
import {
  AvatarBottom,
  AvatarEars,
  AvatarGapLines,
  AvatarOverlays,
  AvatarTop,
} from "./avatar-parts.js";
import { BeeFigure } from "./bee-figure.js";

interface Props {
  seed: string;
  size?: number;
  label?: string;
  className?: string;
}

export function RobotHead({ seed, size = 24, label, className }: Props) {
  const traits = useMemo(() => avatarTraits(seed), [seed]);
  const head = HEAD_GEOMETRY[traits.head];
  const id = `avatar-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const parts = { traits, head };
  return (
    <svg
      data-testid="agent-avatar"
      viewBox="3 -3 94 96"
      width={size}
      height={size}
      className={cn("shrink-0", className)}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
    >
      <defs>
        <clipPath id={`${id}-head`}>
          <path d={head.path} />
        </clipPath>
        <mask
          id={`${id}-gaps`}
          maskUnits="userSpaceOnUse"
          x={-10}
          y={-10}
          width={120}
          height={120}
        >
          <rect x={-10} y={-10} width={120} height={120} fill="white" />
          <AvatarGapLines {...parts} />
        </mask>
      </defs>
      {traits.face === "bee" ? (
        <BeeFigure traits={traits} />
      ) : (
        <g mask={`url(#${id}-gaps)`}>
          <AvatarTop {...parts} />
          <AvatarBottom {...parts} />
          <AvatarEars {...parts} />
          <path d={head.path} fill={traits.palette.base} />
          <g clipPath={`url(#${id}-head)`}>
            <AvatarOverlays {...parts} />
            <AvatarFace {...parts} />
            <AvatarMouth {...parts} />
          </g>
        </g>
      )}
    </svg>
  );
}
