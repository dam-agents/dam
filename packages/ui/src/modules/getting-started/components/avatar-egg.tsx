import { type CSSProperties, useId } from "react";

import { cn } from "@/lib/utils";

const EGG_D =
  "M20 3 C11.5 3 6 15 6 24 C6 31.5 12 37 20 37 C28 37 34 31.5 34 24 C34 15 28.5 3 20 3 Z";
const CRACK =
  "40,19 34,19 31,16.5 27.5,20.5 24,16.5 20.5,20.5 17,16.5 13.5,20.5 10,16.5 6,19 0,19";
const CLIPS = {
  top: `0,0 40,0 ${CRACK}`,
  bottom: `0,40 40,40 ${CRACK}`,
};
const SPECKLES: ReadonlyArray<readonly [number, number, number]> = [
  [15, 12.5, 1.4],
  [23.5, 9.5, 1.1],
  [26.5, 26, 1.6],
  [13, 28.5, 1.2],
  [20, 32, 0.9],
];

interface Props {
  part?: "whole" | "top" | "bottom";
  className?: string;
  style?: CSSProperties;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The egg stands in for every avatar character the
 * user has not unlocked yet, so each one stays a surprise. The unlock
 * animation cracks it into a top and a bottom half along one zigzag.
 */
export function AvatarEgg({ part = "whole", className, style }: Props) {
  const clipId = useId();
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn("shrink-0", className)}
      style={style}
    >
      {part !== "whole" && (
        <defs>
          <clipPath id={clipId}>
            <polygon points={CLIPS[part]} />
          </clipPath>
        </defs>
      )}
      <g clipPath={part === "whole" ? undefined : `url(#${clipId})`}>
        <path d={EGG_D} className="fill-muted-foreground/25" />
        {SPECKLES.map(([cx, cy, r]) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r={r}
            className="fill-muted-foreground/40"
          />
        ))}
      </g>
    </svg>
  );
}
